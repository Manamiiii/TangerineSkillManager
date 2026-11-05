import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Config } from '../shared/config';
import type { Provenance, SkillUpdatePlan } from '../shared/types';
import type { Artifact } from './providers';
import { Vault } from './vault';
import { readTree, hashFiles, stageTree, removePrivateTree, type FileEntry } from './files';
import { readSkill } from './skills';
import { configHash } from './targets';
import { identity } from './paths';
import { fail } from './errors';

interface Prepared {
  plan: SkillUpdatePlan;
  files: FileEntry[];
  config: string;
  source: Provenance;
  previousSource: string | undefined;
}
export class SkillUpdates {
  private plans = new Map<string, Prepared>();
  private prune() {
    for (const [id, p] of this.plans) if (Date.parse(p.plan.expiresAt) <= Date.now()) this.plans.delete(id);
  }
  async preview(vault: Vault, config: Config, id: string, artifact: Artifact): Promise<SkillUpdatePlan> {
    this.prune();
    const current = await vault.get(id),
      state = await vault.store.loadState();
    if (vault.records(state)[id]?.hash !== current.hash)
      fail('CONFLICT', '本地库内容已被修改；请先保留或整理本地修改，再检查更新。');
    const incoming = await readSkill(artifact.directory, id, true);
    const before = await readTree(current.path),
      files = await readTree(artifact.directory, false, true);
    if (hashFiles(before) !== current.hash || hashFiles(files) !== incoming.hash)
      fail('CHANGED', '内容在预览期间发生变化，请重试。');
    const a = new Map(before.map((f) => [f.name, f])),
      b = new Map(files.map((f) => [f.name, f]));
    const changes: SkillUpdatePlan['changes'] = [];
    for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const old = a.get(name),
        next = b.get(name);
      if (!old) changes.push({ path: name, action: 'added' });
      else if (!next) changes.push({ path: name, action: 'removed' });
      else if (!!old.directory !== !!next.directory || !old.bytes.equals(next.bytes))
        changes.push({ path: name, action: 'modified' });
    }
    const plan: SkillUpdatePlan = {
      id: randomUUID(),
      skillId: id,
      currentHash: current.hash,
      latestHash: incoming.hash,
      commit: artifact.provenance.commit,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      linkedTargets: Object.values(state.installations).filter(
        (i) => i.mode === 'symlink' && identity(i.source) === identity(current.path),
      ).length,
      changes,
    };
    // At most four bounded Skill trees in memory. Superseded previews are deliberately invalidated.
    for (const [key, p] of this.plans) if (p.plan.skillId === id) this.plans.delete(key);
    if (this.plans.size >= 4) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, {
      plan,
      files,
      config: configHash(config),
      source: structuredClone(artifact.provenance),
      previousSource: JSON.stringify(current.source),
    });
    return structuredClone(plan);
  }
  async apply(vault: Vault, config: Config, planId: string) {
    this.prune();
    const prepared = this.plans.get(planId);
    if (!prepared) fail('PLAN_EXPIRED', '更新预览已过期、被替换或已执行，请重新预览。');
    this.plans.delete(planId);
    const { plan } = prepared,
      current = await vault.get(plan.skillId);
    if (
      configHash(config) !== prepared.config ||
      current.hash !== plan.currentHash ||
      JSON.stringify(current.source) !== prepared.previousSource
    )
      fail('CHANGED', '配置、来源记录或本地内容已变化，请重新预览更新。');
    const cache = vault.store.updateCache;
    const staged = await stageTree(cache, prepared.files);
    try {
      if ((await readSkill(staged, plan.skillId)).hash !== plan.latestHash)
        fail('CHANGED', '更新快照校验失败，请重新预览。');
      return await vault.import(staged, prepared.source, plan.skillId, true);
    } finally {
      await removePrivateTree(cache, staged);
    }
  }
}
