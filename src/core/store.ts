import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { configSchema, defaultConfig, keySchema, type Config } from '../shared/config';
import type { State } from '../shared/types';
import { atomicJson } from './files';
import { assertNoLinks, statOrNull } from './paths';
import { AppError, fail } from './errors';
const provenanceSchema = z.object({
  provider: z.string(),
  sourceKey: z.string().optional(),
  location: z.string(),
  ref: z.string().optional(),
  subdirectory: z.string().optional(),
  repositorySubdirectory: z.string().optional(),
  commit: z.string().optional(),
  importedAt: z.string(),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const record = z.object({ id: keySchema, hash, source: provenanceSchema, updatedAt: z.string() });
const installation = z.object({
  id: z.string(),
  skillId: keySchema,
  targetId: z.string(),
  root: z.string(),
  path: z.string(),
  source: z.string(),
  mode: z.enum(['copy', 'symlink']),
  hash,
  installedHash: hash,
  token: z.string().uuid(),
  installedAt: z.string(),
  metadataFilename: z.string().optional(),
});
export const stateSchema = z.object({
  version: z.literal(1),
  vaults: z.record(z.string(), z.record(keySchema, record)),
  installations: z.record(z.string(), installation),
});
export function migrateConfig(raw: unknown): { config: Config; migrated: boolean } {
  if (typeof raw !== 'object' || raw === null) fail('CONFIG_INVALID', 'Configuration must be a JSON object.');
  const old = raw as Record<string, unknown>;
  if (old.version === 0) {
    return {
      config: configSchema.parse({
        ...old,
        version: 1,
        providers: old.providers ?? [],
        defaultSyncMode: old.defaultSyncMode ?? 'copy',
      }),
      migrated: true,
    };
  }
  if (old.version !== 1)
    fail(
      'CONFIG_VERSION',
      'Unsupported configuration version. Use a compatible app version or explicitly restore defaults.',
    );
  return { config: configSchema.parse(raw), migrated: false };
}
export class Store {
  readonly configPath: string;
  readonly statePath: string;
  constructor(
    readonly directory: string,
    private options: {
      storage?: string;
      backups?: string;
      logs?: string;
      defaultVault?: string;
      root?: string;
      cache?: string;
    } = {},
  ) {
    this.configPath = path.join(directory, 'config.json');
    this.statePath = path.join(options.storage ?? directory, 'state.json');
  }
  get protectedRoot() {
    return this.options.root ?? this.directory;
  }
  get updateCache() {
    return path.join(this.options.cache ?? this.directory, 'update-staging');
  }
  async backup(filename: string): Promise<string | undefined> {
    await assertNoLinks(filename);
    if (!(await statOrNull(filename))) return;
    const backup = path.join(
      this.options.backups ?? path.dirname(filename),
      `${path.basename(filename)}.backup-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    await assertNoLinks(backup);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(filename, backup, fs.constants.COPYFILE_EXCL);
    return backup;
  }
  async loadConfig(): Promise<Config> {
    await assertNoLinks(this.configPath);
    if (!(await statOrNull(this.configPath))) {
      if (await statOrNull(this.statePath))
        fail(
          'CONFIG_MISSING',
          'Configuration is missing but ownership records exist. Restore the configuration backup before continuing.',
        );
      const c = this.defaults();
      await atomicJson(this.configPath, c);
      return c;
    }
    try {
      const result = migrateConfig(JSON.parse(await fs.readFile(this.configPath, 'utf8')));
      if (result.migrated) {
        await this.backup(this.configPath);
        await atomicJson(this.configPath, result.config);
      }
      return result.config;
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFIG_VERSION') throw e;
      fail(
        'CONFIG_INVALID',
        'Configuration is invalid. The original file was preserved. Fix it on disk or restore defaults to create a backup.',
      );
    }
  }
  async saveConfig(config: Config): Promise<void> {
    configSchema.parse(config);
    await this.loadConfig();
    await this.backup(this.configPath);
    await atomicJson(this.configPath, config);
  }
  async reset(): Promise<Config> {
    await this.backup(this.configPath);
    const c = this.defaults();
    await atomicJson(this.configPath, c);
    return c;
  }
  async loadState(): Promise<State> {
    await assertNoLinks(this.statePath);
    if (!(await statOrNull(this.statePath))) return { version: 1, vaults: {}, installations: {} };
    try {
      return stateSchema.parse(JSON.parse(await fs.readFile(this.statePath, 'utf8')));
    } catch {
      fail(
        'STATE_INVALID',
        'Ownership records are damaged. Writes are blocked. Restore state.json from a backup; do not delete it to force an overwrite.',
      );
    }
  }
  async saveState(state: State): Promise<void> {
    stateSchema.parse(state);
    await this.backup(this.statePath);
    await atomicJson(this.statePath, state);
  }
  async log(code: string): Promise<void> {
    // Never serialize an Error, user path, provider URL, or arbitrary message.
    const event = /^[A-Z_]{1,50}$/.test(code) ? code : 'UNKNOWN';
    const filename = path.join(this.options.logs ?? this.directory, 'events.log');
    await assertNoLinks(filename);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const st = await statOrNull(filename);
    if (st && (!st.isFile() || st.nlink > 1)) return;
    if (st && st.size > 256 * 1024) await fs.writeFile(filename, '', { mode: 0o600 });
    await fs.appendFile(filename, `${new Date().toISOString()} ${event}\n`, { mode: 0o600 });
  }
  private defaults(): Config {
    const config = defaultConfig();
    if (this.options.defaultVault) config.vault.root = this.options.defaultVault;
    return config;
  }
}
