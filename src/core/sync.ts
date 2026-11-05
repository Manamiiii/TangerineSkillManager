import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Config, SyncMode } from '../shared/config';
import type {
  InstallRecord,
  PlanItem,
  ResultItem,
  Skill,
  SyncPlan,
  SyncRequest,
  Target,
} from '../shared/types';
import { Store } from './store';
import { Vault } from './vault';
import {
  MARKER,
  readTree,
  treeHash,
  stageTree,
  removePrivateTree,
  retireDirectory,
  hashFiles,
  type FileEntry,
} from './files';
import { assertNoLinks, childPath, identity, statOrNull, type PathContext } from './paths';
import { assertWritableTarget, configHash, resolveTargets } from './targets';
import { fail, publicError } from './errors';
import { discoverSkills } from './skills';

export async function fingerprint(destination: string): Promise<string> {
  const st = await statOrNull(destination);
  if (!st) return 'absent';
  if (st.isSymbolicLink()) return `link:${await fs.readlink(destination)}`;
  if (st.isDirectory()) {
    try {
      return `tree:${await treeHash(destination, true)}`;
    } catch {
      return `unsafe:${st.ino}:${st.mtimeMs}`;
    }
  }
  return `file:${st.ino}:${st.size}:${st.mtimeMs}`;
}
export function installId(destination: string): string {
  return createHash('sha256').update(identity(destination)).digest('hex');
}
export async function isOwned(record: InstallRecord | undefined, destination: string): Promise<boolean> {
  if (
    !record ||
    identity(record.path) !== identity(destination) ||
    identity(path.dirname(destination)) !== identity(record.root) ||
    path.basename(destination) !== record.skillId
  )
    return false;
  await assertNoLinks(record.root);
  const st = await statOrNull(destination);
  if (!st) return false;
  if (record.mode === 'symlink') {
    if (!st.isSymbolicLink()) return false;
    const link = path.resolve(path.dirname(destination), await fs.readlink(destination));
    return identity(link) === identity(record.source);
  }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  try {
    await assertNoLinks(destination);
    const markerPath = path.join(destination, MARKER);
    await assertNoLinks(markerPath);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    return (
      marker.token === record.token &&
      marker.skillId === record.skillId &&
      (await treeHash(destination, true)) === record.installedHash
    );
  } catch {
    return false;
  }
}
export class SyncEngine {
  private plans = new Map<string, { plan: SyncPlan; configHash: string }>();
  constructor(
    readonly store: Store,
    readonly ctx: PathContext,
    readonly vault: Vault,
  ) {}
  private async checkReadOnlyCollision(skillId: string, target: Target, targets: Target[]): Promise<void> {
    for (const readOnly of targets.filter((t) => t.readOnly && t.agentKey === target.agentKey)) {
      if (readOnly.error)
        fail(
          'READONLY_SCAN',
          'Cannot inspect a configured read-only source. Resolve its directory error first.',
        );
      if (!readOnly.exists) continue;
      const discovery = await discoverSkills(readOnly.realPath ?? readOnly.path);
      if (discovery.warnings.length)
        fail(
          'READONLY_SCAN',
          'Cannot fully inspect a read-only source. Resolve its scan errors before synchronizing.',
        );
      if (discovery.directories.some((d) => path.basename(d).toLowerCase() === skillId.toLowerCase()))
        fail(
          'READONLY_COLLISION',
          'This Agent already exposes a Skill with the same ID from a read-only source. It cannot be shadowed by synchronization.',
        );
    }
  }
  async preview(request: SyncRequest, config: Config): Promise<SyncPlan> {
    const targets = await resolveTargets(config, this.ctx),
      state = await this.store.loadState();
    const plan: SyncPlan = { id: randomUUID(), createdAt: new Date().toISOString(), items: [] };
    if (request.skillIds.length * request.targetIds.length > 2000)
      fail('LIMIT', 'Select at most 2000 Skill/target combinations per plan.');
    for (const skillId of [...new Set(request.skillIds)])
      for (const targetId of [...new Set(request.targetIds)]) {
        const target = targets.find((t) => t.id === targetId);
        if (!target) fail('TARGET_MISSING', 'Selected target is no longer configured or enabled.');
        const skill = await this.vault.get(skillId),
          dest = path.join(target.path, skillId);
        const agent = config.agents.find((a) => a.key === target.agentKey)!;
        const item: PlanItem = {
          id: randomUUID(),
          skillId,
          targetId,
          destination: dest,
          mode: agent.installationMetadata ? 'copy' : request.mode,
          action: 'install',
          reason: agent.installationMetadata ? 'Installation metadata requires a copy.' : 'New installation.',
          sourceHash: skill.hash,
          targetFingerprint: 'unavailable',
        };
        try {
          await assertWritableTarget(target, targets, config, this.ctx, this.store.protectedRoot);
          item.targetFingerprint = await fingerprint(dest);
          await this.checkReadOnlyCollision(skillId, target, targets);
          if (
            agent.installationMetadata &&
            (await readTree(skill.path)).some(
              (f) => f.name.toLowerCase() === agent.installationMetadata!.filename.toLowerCase(),
            )
          )
            fail(
              'METADATA_COLLISION',
              'Installation metadata would overwrite a Skill file. Choose a different metadata filename.',
            );
          if (target.exists) {
            const collision = (await fs.readdir(target.path)).find(
              (name) => name.toLowerCase() === skillId.toLowerCase() && name !== skillId,
            );
            if (collision)
              fail('CASE_COLLISION', 'A differently cased directory already occupies this Skill name.');
          }
          const record = state.installations[installId(dest)];
          if (item.targetFingerprint !== 'absent') {
            if (!(await isOwned(record, dest)))
              fail('CONFLICT', 'Existing content is external or has changed. It will be preserved.');
            const metadataSame = record.metadataFilename === agent.installationMetadata?.filename;
            if (
              record.hash === skill.hash &&
              record.mode === item.mode &&
              identity(record.source) === identity(skill.path) &&
              metadataSame &&
              (!agent.installationMetadata ||
                (await this.metadataMatches(
                  dest,
                  agent.installationMetadata.values,
                  agent.installationMetadata.filename,
                )))
            ) {
              item.action = 'skip';
              item.reason = 'Already synchronized.';
            } else {
              item.action = 'update';
              item.reason = 'Replace this unchanged managed installation.';
            }
          }
        } catch (e) {
          item.action = 'conflict';
          item.reason = publicError(e).message;
        }
        plan.items.push(item);
      }
    if (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, { plan: structuredClone(plan), configHash: configHash(config) });
    return plan;
  }
  private async metadataMatches(
    dest: string,
    values: Record<string, unknown>,
    filename: string,
  ): Promise<boolean> {
    try {
      return (
        JSON.stringify(JSON.parse(await fs.readFile(path.join(dest, filename), 'utf8')).values) ===
        JSON.stringify(values)
      );
    } catch {
      return false;
    }
  }
  async execute(planId: string): Promise<ResultItem[]> {
    const saved = this.plans.get(planId);
    if (!saved) fail('PLAN_EXPIRED', 'Plan is missing or already executed. Preview again.');
    this.plans.delete(planId);
    const config = await this.store.loadConfig(),
      targets = await resolveTargets(config, this.ctx);
    if (
      configHash(config) !== saved.configHash ||
      Date.now() - Date.parse(saved.plan.createdAt) > 15 * 60 * 1000
    )
      fail('PLAN_EXPIRED', 'Configuration changed or plan expired. Preview again.');
    const result: ResultItem[] = [];
    for (const item of saved.plan.items) {
      const out: ResultItem = {
        id: item.id,
        skillId: item.skillId,
        destination: item.destination,
        status: 'failed',
        message: '',
      };
      try {
        if (item.action === 'conflict') {
          out.status = 'conflict';
          out.message = item.reason;
        } else {
          const target = targets.find((t) => t.id === item.targetId)!;
          await assertWritableTarget(target, targets, config, this.ctx, this.store.protectedRoot);
          await this.checkReadOnlyCollision(item.skillId, target, targets);
          const skill = await this.vault.get(item.skillId);
          if (
            skill.hash !== item.sourceHash ||
            (await fingerprint(item.destination)) !== item.targetFingerprint
          )
            fail('CHANGED', 'Source or destination changed after preview. Preview again.');
          if (item.action === 'skip') {
            out.status = 'skipped';
            out.message = 'Already synchronized.';
          } else {
            await this.install(item, target, skill, config);
            out.status = 'success';
            out.message = 'Synchronized.';
          }
        }
      } catch (e) {
        const error = publicError(e);
        out.status = [
          'CHANGED',
          'CONFLICT',
          'TARGET_OVERLAP',
          'PROTECTED_TARGET',
          'UNSAFE_LINK',
          'READONLY_COLLISION',
          'READONLY_SCAN',
        ].includes(error.code)
          ? 'conflict'
          : 'failed';
        out.message = error.message;
      }
      result.push(out);
    }
    return result;
  }
  private async install(item: PlanItem, target: Target, skill: Skill, config: Config): Promise<void> {
    const destination = await childPath(target.path, skill.id),
      state = await this.store.loadState(),
      id = installId(destination),
      old = state.installations[id];
    const metadata = config.agents.find((a) => a.key === target.agentKey)!.installationMetadata;
    const record: InstallRecord = {
      id,
      skillId: skill.id,
      targetId: target.id,
      root: target.path,
      path: destination,
      source: skill.path,
      mode: item.mode,
      hash: skill.hash,
      installedHash: skill.hash,
      token: randomUUID(),
      installedAt: new Date().toISOString(),
      metadataFilename: metadata?.filename,
    };
    let staged: string, linkContainer: string | undefined;
    if (item.mode === 'copy') {
      const files = await readTree(skill.path);
      if (hashFiles(files) !== item.sourceHash) fail('CHANGED', 'Source changed while staging.');
      files.push({
        name: MARKER,
        bytes: Buffer.from(JSON.stringify({ version: 1, skillId: skill.id, token: record.token })),
        mode: 0o600,
      });
      if (metadata)
        files.push({
          name: metadata.filename,
          bytes: Buffer.from(
            JSON.stringify(
              {
                skillId: skill.id,
                version: skill.version,
                contentHash: skill.hash,
                installedAt: record.installedAt,
                values: metadata.values,
              },
              null,
              2,
            ),
          ),
          mode: 0o600,
        });
      record.installedHash = hashFiles(files);
      staged = await stageTree(target.path, files);
    } else {
      linkContainer = await stageTree(target.path, []);
      staged = path.join(linkContainer, 'link');
      try {
        await fs.symlink(skill.path, staged, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e) {
        await removePrivateTree(target.path, linkContainer);
        throw e;
      }
    }
    let backup: string | undefined;
    try {
      await assertNoLinks(target.path);
      if (
        (await this.vault.get(skill.id)).hash !== item.sourceHash ||
        (await fingerprint(destination)) !== item.targetFingerprint
      )
        fail('CHANGED', 'Source or destination changed during staging.');
      if (item.action === 'update') {
        if (!(await isOwned(old, destination))) fail('CONFLICT', 'Installation ownership changed.');
        backup = path.join(target.path, `.skill-manager-backup-${randomUUID()}`);
        await fs.rename(destination, backup);
      } else if (await statOrNull(destination)) fail('CHANGED', 'Destination appeared after preview.');
      await fs.rename(staged, destination);
      state.installations[id] = record;
      await this.store.saveState(state);
      if (backup) {
        if (old.mode === 'symlink') await fs.unlink(backup);
        else await removePrivateTree(target.path, backup, old.installedHash);
      }
    } catch (e) {
      if (backup && !(await statOrNull(destination))) await fs.rename(backup, destination).catch(() => {});
      throw e;
    } finally {
      if (linkContainer) {
        if (await statOrNull(staged)) await fs.unlink(staged).catch(() => {});
        await removePrivateTree(target.path, linkContainer).catch(() => {});
      } else if (await statOrNull(staged)) await removePrivateTree(target.path, staged).catch(() => {});
    }
  }
  async uninstall(id: string): Promise<void> {
    const state = await this.store.loadState(),
      record = state.installations[id];
    if (!record || id !== installId(record.path)) fail('NOT_MANAGED', 'No valid ownership record exists.');
    const config = await this.store.loadConfig(),
      targets = await resolveTargets(config, this.ctx);
    for (const target of targets.filter((t) => t.readOnly)) {
      const relative = path.relative(identity(target.realPath ?? target.path), identity(record.path));
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
        fail(
          'PROTECTED_TARGET',
          'This installation is now inside a read-only source. Remove that protection explicitly before uninstalling.',
        );
    }
    if (!(await isOwned(record, record.path)))
      fail(
        'CONFLICT',
        'Installation is missing, externally modified or has a different link target. It will not be deleted.',
      );
    if (record.mode === 'symlink') await fs.unlink(record.path);
    else await retireDirectory(record.root, record.path, record.installedHash);
    delete state.installations[id];
    await this.store.saveState(state);
  }
}
