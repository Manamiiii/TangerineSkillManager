import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanEntry, State, Target } from '../shared/types';
import { discoverSkills, parseSkillMarkdown } from './skills';
import { statOrNull, identity } from './paths';
import { hashFiles, readTree, MARKER } from './files';
import { isOwned, installId } from './sync';
import { publicError } from './errors';
export async function scanTargets(
  targets: Target[],
  state: State,
  vaultRoot: string,
  currentHashes: Record<string, string> = {},
  warnings: string[] = [],
): Promise<ScanEntry[]> {
  const result: ScanEntry[] = [];
  for (const target of targets) {
    if (target.error || !target.exists) continue;
    let directories: string[];
    try {
      if (target.readOnly) {
        const discovery = await discoverSkills(target.realPath ?? target.path);
        directories = discovery.directories;
        warnings.push(...discovery.warnings.map((message) => `${target.agentName}: ${message}`));
      } else
        directories = (await fs.readdir(target.path, { withFileTypes: true }))
          .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
          .map((e) => path.join(target.path, e.name));
    } catch (error) {
      warnings.push(`${target.agentName}: ${publicError(error).message}`);
      continue;
    }
    for (const directory of directories) {
      const id = path.basename(directory),
        record = state.installations[installId(directory)];
      const entry: ScanEntry = {
        id,
        name: id,
        description: '',
        path: directory,
        scope: target.scope,
        source: target.agentName,
        status: 'external',
      };
      try {
        const st = await statOrNull(directory);
        const owned = await isOwned(record, directory);
        if (st?.isSymbolicLink() && !owned) {
          entry.status = record ? 'conflict' : 'external';
          entry.detail = 'External symbolic link; not followed or modified.';
          result.push(entry);
          continue;
        }
        const physical = st?.isSymbolicLink() ? await fs.realpath(directory) : directory;
        if (!(await statOrNull(path.join(physical, 'SKILL.md')))) {
          if (record) {
            entry.status = 'conflict';
            entry.detail = 'Managed installation no longer contains SKILL.md.';
            result.push(entry);
          }
          continue;
        }
        const files = await readTree(physical, true),
          md = files.find((f) => f.name === 'SKILL.md');
        if (!md || md.directory || md.bytes.length > 1024 * 1024) throw new Error();
        const parsed = parseSkillMarkdown(md.bytes.toString('utf8'));
        entry.name = parsed.name || id;
        entry.description = parsed.description || '';
        entry.hash = hashFiles(
          owned ? files.filter((f) => f.name !== MARKER && f.name !== record?.metadataFilename) : files,
        );
        entry.modifiedAt = (await fs.stat(path.join(physical, 'SKILL.md'))).mtime.toISOString();
        if (record) {
          entry.status = owned ? 'managed' : 'conflict';
          const local = state.vaults[identity(vaultRoot)]?.[id];
          const sourceHash = currentHashes[id] ?? local?.hash;
          if (owned && sourceHash && sourceHash !== record.hash) entry.status = 'outdated';
        }
        if (target.readOnly) entry.detail = 'Read-only source. Discovery only.';
      } catch (e) {
        entry.status = 'conflict';
        entry.detail = publicError(e).message;
      }
      result.push(entry);
    }
  }
  for (const record of Object.values(state.installations)) {
    if (!(await statOrNull(record.path)))
      result.push({
        id: record.skillId,
        name: record.skillId,
        description: '',
        path: record.path,
        scope: 'installation',
        source: record.targetId,
        status: 'missing',
        detail: 'Recorded installation is missing.',
      });
  }
  for (const record of Object.values(state.vaults[identity(vaultRoot)] ?? {})) {
    if (!(await statOrNull(path.join(vaultRoot, record.id))))
      result.push({
        id: record.id,
        name: record.id,
        description: '',
        path: path.join(vaultRoot, record.id),
        scope: 'vault',
        source: 'Local library',
        status: 'missing',
        detail: 'Recorded library Skill is missing.',
      });
  }
  return result;
}
