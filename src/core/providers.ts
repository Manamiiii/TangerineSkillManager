import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { isPublicAddress, resolvePublic, type AddressResolver } from './network';
export { isPublicAddress } from './network';
import net from 'node:net';
import * as git from 'isomorphic-git';
import type { HttpClient } from 'isomorphic-git';
import type { SourceConfig } from '../shared/config';
import type { Candidate, ProviderInfo, Provenance, Skill } from '../shared/types';
import { discoverSkills, readSkill } from './skills';
import { expandPath, contains, assertNoLinks, safeMkdir, statOrNull, type PathContext } from './paths';
import { MAX_BYTES, stageTree, removePrivateTree, type FileEntry } from './files';
import { AppError, fail, publicError } from './errors';

export interface Artifact {
  directory: string;
  id: string;
  provenance: Provenance;
  dispose(): Promise<void>;
}
export interface SkillSourceProvider {
  readonly info: ProviderInfo;
  discover(source: SourceConfig): Promise<Candidate[]>;
  search(source: SourceConfig, query: string): Promise<Candidate[]>;
  details(source: SourceConfig, relativePath: string): Promise<Skill>;
  fetch(source: SourceConfig, relativePath: string): Promise<Artifact>;
  checkUpdate(
    source: SourceConfig,
    relativePath: string,
    currentHash: string,
  ): Promise<{ available: boolean; currentHash: string; latestHash: string }>;
  versions(source: SourceConfig, relativePath: string): Promise<string[]>;
  authenticate(): Promise<void>;
  remove(): Promise<void>;
}
function info(kind: string, name: string, offline: boolean): ProviderInfo {
  return {
    kind,
    name,
    settings: {
      locationKind: kind === 'local' ? 'folder' : 'url',
      ref: kind === 'git',
      subdirectory: kind === 'git',
    },
    trust:
      kind === 'local'
        ? 'User-selected local content; not verified'
        : 'Untrusted public repository; not verified',
    capabilities: Object.fromEntries(
      [
        'discover',
        'search',
        'details',
        'fetch',
        'updates',
        'remove',
        'versions',
        'authentication',
        'offline',
      ].map((key) => [
        key,
        ['discover', 'search', 'details', 'fetch', 'updates'].includes(key) || (key === 'offline' && offline)
          ? { supported: true }
          : {
              supported: false,
              reason:
                key === 'remove'
                  ? 'Remove source configuration locally; remote deletion is not supported.'
                  : 'Not implemented in this release.',
            },
      ]),
    ),
  };
}
abstract class BaseProvider implements SkillSourceProvider {
  abstract readonly info: ProviderInfo;
  abstract discover(source: SourceConfig): Promise<Candidate[]>;
  abstract fetch(source: SourceConfig, relativePath: string): Promise<Artifact>;
  async search(source: SourceConfig, query: string) {
    const q = query.toLowerCase();
    return (await this.discover(source)).filter((s) =>
      `${s.name} ${s.description}`.toLowerCase().includes(q),
    );
  }
  async details(source: SourceConfig, relativePath: string) {
    const artifact = await this.fetch(source, relativePath);
    try {
      return await readSkill(artifact.directory, artifact.id, true);
    } finally {
      await artifact.dispose();
    }
  }
  async checkUpdate(source: SourceConfig, relativePath: string, currentHash: string) {
    const skill = await this.details(source, relativePath);
    return { available: currentHash !== skill.hash, currentHash, latestHash: skill.hash };
  }
  async versions(_source: SourceConfig, _relativePath: string): Promise<string[]> {
    return fail(
      'NOT_IMPLEMENTED',
      'Version enumeration is not implemented. Choose an explicit Git branch or tag.',
    );
  }
  async authenticate(): Promise<void> {
    fail(
      'NOT_IMPLEMENTED',
      'Authentication is not implemented. Use a public repository without credentials.',
    );
  }
  async remove(): Promise<void> {
    fail('NOT_IMPLEMENTED', 'Remote deletion is not supported. Remove the source configuration locally.');
  }
}
function relativeDirectory(root: string, relative: string): string {
  if (
    path.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..') ||
    /[\x00-\x1f]/.test(relative)
  )
    fail('PATH_TRAVERSAL', 'Skill path must be relative to its configured source.');
  const result = path.resolve(root, relative || '.');
  if (!contains(root, result)) fail('PATH_TRAVERSAL', 'Skill path escaped its source.');
  return result;
}
function sourceId(directory: string): string {
  const id = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(id) ? id : `skill-${id || 'import'}`;
}
async function candidates(root: string, rootId?: string): Promise<Candidate[]> {
  const { directories, warnings } = await discoverSkills(root);
  if (warnings.length) fail('SOURCE_SCAN', warnings[0]);
  const result: Candidate[] = [];
  for (const directory of directories) {
    const id = directory === root && rootId ? rootId : sourceId(directory);
    const relativePath = path.relative(root, directory).split(path.sep).join('/') || '.';
    try {
      const skill = await readSkill(directory, id, true);
      result.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        relativePath,
      });
    } catch (error) {
      result.push({
        id,
        name: path.basename(directory),
        description: '',
        relativePath,
        problem: publicError(error).message,
      });
    }
  }
  return result;
}
export class LocalFolderProvider extends BaseProvider {
  readonly info = info('local', 'Local folder', true);
  constructor(private ctx: PathContext) {
    super();
  }
  private root(s: SourceConfig) {
    return expandPath(s.location, this.ctx);
  }
  async discover(s: SourceConfig) {
    const root = this.root(s);
    await assertNoLinks(root);
    const stat = await statOrNull(root);
    if (!stat) fail('NOT_FOUND', 'The source folder does not exist. Select its current location and retry.');
    if (!stat.isDirectory())
      fail('INVALID_PATH', 'The selected source is a file. Choose a folder containing Skills.');
    return candidates(root);
  }
  async fetch(s: SourceConfig, relative: string): Promise<Artifact> {
    const root = this.root(s),
      directory = relativeDirectory(root, relative);
    await assertNoLinks(directory);
    const skill = await readSkill(directory, sourceId(directory), true);
    return {
      directory,
      id: skill.id,
      provenance: {
        provider: 'local',
        sourceKey: s.key,
        location: s.location,
        subdirectory: relative,
        importedAt: new Date().toISOString(),
      },
      dispose: async () => {},
    };
  }
}
export function validateGitUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('INVALID_URL', 'Enter a public HTTPS Git repository URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== '443') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.localhost')
  )
    fail(
      'INVALID_URL',
      'Only public HTTPS repositories without credentials, custom ports, query or fragment are supported.',
    );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host))
    fail('PRIVATE_NETWORK', 'Private and loopback network destinations are not allowed.');
  return url;
}
export function publicGitHttp(
  origin: URL,
  signal: AbortSignal,
  resolver: AddressResolver = resolvePublic,
): HttpClient {
  let received = 0;
  return {
    request: async (input) => {
      const url = new URL(input.url);
      if (
        url.origin !== origin.origin ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(origin.pathname.replace(/\/$/, '') + '/')
      )
        fail('NETWORK_SCOPE', 'Git request left the configured repository.');
      const addresses = await resolver(url.hostname, signal);
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
        fail('PRIVATE_NETWORK', 'Repository resolves to a private or reserved network address.');
      const payload: Buffer[] = [];
      let sent = 0;
      if (input.body)
        for await (const chunk of input.body) {
          sent += chunk.length;
          if (sent > 1024 * 1024) fail('LIMIT', 'Git request exceeds 1 MiB.');
          payload.push(Buffer.from(chunk));
        }
      return new Promise((resolve, reject) => {
        const req = https.request(
          url,
          {
            method: input.method ?? 'GET',
            headers: { ...input.headers, 'accept-encoding': 'identity' },
            signal,
            lookup: ((
              _hostname: string,
              options: { all?: boolean },
              callback: (...args: unknown[]) => void,
            ) => {
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            }) as NonNullable<https.RequestOptions['lookup']>,
          },
          (response) => {
            if (response.statusCode !== 200) {
              response.resume();
              reject(
                new AppError(
                  'GIT_HTTP',
                  `Repository returned HTTP ${response.statusCode}. Redirects and authentication are not supported; use the final public clone URL.`,
                ),
              );
              return;
            }
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (received > 64 * 1024 * 1024) {
                response.destroy(
                  new AppError('LIMIT', 'Repository transfer exceeds 64 MiB. Choose a smaller repository.'),
                );
              } else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () =>
              resolve({
                url: url.href,
                method: input.method ?? 'GET',
                statusCode: 200,
                statusMessage: 'OK',
                headers: Object.fromEntries(
                  Object.entries(response.headers).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(', ') : (v ?? ''),
                  ]),
                ),
                body: (async function* () {
                  yield Buffer.concat(chunks);
                })(),
              }),
            );
          },
        );
        req.on('error', (e) =>
          reject(
            e instanceof AppError
              ? e
              : new AppError(
                  signal.aborted ? 'TIMEOUT' : 'NETWORK',
                  signal.aborted
                    ? 'Git fetch timed out after 60 seconds.'
                    : 'Cannot connect to the public Git repository. Check the URL, network and system TLS trust.',
                ),
          ),
        );
        req.end(Buffer.concat(payload));
      });
    },
  };
}
export type CloneRepository = (source: SourceConfig, directory: string, signal: AbortSignal) => Promise<void>;
const clonePublic = async (
  source: SourceConfig,
  directory: string,
  signal: AbortSignal,
  resolver: AddressResolver,
) => {
  const url = validateGitUrl(source.location);
  await git.clone({
    fs,
    http: publicGitHttp(url, signal, resolver),
    dir: directory,
    url: url.href,
    ref: source.ref || undefined,
    singleBranch: true,
    depth: 1,
    noCheckout: true,
    noTags: !source.ref,
  });
};
export class GitProvider extends BaseProvider {
  readonly info = info('git', 'Public Git repository', false);
  constructor(
    private cache: string,
    private clone?: CloneRepository,
    private resolver: AddressResolver = resolvePublic,
  ) {
    super();
  }
  private async materialize(
    source: SourceConfig,
  ): Promise<{ root: string; commit: string; dispose(): Promise<void> }> {
    if (source.offline)
      fail(
        'OFFLINE',
        'Git fetch is unavailable in offline mode. Imported Skills remain available in your library.',
      );
    validateGitUrl(source.location);
    await safeMkdir(this.cache);
    const repo = await fsp.mkdtemp(path.join(this.cache, '.skill-manager-git-'));
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 60_000);
    let tree: string | undefined;
    const dispose = async () => {
      if (tree) await removePrivateTree(this.cache, tree);
      await removePrivateTree(this.cache, repo);
    };
    try {
      if (this.clone) await this.clone(source, repo, controller.signal);
      else await clonePublic(source, repo, controller.signal, this.resolver);
      const commit = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' });
      const prefix = source.subdirectory ? source.subdirectory.replace(/\/$/, '') + '/' : '';
      if (prefix.includes('\\') || prefix.split('/').includes('..') || prefix.startsWith('/'))
        fail('PATH_TRAVERSAL', 'Git subdirectory must be relative.');
      const files: FileEntry[] = [];
      let size = 0,
        count = 0;
      await git.walk({
        fs,
        dir: repo,
        trees: [git.TREE({ ref: commit })],
        map: async (filepath, [entry]) => {
          if (controller.signal.aborted) fail('TIMEOUT', 'Git fetch timed out after 60 seconds.');
          if (++count > 20_000)
            fail('LIMIT', 'Repository has too many entries. Choose a smaller repository.');
          if (!entry || filepath === '.' || (prefix && !filepath.startsWith(prefix))) return;
          const mode = await entry.mode(),
            type = await entry.type();
          if (type === 'tree') return;
          if (mode === 0o120000 || type !== 'blob')
            fail('UNSAFE_FILE', 'Git source contains symlinks or submodules. These are not imported.');
          const content = await entry.content();
          if (!content) return;
          size += content.byteLength;
          if (size > MAX_BYTES || files.length >= 5000)
            fail('LIMIT', 'Selected repository content exceeds 32 MiB or 5000 files.');
          files.push({
            name: filepath.slice(prefix.length),
            bytes: Buffer.from(content),
            mode: mode & 0o755,
          });
        },
      });
      if (!files.length) fail('NOT_FOUND', 'No files exist at the requested Git ref/subdirectory.');
      tree = await stageTree(this.cache, files);
      return { root: tree, commit, dispose };
    } catch (e) {
      await dispose().catch(() => {});
      if (e instanceof AppError) throw e;
      fail(
        'GIT_FAILED',
        'Could not read this repository or ref. Verify the public clone URL, branch/tag and subdirectory.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async discover(source: SourceConfig): Promise<Candidate[]> {
    const material = await this.materialize(source);
    try {
      return await candidates(material.root, this.rootId(source));
    } finally {
      await material.dispose();
    }
  }
  private rootId(source: SourceConfig): string {
    return sourceId(
      source.subdirectory?.split('/').filter(Boolean).at(-1) ||
        new URL(source.location).pathname
          .split('/')
          .filter(Boolean)
          .at(-1)
          ?.replace(/\.git$/, '') ||
        'skill',
    );
  }
  async fetch(source: SourceConfig, relative: string): Promise<Artifact> {
    const material = await this.materialize(source);
    try {
      const directory = relativeDirectory(material.root, relative);
      // When the repository/subdirectory itself is a Skill, its portable ID comes from the selected folder or repository name.
      const id = relative === '.' || !relative ? this.rootId(source) : sourceId(directory);
      await readSkill(directory, id);
      return {
        directory,
        id,
        provenance: {
          provider: 'git',
          sourceKey: source.key,
          location: source.location,
          ref: source.ref,
          subdirectory: relative,
          repositorySubdirectory: source.subdirectory || '',
          commit: material.commit,
          importedAt: new Date().toISOString(),
        },
        dispose: material.dispose,
      };
    } catch (e) {
      await material.dispose();
      throw e;
    }
  }
}
export class ProviderRegistry {
  private providers = new Map<string, SkillSourceProvider>();
  register(provider: SkillSourceProvider): void {
    if (this.providers.has(provider.info.kind))
      fail('DUPLICATE_PROVIDER', 'Provider kind already registered.');
    this.providers.set(provider.info.kind, provider);
  }
  get(kind: string): SkillSourceProvider {
    return (
      this.providers.get(kind) ??
      fail('NOT_IMPLEMENTED', `The ${kind} provider is not implemented in this release.`)
    );
  }
  list(): ProviderInfo[] {
    return [...this.providers.values()]
      .map((p) => p.info)
      .concat(
        ['registry', 'npm', 'pip', 'cli']
          .filter((k) => !this.providers.has(k))
          .map((kind) => ({
            kind,
            name: kind,
            trust: 'Unavailable',
            capabilities: { fetch: { supported: false, reason: 'Not implemented in this release.' } },
          })),
      );
  }
}
