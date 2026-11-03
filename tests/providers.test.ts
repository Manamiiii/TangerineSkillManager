import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { GitProvider, ProviderRegistry, isPublicAddress, validateGitUrl } from '../src/core/providers';
import { fixture, markdown } from './helpers';
import type { SourceConfig } from '../src/shared/config';
import { ApplicationService } from '../src/core/service';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
it('rejects nonpublic transport, credentials and unsupported providers', () => {
  for (const url of [
    'http://example.org/repo.git',
    'file:///tmp/repo',
    'https://localhost/repo',
    'https://127.0.0.1/repo',
    'https://user:pass@example.org/repo',
    'https://example.org/repo?token=x',
  ])
    expect(() => validateGitUrl(url)).toThrow();
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  expect(() => new ProviderRegistry().get('registry')).toThrow('not implemented');
});
it('uses real Git objects/refs, imports a subdirectory and reports provenance without external Git', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  const repo = path.join(f.root, 'repo');
  await fsp.mkdir(repo);
  await git.init({ fs, dir: repo, defaultBranch: 'main' });
  await fsp.mkdir(path.join(repo, 'skills', 'example-skill'), { recursive: true });
  await fsp.writeFile(path.join(repo, 'skills', 'example-skill', 'SKILL.md'), markdown());
  await git.add({ fs, dir: repo, filepath: '.' });
  const commit = await git.commit({
    fs,
    dir: repo,
    message: 'fixture',
    author: { name: 'Test', email: 'test@example.org' },
  });
  await git.tag({ fs, dir: repo, ref: 'v1.0.0', object: commit });
  // Inject only the transport; discovery, tree reading, refs, staging and import use real implementations.
  const provider = new GitProvider(path.join(f.data, 'git-cache'), async (source, dir) => {
    await fsp.cp(path.join(repo, '.git'), path.join(dir, '.git'), { recursive: true });
    const oid = await git.resolveRef({ fs, dir, ref: source.ref || 'main' });
    await fsp.writeFile(path.join(dir, '.git', 'HEAD'), oid + '\n');
  });
  const source: SourceConfig = {
    key: 'git',
    kind: 'git',
    name: 'Public fixture',
    enabled: true,
    location: 'https://example.org/skills.git',
    ref: 'v1.0.0',
    subdirectory: 'skills',
    offline: false,
  };
  const entries = await provider.discover(source);
  expect(entries).toHaveLength(1);
  expect(entries[0].relativePath).toBe('example-skill');
  const artifact = await provider.fetch(source, entries[0].relativePath);
  expect(artifact.provenance.commit).toBe(commit);
  expect(await fsp.readFile(path.join(artifact.directory, 'SKILL.md'), 'utf8')).toContain('Example');
  await artifact.dispose();
  const rootSkill = await provider.discover({ ...source, subdirectory: 'skills/example-skill' });
  expect(rootSkill[0].id).toBe('example-skill');
  expect(rootSkill[0].relativePath).toBe('.');
  await expect(provider.fetch({ ...source, offline: true }, 'example-skill')).rejects.toThrow('offline');
  await expect(provider.fetch(source, '../escape')).rejects.toThrow('relative');
  await expect(provider.authenticate()).rejects.toThrow('not implemented');
  expect(await fsp.readdir(path.join(f.data, 'git-cache'))).toEqual([]);
});
it('local provider refuses traversal and reports changed content', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await expect(
    f.app.request('importSkill', { sourceKey: 'local', relativePath: '../project' }),
  ).rejects.toThrow('relative');
  await f.importSkill();
  await fsp.appendFile(path.join(f.source, 'example-skill', 'SKILL.md'), '\nChange');
  expect((await f.app.request('checkUpdate', { id: 'example-skill' })).available).toBe(true);
});
it('keeps valid discovery results when another Skill has malformed front matter', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await fsp.mkdir(path.join(f.source, 'invalid-skill'));
  await fsp.writeFile(path.join(f.source, 'invalid-skill', 'SKILL.md'), '---\nname: [broken\n---\n');
  const result = await f.app.request('discover', { sourceKey: 'local' });
  expect(result.find((s) => s.id === 'example-skill')?.problem).toBeUndefined();
  expect(result.find((s) => s.id === 'invalid-skill')?.problem).toContain('invalid YAML');
  await expect(
    f.app.request('importSkill', { sourceKey: 'local', relativePath: 'invalid-skill' }),
  ).rejects.toThrow();
});
it('distinguishes a missing source folder from an empty valid source', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  f.config.providers[0].location = path.join(f.root, 'missing-source');
  await f.app.request('saveConfig', f.config);
  await expect(f.app.request('discover', { sourceKey: 'local' })).rejects.toThrow(
    'source folder does not exist',
  );
  await fsp.mkdir(f.config.providers[0].location);
  expect(await f.app.request('discover', { sourceKey: 'local' })).toEqual([]);
});
it('ignores source Git administration files consistently during import and update checks', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await fsp.mkdir(path.join(f.source, 'example-skill', '.git'));
  await fsp.writeFile(path.join(f.source, 'example-skill', '.git', 'config'), 'fixture');
  const imported = await f.importSkill();
  await expect(fsp.stat(path.join(imported.path, '.git'))).rejects.toThrow();
  expect((await f.app.request('checkUpdate', { id: 'example-skill' })).available).toBe(false);
});
it('refuses to replace a Skill with a different repository subdirectory after editing its source', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  const repo = path.join(f.root, 'identity-repo');
  await fsp.mkdir(repo);
  await git.init({ fs, dir: repo, defaultBranch: 'main' });
  for (const [folder, version] of [
    ['original', '1.0.0'],
    ['different', '9.0.0'],
  ]) {
    await fsp.mkdir(path.join(repo, folder, 'example-skill'), { recursive: true });
    await fsp.writeFile(path.join(repo, folder, 'example-skill', 'SKILL.md'), markdown(version));
  }
  await git.add({ fs, dir: repo, filepath: '.' });
  await git.commit({
    fs,
    dir: repo,
    message: 'fixture',
    author: { name: 'Test', email: 'test@example.org' },
  });
  const registry = new ProviderRegistry();
  registry.register(
    new GitProvider(path.join(f.data, 'cache'), async (_source, dir) => {
      await fsp.cp(path.join(repo, '.git'), path.join(dir, '.git'), { recursive: true });
    }),
  );
  const app = new ApplicationService(path.join(f.data, 'identity'), f.home, registry);
  const initial = await app.request('snapshot', undefined);
  const source: SourceConfig = {
    key: 'git',
    kind: 'git',
    name: 'Git',
    enabled: true,
    location: 'https://example.org/repo.git',
    subdirectory: 'original',
    offline: false,
  };
  const config = { ...initial.config, agents: [], providers: [source] };
  await app.request('saveConfig', config);
  const original = await app.request('importSkill', { sourceKey: 'git', relativePath: 'example-skill' });
  await app.request('saveConfig', { ...config, providers: [{ ...source, subdirectory: 'different' }] });
  await expect(app.request('checkUpdate', { id: 'example-skill' })).rejects.toThrow('source subdirectory');
  await expect(app.request('updateSkill', { id: 'example-skill' })).rejects.toThrow('source subdirectory');
  expect((await app.request('snapshot', undefined)).skills[0].hash).toBe(original.hash);
});
