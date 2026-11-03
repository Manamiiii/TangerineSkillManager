import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig, configSchema } from '../src/shared/config';
import { expandPath, childPath } from '../src/core/paths';
import { migrateConfig } from '../src/core/store';
import { publicError } from '../src/core/errors';
import { fixture } from './helpers';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
describe('configuration', () => {
  it('has portable, offline defaults and a strict schema', () => {
    expect(configSchema.parse(defaultConfig()).providers).toEqual([]);
    expect(configSchema.safeParse({ ...defaultConfig(), token: 'invalid' }).success).toBe(false);
    expect(
      configSchema.safeParse({
        ...defaultConfig(),
        agents: [defaultConfig().agents[0], defaultConfig().agents[0]],
      }).success,
    ).toBe(false);
  });
  it('migrates version zero and rejects future versions', () => {
    const { providers, defaultSyncMode, ...old } = defaultConfig();
    expect(migrateConfig({ ...old, version: 0 })).toEqual({ config: defaultConfig(), migrated: true });
    expect(() => migrateConfig({ ...defaultConfig(), version: 999 })).toThrow('Unsupported');
  });
  it('backs up migrations and preserves corrupt configuration before explicit reset', async () => {
    const f = await fixture();
    cleanup.push(f.cleanup);
    const file = f.app.store.configPath,
      old = JSON.stringify({ ...f.config, version: 0 });
    await fs.writeFile(file, old);
    await f.app.store.loadConfig();
    const backups = (await fs.readdir(path.dirname(file))).filter((n) => n.startsWith('config.json.backup-'));
    expect(
      await Promise.all(backups.map((n) => fs.readFile(path.join(path.dirname(file), n), 'utf8'))),
    ).toContain(old);
    await fs.writeFile(file, '{broken');
    await expect(f.app.request('snapshot', undefined)).rejects.toThrow('original file was preserved');
    expect(await fs.readFile(file, 'utf8')).toBe('{broken');
    await f.app.request('resetConfig', undefined);
    const all = await fs.readdir(path.dirname(file));
    expect(
      await Promise.all(
        all
          .filter((n) => n.startsWith('config.json.backup-'))
          .map((n) => fs.readFile(path.join(path.dirname(file), n), 'utf8')),
      ),
    ).toContain('{broken');
  });
  it('fails closed on corrupt ownership state and redacts unknown errors', async () => {
    const f = await fixture();
    cleanup.push(f.cleanup);
    await fs.writeFile(f.app.store.statePath, '{broken');
    await expect(f.importSkill()).rejects.toThrow('Ownership records');
    expect(publicError(new Error('secret credentials and paths')).message).not.toContain('secret');
    await f.app.store.log('path/to/private?token=hidden');
    expect(await fs.readFile(path.join(f.app.store.directory, 'events.log'), 'utf8')).not.toContain('hidden');
  });
  it('rejects credentials, parent traversal and unsafe metadata rules', () => {
    const c = defaultConfig();
    c.providers = [
      {
        key: 'bad',
        kind: 'git',
        name: 'Bad',
        enabled: true,
        location: 'https://user:password@example.org/repo.git',
        offline: false,
      },
    ];
    expect(configSchema.safeParse(c).success).toBe(false);
    c.providers[0].location = 'https://example.org/repo.git';
    c.providers[0].subdirectory = '../escape';
    expect(configSchema.safeParse(c).success).toBe(false);
    c.providers = [];
    c.agents[0].installationMetadata = { filename: '../outside.json', values: {} };
    expect(configSchema.safeParse(c).success).toBe(false);
  });
});
describe('portable paths', () => {
  const unix = {
    home: '/home/example',
    data: '/home/example/.local/share',
    base: '/settings',
    workspace: '/work/project',
    platform: 'linux' as const,
  };
  const windows = {
    home: 'C:\\Users\\Example',
    data: 'C:\\Data',
    base: 'C:\\Settings',
    workspace: 'D:\\Project',
    platform: 'win32' as const,
  };
  it('expands home/workspace/data and relative paths on POSIX and Windows', () => {
    for (const value of ['~/skills', '$HOME/skills', '${HOME}/skills', '%USERPROFILE%/skills'])
      expect(expandPath(value, unix)).toBe('/home/example/skills');
    expect(expandPath('{workspace}/.agents/skills', unix)).toBe('/work/project/.agents/skills');
    expect(expandPath('relative/skills', unix)).toBe('/settings/relative/skills');
    expect(expandPath('~/skills', windows)).toBe('C:\\Users\\Example\\skills');
    expect(expandPath('{workspace}/skills', windows)).toBe('D:\\Project\\skills');
    expect(expandPath('{data}/skill-manager', windows)).toBe('C:\\Data\\skill-manager');
  });
  it('rejects traversal, foreign drives, unknown templates and missing workspaces', () => {
    for (const value of ['../escape', '~/a/../b', 'C:\\Skills', '$UNKNOWN/skills'])
      expect(() => expandPath(value, unix)).toThrow();
    expect(() => expandPath('{workspace}/skills', { ...unix, workspace: undefined })).toThrow();
    for (const value of ['C:relative', '/home/example', 'C:\\file:stream', '\\\\server\\share'])
      expect(() => expandPath(value, windows)).toThrow();
  });
  it('rejects unsafe Skill IDs before touching disk', async () => {
    for (const id of ['../escape', 'a/b', 'CON', 'nul', 'my skill'])
      await expect(childPath(process.cwd(), id)).rejects.toThrow();
  });
});
