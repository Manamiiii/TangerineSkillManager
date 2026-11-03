import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Provenance, Skill, State } from '../shared/types';
import { Store } from './store';
import { identity, childPath, statOrNull, assertNoLinks, overlaps } from './paths';
import { readSkill, discoverSkills } from './skills';
import { readTree, stageTree, removePrivateTree, retireDirectory } from './files';
import { fail, publicError } from './errors';
export class Vault {
  constructor(
    readonly root: string,
    readonly store: Store,
  ) {}
  records(state: State) {
    return state.vaults[identity(this.root)] ?? {};
  }
  async list(): Promise<{ skills: Skill[]; warnings: string[] }> {
    const state = await this.store.loadState();
    if (!(await statOrNull(this.root))) return { skills: [], warnings: [] };
    await assertNoLinks(this.root);
    const { directories, warnings } = await discoverSkills(this.root, 1),
      skills: Skill[] = [];
    for (const dir of directories) {
      if (path.dirname(dir) !== this.root) {
        warnings.push('Vault Skills must be direct children of the library root.');
        continue;
      }
      try {
        const skill = await readSkill(dir);
        skill.source = this.records(state)[skill.id]?.source;
        skills.push(skill);
      } catch (e) {
        warnings.push(publicError(e).message);
      }
    }
    return { skills, warnings };
  }
  async get(id: string): Promise<Skill> {
    const skill = await readSkill(await childPath(this.root, id), id),
      state = await this.store.loadState();
    skill.source = this.records(state)[id]?.source;
    return skill;
  }
  async import(directory: string, provenance: Provenance, id: string, update = false): Promise<Skill> {
    const destination = await childPath(this.root, id);
    if (overlaps(this.root, directory)) fail('OVERLAP', 'Import source cannot overlap the local library.');
    const incoming = await readSkill(directory, id, true),
      state = await this.store.loadState(),
      records = this.records(state),
      prior = records[id];
    const exists = await statOrNull(destination);
    if (exists) {
      if (exists.isSymbolicLink()) fail('CONFLICT', 'A symlink occupies this library name.');
      const current = await readSkill(destination, id);
      if (!prior || current.hash !== prior.hash)
        fail(
          'CONFLICT',
          'Existing library content is unowned or externally modified. Import under another name.',
        );
      if (incoming.hash === current.hash) return this.get(id);
      if (!update) fail('CONFLICT', 'This Skill already exists. Use its explicit update action.');
    } else if (update) fail('NOT_FOUND', 'The Skill to update is missing.');
    const staged = await stageTree(this.root, await readTree(directory, false, true));
    if ((await readSkill(staged, id)).hash !== incoming.hash) {
      await removePrivateTree(this.root, staged);
      fail('CHANGED', 'Import source changed during staging.');
    }
    let backup: string | undefined;
    try {
      await assertNoLinks(destination);
      if (exists) {
        if ((await readSkill(destination, id)).hash !== prior.hash)
          fail('CHANGED', 'Library content changed before update.');
        backup = path.join(this.root, `.skill-manager-backup-${randomUUID()}`);
        await fs.rename(destination, backup);
      } else if (await statOrNull(destination))
        fail('CHANGED', 'Library destination appeared after preview.');
      await fs.rename(staged, destination);
      records[id] = { id, hash: incoming.hash, source: provenance, updatedAt: new Date().toISOString() };
      state.vaults[identity(this.root)] = records;
      await this.store.saveState(state);
      if (backup) await removePrivateTree(this.root, backup, prior.hash);
      return this.get(id);
    } catch (e) {
      if (backup && !(await statOrNull(destination))) await fs.rename(backup, destination).catch(() => {});
      if (await statOrNull(staged)) await removePrivateTree(this.root, staged).catch(() => {});
      throw e;
    }
  }
  async remove(id: string): Promise<void> {
    const destination = await childPath(this.root, id),
      state = await this.store.loadState(),
      records = this.records(state),
      record = records[id];
    if (!record) fail('NOT_MANAGED', 'Only imported, recorded library Skills can be deleted.');
    if (
      Object.values(state.installations).some(
        (i) => i.mode === 'symlink' && identity(i.source) === identity(destination),
      )
    )
      fail('LINKED_INSTALLS', 'Remove recorded symlink installations before deleting this library Skill.');
    if ((await readSkill(destination, id)).hash !== record.hash)
      fail('CONFLICT', 'Library content was changed externally; it will not be deleted.');
    await retireDirectory(this.root, destination, record.hash);
    delete records[id];
    state.vaults[identity(this.root)] = records;
    await this.store.saveState(state);
  }
}
