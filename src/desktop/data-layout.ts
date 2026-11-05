import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrateConfig, stateSchema } from '../core/store';
import { expandPath } from '../core/paths';
import os from 'node:os';

// Run before Chromium starts, while holding the legacy Electron single-instance lock.
// No directory discovery outside these two OS-provided application locations.
export function windowsLayout(local: string, roaming: string) {
  if (![local, roaming].every((p) => path.isAbsolute(p))) throw new Error('DATA_PATH_INVALID');
  const root = path.join(local, 'Tangerine', 'Data', 'TangerineSkillManager');
  return {
    root,
    legacy: path.join(roaming, 'skill-manager'),
    roaming,
    config: path.join(root, 'Config'),
    storage: path.join(root, 'Storage'),
    cache: path.join(root, 'Cache', 'Git'),
    backups: path.join(root, 'Backups'),
    logs: path.join(root, 'Logs'),
    runtime: path.join(root, 'Runtime'),
    profile: path.join(root, 'Storage', 'Electron'),
    session: path.join(root, 'Cache', 'Chromium'),
    crash: path.join(root, 'Cache', 'Crashpad'),
    temp: path.join(root, 'Temp'),
  };
}
export type WindowsLayout = ReturnType<typeof windowsLayout>;
function stat(file: string) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function safe(file: string) {
  let current = path.resolve(file);
  for (;;) {
    const s = stat(current);
    if (s?.isSymbolicLink() || (s?.isFile() && s.nlink !== 1)) throw new Error('DATA_LINK_REFUSED');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function bytes(file: string) {
  safe(file);
  const s = stat(file);
  if (!s?.isFile() || s.size > 32 * 1024 * 1024) throw new Error('DATA_FILE_INVALID');
  return fs.readFileSync(file);
}
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const writeNew = (file: string, value: string | Buffer) => {
  safe(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
};
type Journal = { version: 1; kind: 'fresh' | 'migrated'; configHash?: string; stateHash?: string };
const journalPath = (l: WindowsLayout) => path.join(l.runtime, 'layout.json');
const originalPath = (l: WindowsLayout) => path.join(l.legacy, 'config.pre-tangerine.json');
const legacyConfig = (l: WindowsLayout) => path.join(l.legacy, 'config.json');
function journal(l: WindowsLayout): Journal | undefined {
  if (!stat(journalPath(l))) return undefined;
  const value = JSON.parse(bytes(journalPath(l)).toString());
  if (
    value.version !== 1 ||
    !['fresh', 'migrated'].includes(value.kind) ||
    Object.keys(value).some((k) => !['version', 'kind', 'configHash', 'stateHash'].includes(k)) ||
    (value.kind === 'migrated' && !/^[a-f0-9]{64}$/.test(value.configHash)) ||
    (value.stateHash !== undefined && !/^[a-f0-9]{64}$/.test(value.stateHash))
  )
    throw new Error('DATA_JOURNAL_INVALID');
  return value;
}
function hasLegacy(l: WindowsLayout) {
  safe(l.legacy);
  // Even an incomplete old directory must not be silently replaced by an empty library.
  return !!stat(l.legacy) && fs.readdirSync(l.legacy).length > 0;
}
function verifyGuard(l: WindowsLayout, j: Journal) {
  safe(legacyConfig(l));
  if (
    !stat(legacyConfig(l))?.isDirectory() ||
    fs.readdirSync(legacyConfig(l)).join() !== 'MIGRATED.txt' ||
    bytes(path.join(legacyConfig(l), 'MIGRATED.txt')).toString() !== 'TangerineSkillManager layout v1\n' ||
    hash(bytes(originalPath(l))) !== j.configHash
  )
    throw new Error('DATA_LEGACY_CHANGED');
  const oldState = path.join(l.legacy, 'state.json');
  if (j.stateHash ? hash(bytes(oldState)) !== j.stateHash : !!stat(oldState))
    throw new Error('DATA_LEGACY_CHANGED');
}
function finishMigration(l: WindowsLayout, j: Journal) {
  const source = stat(originalPath(l)) ? originalPath(l) : legacyConfig(l);
  const config = bytes(source);
  if (hash(config) !== j.configHash) throw new Error('DATA_LEGACY_CHANGED');
  migrateConfig(JSON.parse(config.toString()));
  const files: [string, Buffer][] = [[path.join(l.config, 'config.json'), config]];
  if (j.stateHash) {
    const state = bytes(path.join(l.legacy, 'state.json'));
    if (hash(state) !== j.stateHash) throw new Error('DATA_LEGACY_CHANGED');
    stateSchema.parse(JSON.parse(state.toString()));
    files.push([path.join(l.storage, 'state.json'), state]);
  } else if (stat(path.join(l.legacy, 'state.json'))) throw new Error('DATA_LEGACY_CHANGED');
  else if (stat(path.join(l.storage, 'state.json'))) throw new Error('DATA_COPY_CONFLICT');
  // Exclusive copies, then byte verification. A partial or altered destination is never overwritten.
  for (const [dest, content] of files) {
    if (!stat(dest)) writeNew(dest, content);
    if (!bytes(dest).equals(content)) throw new Error('DATA_COPY_CONFLICT');
  }
  if (!stat(originalPath(l))) fs.renameSync(legacyConfig(l), originalPath(l));
  if (!stat(legacyConfig(l))) fs.mkdirSync(legacyConfig(l));
  const guard = path.join(legacyConfig(l), 'MIGRATED.txt');
  if (!stat(guard)) writeNew(guard, 'TangerineSkillManager layout v1\n');
  verifyGuard(l, j);
  writeNew(path.join(l.runtime, 'migration-complete'), '1\n');
}
export function prepareWindowsData(l: WindowsLayout, migrate = false, home = os.homedir()) {
  safe(l.root);
  let j = journal(l);
  if (!j) {
    if (stat(l.root) && fs.readdirSync(l.root).length) throw new Error('DATA_DESTINATION_OCCUPIED');
    if (hasLegacy(l)) {
      if (!migrate) throw new Error('DATA_MIGRATION_REQUIRED');
      if (stat(originalPath(l))) throw new Error('DATA_MULTIPLE_OR_INTERRUPTED');
      const config = bytes(legacyConfig(l));
      const parsed = migrateConfig(JSON.parse(config.toString())).config;
      const vault = expandPath(parsed.vault.root, { home, data: l.roaming, base: l.legacy });
      safe(vault);
      if (
        (parsed.vault.root !== '{data}/skill-manager/vault/skills' ||
          stat(path.join(l.legacy, 'state.json'))) &&
        !stat(vault)?.isDirectory()
      )
        throw new Error('DATA_LIBRARY_UNAVAILABLE');
      const stateFile = path.join(l.legacy, 'state.json');
      let stateHash: string | undefined;
      if (stat(stateFile)) {
        const value = bytes(stateFile);
        stateSchema.parse(JSON.parse(value.toString()));
        stateHash = hash(value);
      }
      j = { version: 1, kind: 'migrated', configHash: hash(config), ...(stateHash ? { stateHash } : {}) };
    } else j = { version: 1, kind: 'fresh' };
    writeNew(journalPath(l), JSON.stringify(j, null, 2));
  }
  if (j.kind === 'migrated') {
    if (!stat(path.join(l.runtime, 'migration-complete'))) {
      if (!migrate) throw new Error('DATA_MIGRATION_INTERRUPTED');
      finishMigration(l, j);
    }
    verifyGuard(l, j);
    if (bytes(path.join(l.runtime, 'migration-complete')).toString() !== '1\n')
      throw new Error('DATA_JOURNAL_INVALID');
    // Never create defaults if migrated data has become unavailable.
    bytes(path.join(l.config, 'config.json'));
    if (j.stateHash) bytes(path.join(l.storage, 'state.json'));
  } else if (hasLegacy(l)) throw new Error('DATA_MULTIPLE_LIBRARIES');
  for (const dir of [l.config, l.storage, l.profile, l.session, l.crash, l.logs, l.temp]) {
    safe(dir);
    fs.mkdirSync(dir, { recursive: true });
  }
  return {
    ...l,
    // Preserve all old template/relative path semantics and installed link destinations.
    data: j.kind === 'migrated' ? l.roaming : l.storage,
    base: j.kind === 'migrated' ? l.legacy : l.config,
    defaultVault: j.kind === 'migrated' ? path.join(l.storage, 'vault', 'skills') : '{data}/vault/skills',
  };
}

// Only before any new business write. No merge or destructive "force rollback" option.
export function rollbackWindowsData(l: WindowsLayout) {
  safe(l.root);
  const j = journal(l);
  if (j?.kind !== 'migrated') throw new Error('DATA_ROLLBACK_UNAVAILABLE');
  verifyGuard(l, j);
  if (
    hash(bytes(path.join(l.config, 'config.json'))) !== j.configHash ||
    (j.stateHash
      ? hash(bytes(path.join(l.storage, 'state.json'))) !== j.stateHash
      : !!stat(path.join(l.storage, 'state.json')))
  )
    throw new Error('DATA_ROLLBACK_CHANGED');
  // Archive the complete new layout; never remove a user's data tree.
  const archive = `${l.root}.rollback-${Date.now()}`;
  if (stat(archive)) throw new Error('DATA_DESTINATION_OCCUPIED');
  fs.renameSync(l.root, archive);
  fs.unlinkSync(path.join(legacyConfig(l), 'MIGRATED.txt'));
  fs.rmdirSync(legacyConfig(l));
  fs.renameSync(originalPath(l), legacyConfig(l));
}
