import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { windowsLayout, prepareWindowsData, rollbackWindowsData } from '../src/desktop/data-layout';
import { defaultConfig } from '../src/shared/config';
import { ApplicationService } from '../src/core/service';
import { Store } from '../src/core/store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('tsm-layout-'))
      throw new Error('scope');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(version = 1) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tsm-layout-'));
  roots.push(root);
  const l = windowsLayout(path.join(root, 'Local'), path.join(root, 'Roaming'));
  fs.mkdirSync(path.join(l.legacy, 'vault', 'skills'), { recursive: true });
  const c = { ...defaultConfig(), version };
  const original = JSON.stringify(c, null, 2);
  fs.writeFileSync(path.join(l.legacy, 'config.json'), original);
  fs.writeFileSync(
    path.join(l.legacy, 'state.json'),
    JSON.stringify({ version: 1, vaults: {}, installations: {} }),
  );
  return { l, root, original };
}
test('fresh layout separates config, storage, backups, logs and caches', async () => {
  const { l, root } = fixture();
  fs.rmSync(l.legacy, { recursive: true });
  const prepared = prepareWindowsData(l);
  const service = new ApplicationService(prepared.data, root, undefined, undefined, prepared);
  const s = await service.request('snapshot', undefined);
  expect(s.configPath).toBe(path.join(l.config, 'config.json'));
  expect(s.vaultPath).toBe(path.join(l.storage, 'vault', 'skills'));
  await service.request('saveConfig', s.config);
  expect(fs.readdirSync(l.backups)).toHaveLength(1);
  expect(fs.existsSync(path.join(l.logs, 'events.log'))).toBe(true);
  expect(fs.existsSync(l.legacy)).toBe(false);
  expect(prepareWindowsData(l).data).toBe(l.storage);
});
for (const version of [0, 1])
  test(`explicit migration of v${version} preserves bytes, templates and blocks old writers`, async () => {
    const { l, root, original } = fixture(version);
    expect(() => prepareWindowsData(l)).toThrow('DATA_MIGRATION_REQUIRED');
    expect(fs.existsSync(l.root)).toBe(false);
    const prepared = prepareWindowsData(l, true, root);
    expect(fs.readFileSync(path.join(l.legacy, 'config.pre-tangerine.json'), 'utf8')).toBe(original);
    expect(fs.readFileSync(path.join(l.config, 'config.json'), 'utf8')).toBe(original);
    const old = new Store(l.legacy);
    await expect(old.loadConfig()).rejects.toThrow();
    await expect(old.reset()).rejects.toThrow();
    const service = new ApplicationService(prepared.data, root, undefined, undefined, prepared);
    expect((await service.request('snapshot', undefined)).vaultPath).toBe(
      path.join(l.legacy, 'vault', 'skills'),
    );
    expect(prepareWindowsData(l)).toEqual(prepared);
  });
test('conflicting new and old layouts do not select or merge either', () => {
  const { l, original } = fixture();
  fs.mkdirSync(l.config, { recursive: true });
  fs.writeFileSync(path.join(l.config, 'config.json'), '{}');
  expect(() => prepareWindowsData(l, true)).toThrow('DATA_DESTINATION_OCCUPIED');
  expect(fs.readFileSync(path.join(l.legacy, 'config.json'), 'utf8')).toBe(original);
});
test('a later old-version library is detected even after a fresh start', () => {
  const { l } = fixture();
  const config = fs.readFileSync(path.join(l.legacy, 'config.json'));
  fs.rmSync(l.legacy, { recursive: true });
  prepareWindowsData(l);
  fs.mkdirSync(l.legacy);
  fs.writeFileSync(path.join(l.legacy, 'config.json'), config);
  expect(() => prepareWindowsData(l)).toThrow('DATA_MULTIPLE_LIBRARIES');
});
test('invalid, unsupported and missing external data preserve old files', () => {
  const { l } = fixture();
  for (const content of [
    '{broken',
    JSON.stringify({ ...defaultConfig(), version: 99 }),
    JSON.stringify({ ...defaultConfig(), vault: { root: path.join(l.legacy, 'offline-volume') } }),
  ]) {
    fs.writeFileSync(path.join(l.legacy, 'config.json'), content);
    expect(() => prepareWindowsData(l, true)).toThrow();
    expect(fs.existsSync(l.root)).toBe(false);
    expect(fs.readFileSync(path.join(l.legacy, 'config.json'), 'utf8')).toBe(content);
  }
});
test('interrupted copy is resumable only explicitly and only with matching bytes', () => {
  const { l, original } = fixture();
  // Inject a real copy failure without changing production behavior.
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (file === path.join(l.storage, 'state.json')) throw new Error('disk full fixture');
    return (originalWrite as (...a: unknown[]) => void)(file, ...args);
  }) as typeof fs.writeFileSync;
  try {
    expect(() => prepareWindowsData(l, true)).toThrow('disk full fixture');
  } finally {
    fs.writeFileSync = originalWrite;
  }
  expect(fs.readFileSync(path.join(l.legacy, 'config.json'), 'utf8')).toBe(original);
  expect(() => prepareWindowsData(l)).toThrow('DATA_MIGRATION_INTERRUPTED');
  fs.writeFileSync(path.join(l.config, 'config.json'), 'conflict');
  expect(() => prepareWindowsData(l, true)).toThrow('DATA_COPY_CONFLICT');
  fs.writeFileSync(path.join(l.config, 'config.json'), original);
  prepareWindowsData(l, true);
  expect(prepareWindowsData(l).base).toBe(l.legacy);
});
test('missing or altered migrated records never create defaults', () => {
  const { l } = fixture();
  prepareWindowsData(l, true);
  fs.unlinkSync(path.join(l.config, 'config.json'));
  expect(() => prepareWindowsData(l)).toThrow('DATA_FILE_INVALID');
  expect(fs.existsSync(path.join(l.config, 'config.json'))).toBe(false);
});
test('rollback archives destination and restores exact original only before new writes', () => {
  const { l, original } = fixture();
  prepareWindowsData(l, true);
  fs.appendFileSync(path.join(l.config, 'config.json'), ' ');
  expect(() => rollbackWindowsData(l)).toThrow('DATA_ROLLBACK_CHANGED');
  fs.writeFileSync(path.join(l.config, 'config.json'), original);
  rollbackWindowsData(l);
  expect(fs.readFileSync(path.join(l.legacy, 'config.json'), 'utf8')).toBe(original);
  expect(fs.existsSync(l.root)).toBe(false);
  expect(fs.readdirSync(path.dirname(l.root)).some((s) => s.includes('.rollback-'))).toBe(true);
});
test('old-state changes or redirected layout paths fail closed', () => {
  const { l, root } = fixture();
  prepareWindowsData(l, true);
  fs.appendFileSync(path.join(l.legacy, 'state.json'), ' ');
  expect(() => prepareWindowsData(l)).toThrow('DATA_LEGACY_CHANGED');
  const other = windowsLayout(path.join(root, 'Other'), l.roaming);
  fs.mkdirSync(path.dirname(other.root), { recursive: true });
  fs.symlinkSync(l.root, other.root, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => prepareWindowsData(other)).toThrow('DATA_LINK_REFUSED');
  fs.unlinkSync(other.root);
});

test('migration keeps external vault and relative project/provider paths at their original locations', async () => {
  const { l, root } = fixture();
  const external = path.join(root, 'external-library');
  fs.mkdirSync(external);
  const c = defaultConfig();
  c.vault.root = external;
  c.projects = [{ key: 'demo', name: 'Demo', root: 'project' }];
  c.agents[0].userDirectories = ['relative-target'];
  c.providers = [
    { key: 'local', kind: 'local', name: 'Local', location: 'source', enabled: true, offline: true },
  ];
  fs.writeFileSync(path.join(l.legacy, 'config.json'), JSON.stringify(c));
  const l2 = prepareWindowsData(l, true, root);
  const app = new ApplicationService(l2.data, root, undefined, undefined, l2);
  const result = await app.request('snapshot', undefined);
  expect(result.config).toEqual(c);
  expect(result.vaultPath).toBe(external);
  expect(result.targets[0].path).toBe(path.join(l.legacy, 'relative-target'));
  expect(result.targets[1].path).toBe(path.join(l.legacy, 'project', '.agents', 'skills'));
});

test('missing configuration with records and disconnected libraries do not create replacements', async () => {
  const { l, root } = fixture();
  const store = new Store(l.legacy);
  fs.unlinkSync(store.configPath);
  await expect(store.loadConfig()).rejects.toThrow('Configuration is missing');
  expect(fs.existsSync(store.configPath)).toBe(false);
  fs.writeFileSync(store.configPath, JSON.stringify(defaultConfig()));
  const app = new ApplicationService(l.roaming, root, undefined, path.resolve('examples/clear-plan'));
  await app.request('importExample', undefined);
  const vault = path.join(l.legacy, 'vault', 'skills');
  fs.renameSync(vault, vault + '-offline');
  await expect(app.request('snapshot', undefined)).rejects.toThrow('library is unavailable');
  await expect(app.request('importExample', undefined)).rejects.toThrow('library is unavailable');
  expect(fs.existsSync(vault)).toBe(false);
});
