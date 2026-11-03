import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, markdown } from './helpers';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0)) await fn();
});
async function setup() {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await f.importSkill();
  return f;
}
it('previews file changes and installs the exact snapshot even if the source changes again', async () => {
  const f = await setup(),
    skill = path.join(f.source, 'example-skill');
  await fs.writeFile(path.join(skill, 'SKILL.md'), markdown('2.0.0'));
  await fs.writeFile(path.join(skill, 'new.txt'), 'previewed');
  const plan = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  expect(plan.changes).toEqual([
    { path: 'SKILL.md', action: 'modified' },
    { path: 'new.txt', action: 'added' },
  ]);
  await fs.writeFile(path.join(skill, 'SKILL.md'), markdown('3.0.0'));
  const applied = await f.app.request('applySkillUpdate', { planId: plan.id });
  expect(applied.version).toBe('2.0.0');
  expect(applied.hash).toBe(plan.latestHash);
  await expect(f.app.request('applySkillUpdate', { planId: plan.id })).rejects.toThrow('过期');
  expect((await f.app.request('checkUpdate', { id: 'example-skill' })).available).toBe(true);
});
it('blocks outdated configuration and local edits without losing data', async () => {
  const f = await setup();
  await fs.writeFile(path.join(f.source, 'example-skill', 'SKILL.md'), markdown('2.0.0'));
  const plan = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  await f.app.request('saveConfig', { ...f.config, defaultSyncMode: 'symlink' });
  await expect(f.app.request('applySkillUpdate', { planId: plan.id })).rejects.toThrow('变化');
  const next = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  const skill = (await f.app.request('snapshot', undefined)).skills[0];
  await fs.writeFile(path.join(skill.path, 'keep.txt'), 'my edits');
  await expect(f.app.request('applySkillUpdate', { planId: next.id })).rejects.toThrow('变化');
  await expect(f.app.request('previewSkillUpdate', { id: 'example-skill' })).rejects.toThrow(
    '本地库内容已被修改',
  );
  expect(await fs.readFile(path.join(skill.path, 'keep.txt'), 'utf8')).toBe('my edits');
});
it('expires previews and disallows the legacy unpreviewed write command', async () => {
  const f = await setup();
  const plan = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await expect(f.app.request('applySkillUpdate', { planId: plan.id })).rejects.toThrow('过期');
  await expect(f.app.request('updateSkill', { id: 'example-skill' })).rejects.toThrow('先预览');
});
it('shows removed files and warns about live linked targets', async () => {
  const f = await setup();
  await fs.writeFile(path.join(f.source, 'example-skill', 'remove.txt'), 'old');
  const first = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  await f.app.request('applySkillUpdate', { planId: first.id });
  await f.sync('symlink');
  await fs.unlink(path.join(f.source, 'example-skill', 'remove.txt'));
  const next = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  expect(next.linkedTargets).toBe(1);
  expect(next.changes).toContainEqual({ path: 'remove.txt', action: 'removed' });
  await f.app.request('applySkillUpdate', { planId: next.id });
  await expect(fs.stat(path.join(f.target, 'example-skill', 'remove.txt'))).rejects.toThrow();
});
