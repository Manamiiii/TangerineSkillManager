import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Config } from '../shared/config';
import type { Target } from '../shared/types';
import {
  expandPath,
  identity,
  overlaps,
  assertNoLinks,
  statOrNull,
  resolvedOrFuture,
  type PathContext,
} from './paths';
import { fail, publicError } from './errors';
export async function resolveTargets(config: Config, ctx: PathContext): Promise<Target[]> {
  const targets: Target[] = [];
  for (const agent of [...config.agents].sort((a, b) => a.order - b.order)) {
    if (!agent.enabled) continue;
    const add = async (
      template: string,
      scope: Target['scope'],
      index: number,
      project?: Config['projects'][number],
    ) => {
      const target: Target = {
        id: `${agent.key}:${scope}:${project?.key ?? '-'}:${index}`,
        agentKey: agent.key,
        agentName: agent.name,
        scope,
        projectKey: project?.key,
        path: template,
        template,
        exists: false,
        readOnly: scope === 'readonly',
      };
      try {
        const workspace = project ? expandPath(project.root, ctx) : undefined;
        target.path = expandPath(template, { ...ctx, workspace, base: workspace ?? ctx.base });
        const st = await statOrNull(target.path);
        target.exists = st !== null;
        if (st && !st.isDirectory() && !st.isSymbolicLink())
          fail('INVALID_PATH', 'Configured target is not a directory.');
        target.realPath = await resolvedOrFuture(target.path);
        if (!target.readOnly) await assertNoLinks(target.path);
      } catch (e) {
        target.error = publicError(e).message;
      }
      targets.push(target);
    };
    for (const [i, t] of agent.userDirectories.entries()) await add(t, 'user', i);
    for (const p of config.projects)
      for (const [i, t] of agent.projectDirectories.entries()) await add(t, 'project', i, p);
    for (const [i, t] of agent.extraDirectories.entries()) await add(t, 'extra', i);
    for (const [i, t] of agent.readOnlySources.entries()) {
      if (t.includes('{workspace}')) for (const p of config.projects) await add(t, 'readonly', i, p);
      else await add(t, 'readonly', i);
    }
  }
  return targets;
}
export async function assertWritableTarget(
  target: Target,
  targets: Target[],
  config: Config,
  ctx: PathContext,
  stateDir: string,
): Promise<void> {
  if (target.readOnly || target.error)
    fail('PROTECTED_TARGET', target.error ?? 'Read-only sources cannot be synchronized.');
  await assertNoLinks(target.path);
  const root = await resolvedOrFuture(target.path),
    vault = await resolvedOrFuture(expandPath(config.vault.root, ctx));
  if (
    overlaps(root, vault) ||
    overlaps(root, stateDir) ||
    identity(root) === identity(path.parse(root).root) ||
    identity(root) === identity(ctx.home)
  )
    fail('PROTECTED_TARGET', 'Target overlaps the library, app data, home root or filesystem root.');
  for (const other of targets) {
    if (other.id !== target.id && overlaps(root, other.realPath ?? other.path))
      fail(
        'TARGET_OVERLAP',
        'Target overlaps another configured directory, including read-only sources. Configure one distinct root per target.',
      );
  }
  for (const p of config.providers.filter((p) => p.kind === 'local' && p.location)) {
    const source = await resolvedOrFuture(expandPath(p.location, ctx));
    if (overlaps(root, source))
      fail('PROTECTED_SOURCE', 'Synchronization cannot write into or above a configured local source.');
  }
}
export function configHash(c: Config): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex');
}
