import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, markdown } from './helpers';
import { treeHash, MARKER } from '../src/core/files';
import { parseSkillMarkdown } from '../src/core/skills';
import { ApplicationService } from '../src/core/service';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0)) await fn();
});
async function setup() {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await f.importSkill();
  return f;
}
async function update(f: Awaited<ReturnType<typeof fixture>>) {
  const plan = await f.app.request('previewSkillUpdate', { id: 'example-skill' });
  return f.app.request('applySkillUpdate', { planId: plan.id });
}
it('imports the opt-in bundled example without configuring sources or writing agent directories', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  const app = new ApplicationService(
    path.join(f.data, 'onboarding'),
    f.home,
    undefined,
    path.resolve('examples/clear-plan'),
  );
  await app.request('snapshot', undefined);
  const skill = await app.request('importExample', undefined);
  expect(skill.id).toBe('clear-plan');
  expect(skill.source?.provider).toBe('bundled');
  const snapshot = await app.request('snapshot', undefined);
  expect(snapshot.config.providers).toEqual([]);
  expect(snapshot.installations).toEqual([]);
  await expect(fs.stat(path.join(f.home, '.agents'))).rejects.toThrow();
  await fs.appendFile(path.join(skill.path, 'SKILL.md'), '\nUser change');
  await expect(app.request('importExample', undefined)).rejects.toThrow('externally modified');
});
it('compares installations with current library content after external edits', async () => {
  const f = await setup();
  await f.sync();
  const snapshot = await f.app.request('snapshot', undefined);
  await fs.appendFile(path.join(snapshot.vaultPath, 'example-skill', 'SKILL.md'), '\nNew local instructions');
  expect((await f.app.request('snapshot', undefined)).scans.find((s) => s.scope === 'user')?.status).toBe(
    'outdated',
  );
  await f.sync();
  expect((await f.app.request('snapshot', undefined)).scans.find((s) => s.scope === 'user')?.status).toBe(
    'managed',
  );
});
it('allows independent library work when an Agent target becomes invalid', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  await fs.rename(f.target, path.join(f.root, 'old-target'));
  await fs.writeFile(f.target, 'external file');
  expect((await f.importSkill()).id).toBe('example-skill');
  const snapshot = await f.app.request('snapshot', undefined);
  expect(snapshot.warnings.length).toBeGreaterThan(0);
  expect((await f.preview()).items[0].action).toBe('conflict');
  expect(await fs.readFile(f.target, 'utf8')).toBe('external file');
});
it('parses Markdown front matter and hashes nested file content deterministically', async () => {
  expect(parseSkillMarkdown(markdown()).version).toBe('1.0.0');
  expect(parseSkillMarkdown('No front matter').metadata).toEqual({});
  expect(() => parseSkillMarkdown('---\nname: x\nname: y\n---\n')).toThrow();
  const f = await setup(),
    source = path.join(f.source, 'example-skill');
  const original = await treeHash(source);
  expect(await treeHash(source)).toBe(original);
  await fs.mkdir(path.join(source, 'scripts'));
  await fs.writeFile(path.join(source, 'scripts', 'extra.txt'), 'extra');
  expect(await treeHash(source)).not.toBe(original);
});
it('runs the clean-machine local import, project binding, scan and synchronization flow', async () => {
  const f = await fixture();
  cleanup.push(f.cleanup);
  expect((await f.app.request('discover', { sourceKey: 'local' }))[0].id).toBe('example-skill');
  const imported = await f.importSkill();
  expect(imported.source?.provider).toBe('local');
  const plan = await f.app.request('preview', {
    skillIds: [imported.id],
    targetIds: ['test:user:-:0', 'test:project:example:0'],
    mode: 'copy',
  });
  expect(plan.items.map((i) => i.action)).toEqual(['install', 'install']);
  expect((await f.app.request('execute', { planId: plan.id })).map((i) => i.status)).toEqual([
    'success',
    'success',
  ]);
  const snapshot = await f.app.request('snapshot', undefined);
  expect(snapshot.scans.filter((s) => s.status === 'managed')).toHaveLength(3);
  expect(snapshot.targets.find((t) => t.scope === 'project')?.exists).toBe(true);
});
it('is idempotent and executes each preview once', async () => {
  const f = await setup();
  expect((await f.sync())[0].status).toBe('success');
  const plan = await f.preview();
  expect(plan.items[0].action).toBe('skip');
  expect((await f.app.request('execute', { planId: plan.id }))[0].status).toBe('skipped');
  await expect(f.app.request('execute', { planId: plan.id })).rejects.toThrow('already executed');
});
it('does not overwrite existing files or unknown directories', async () => {
  const f = await setup(),
    destination = path.join(f.target, 'example-skill');
  await fs.writeFile(destination, 'external');
  expect((await f.preview()).items[0].action).toBe('conflict');
  expect((await f.sync())[0].status).toBe('conflict');
  expect(await fs.readFile(destination, 'utf8')).toBe('external');
  await fs.unlink(destination);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'keep.txt'), 'preserve');
  expect((await f.preview()).items[0].action).toBe('conflict');
  expect(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('preserve');
});
it('refuses changed sources and targets after preview', async () => {
  const f = await setup(),
    plan = await f.preview();
  await fs.mkdir(path.join(f.target, 'example-skill'));
  expect((await f.app.request('execute', { planId: plan.id }))[0].status).toBe('conflict');
  const projectPlan = await f.app.request('preview', {
    skillIds: ['example-skill'],
    targetIds: ['test:project:example:0'],
    mode: 'copy',
  });
  const snapshot = await f.app.request('snapshot', undefined);
  await fs.appendFile(path.join(snapshot.vaultPath, 'example-skill', 'SKILL.md'), '\nChanged');
  expect((await f.app.request('execute', { planId: projectPlan.id }))[0].status).toBe('conflict');
});
it('reports a partial conflict while installing independent valid destinations', async () => {
  const f = await setup();
  const plan = await f.app.request('preview', {
    skillIds: ['example-skill'],
    targetIds: ['test:user:-:0', 'test:project:example:0'],
    mode: 'copy',
  });
  await fs.writeFile(path.join(f.project, '.agents'), 'file blocks directory creation');
  const results = await f.app.request('execute', { planId: plan.id });
  expect(results.map((r) => r.status)).toEqual(['success', 'conflict']);
  expect(await fs.readFile(path.join(f.project, '.agents'), 'utf8')).toBe('file blocks directory creation');
});
it('reports an I/O failure per item and continues the plan', async () => {
  const f = await setup();
  const plan = await f.app.request('preview', {
    skillIds: ['example-skill'],
    targetIds: ['test:user:-:0', 'test:project:example:0'],
    mode: 'copy',
  });
  const rename = fs.rename;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === path.join(f.target, 'example-skill'))
      throw Object.assign(new Error('fixture permission failure'), { code: 'EACCES' });
    return rename(from, to);
  });
  const results = await f.app.request('execute', { planId: plan.id });
  expect(results.map((r) => r.status)).toEqual(['failed', 'success']);
  expect(results[0].message).toContain('Permission denied');
});
it('uses copy when metadata is required and detects metadata collisions', async () => {
  const f = await setup();
  f.config.agents[0].installationMetadata = { filename: 'installation.json', values: { channel: 'local' } };
  await f.app.request('saveConfig', f.config);
  expect((await f.preview('symlink')).items[0].mode).toBe('copy');
  await f.sync('symlink');
  expect(
    JSON.parse(await fs.readFile(path.join(f.target, 'example-skill', 'installation.json'), 'utf8')).values
      .channel,
  ).toBe('local');
  const snap = await f.app.request('snapshot', undefined);
  await f.app.request('uninstall', { id: snap.installations[0].id });
  await fs.writeFile(path.join(f.source, 'example-skill', 'installation.json'), 'original');
  await update(f);
  expect((await f.preview()).items[0].action).toBe('conflict');
});
it('checks updates, updates owned copies, and reports outdated/missing installs', async () => {
  const f = await setup();
  await f.sync();
  expect((await f.app.request('checkUpdate', { id: 'example-skill' })).available).toBe(false);
  await fs.writeFile(path.join(f.source, 'example-skill', 'SKILL.md'), markdown('2.0.0'));
  expect((await f.app.request('checkUpdate', { id: 'example-skill' })).available).toBe(true);
  await update(f);
  expect((await f.app.request('snapshot', undefined)).scans.some((s) => s.status === 'outdated')).toBe(true);
  expect((await f.preview()).items[0].action).toBe('update');
  await f.sync();
  expect(await fs.readFile(path.join(f.target, 'example-skill', 'SKILL.md'), 'utf8')).toContain('2.0.0');
  await fs.rename(path.join(f.target, 'example-skill'), path.join(f.target, 'moved'));
  expect((await f.app.request('snapshot', undefined)).scans.some((s) => s.status === 'missing')).toBe(true);
});
it('blocks managed-copy deletion after edits or marker tampering', async () => {
  const f = await setup();
  await f.sync();
  const snap = await f.app.request('snapshot', undefined),
    record = snap.installations[0];
  await fs.writeFile(path.join(record.path, 'external.txt'), 'important');
  await expect(f.app.request('uninstall', { id: record.id })).rejects.toThrow('externally modified');
  expect(await fs.readFile(path.join(record.path, 'external.txt'), 'utf8')).toBe('important');
  await fs.unlink(path.join(record.path, 'external.txt'));
  await fs.writeFile(path.join(record.path, MARKER), '{}');
  await expect(f.app.request('uninstall', { id: record.id })).rejects.toThrow();
});
it('does not trust a copied marker without its private ownership record', async () => {
  const f = await setup();
  await f.sync();
  const snapshot = await f.app.request('snapshot', undefined),
    other = snapshot.targets.find((t) => t.scope === 'project')!;
  await fs.mkdir(other.path, { recursive: true });
  await fs.cp(path.join(f.target, 'example-skill'), path.join(other.path, 'example-skill'), {
    recursive: true,
  });
  const plan = await f.app.request('preview', {
    skillIds: ['example-skill'],
    targetIds: [other.id],
    mode: 'copy',
  });
  expect(plan.items[0].action).toBe('conflict');
});
it('removes only the explicitly selected managed content and preserves neighbors', async () => {
  const f = await setup();
  await f.sync();
  const snap = await f.app.request('snapshot', undefined);
  await fs.writeFile(path.join(f.target, 'keep.txt'), 'untouched');
  await f.app.request('uninstall', { id: snap.installations[0].id });
  expect(await fs.readFile(path.join(f.target, 'keep.txt'), 'utf8')).toBe('untouched');
  await f.app.request('removeSkill', { id: 'example-skill' });
  expect((await f.app.request('snapshot', undefined)).skills).toHaveLength(0);
  expect(await fs.readFile(path.join(f.source, 'example-skill', 'SKILL.md'), 'utf8')).toContain('Example');
});
it('creates a symlink, protects foreign/broken links and unlinks without deleting the source', async () => {
  const f = await setup();
  expect((await f.sync('symlink'))[0].status).toBe('success');
  const snap = await f.app.request('snapshot', undefined),
    record = snap.installations[0];
  expect((await fs.lstat(record.path)).isSymbolicLink()).toBe(true);
  await expect(f.app.request('removeSkill', { id: 'example-skill' })).rejects.toThrow('symlink');
  await fs.unlink(record.path);
  await fs.symlink(f.source, record.path, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.app.request('uninstall', { id: record.id })).rejects.toThrow();
  expect((await f.preview()).items[0].action).toBe('conflict');
  await fs.unlink(record.path);
  await fs.symlink(
    path.join(f.root, 'missing'),
    record.path,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect((await f.preview()).items[0].action).toBe('conflict');
  await fs.unlink(record.path);
  await fs.symlink(record.source, record.path, process.platform === 'win32' ? 'junction' : 'dir');
  await f.app.request('uninstall', { id: record.id });
  expect(await fs.readFile(path.join(record.source, 'SKILL.md'), 'utf8')).toContain('Example');
});
it('rejects source links, parent junctions, read-only roots and overlapping destinations', async () => {
  const f = await setup();
  const linked = path.join(f.source, 'example-skill', 'linked');
  await fs.symlink(f.project, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(update(f)).rejects.toThrow('regular files');
  await fs.unlink(linked);
  f.config.agents[0].readOnlySources = [f.target];
  await f.app.request('saveConfig', f.config);
  expect((await f.preview()).items[0].action).toBe('conflict');
  const readonly = await f.app.request('preview', {
    skillIds: ['example-skill'],
    targetIds: ['test:readonly:-:0'],
    mode: 'copy',
  });
  expect(readonly.items[0].action).toBe('conflict');
  f.config.agents[0].readOnlySources = [];
  await f.app.request('saveConfig', f.config);
  const plan = await f.preview();
  await fs.rename(f.target, path.join(f.root, 'target-old'));
  await fs.symlink(f.source, f.target, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await f.app.request('execute', { planId: plan.id }))[0].status).toBe('conflict');
});
it('preserves externally added hidden Git content on uninstall', async () => {
  const f = await setup();
  await f.sync();
  const snap = await f.app.request('snapshot', undefined),
    record = snap.installations[0];
  await fs.mkdir(path.join(record.path, '.git'));
  await fs.writeFile(path.join(record.path, '.git', 'important'), 'keep');
  await expect(f.app.request('uninstall', { id: record.id })).rejects.toThrow();
  expect(await fs.readFile(path.join(record.path, '.git', 'important'), 'utf8')).toBe('keep');
});
it('preserves empty directories and treats externally added directories as modifications', async () => {
  const f = await setup();
  await fs.mkdir(path.join(f.source, 'example-skill', 'empty'));
  await update(f);
  await f.sync();
  expect((await fs.stat(path.join(f.target, 'example-skill', 'empty'))).isDirectory()).toBe(true);
  const snapshot = await f.app.request('snapshot', undefined),
    record = snapshot.installations[0];
  await fs.mkdir(path.join(record.path, 'external-empty'));
  await expect(f.app.request('uninstall', { id: record.id })).rejects.toThrow('externally modified');
  expect((await fs.stat(path.join(record.path, 'external-empty'))).isDirectory()).toBe(true);
});
it('detects new read-only name collisions after preview and blocks uninstall in protected roots', async () => {
  const f = await setup(),
    readOnly = path.join(f.root, 'readonly');
  await fs.mkdir(readOnly);
  f.config.agents[0].readOnlySources = [readOnly];
  await f.app.request('saveConfig', f.config);
  const plan = await f.preview();
  await fs.mkdir(path.join(readOnly, 'example-skill'));
  await fs.writeFile(path.join(readOnly, 'example-skill', 'SKILL.md'), markdown());
  expect((await f.app.request('execute', { planId: plan.id }))[0].status).toBe('conflict');
  expect((await f.preview()).items[0].action).toBe('conflict');
  f.config.agents[0].readOnlySources = [];
  await f.app.request('saveConfig', f.config);
  await f.sync();
  const snapshot = await f.app.request('snapshot', undefined);
  f.config.agents[0].readOnlySources = [f.target];
  await f.app.request('saveConfig', f.config);
  await expect(f.app.request('uninstall', { id: snapshot.installations[0].id })).rejects.toThrow('read-only');
});
it('invalidates preview when config changes and rejects forged operations at the service boundary', async () => {
  const f = await setup(),
    plan = await f.preview();
  f.config.agents[0].name = 'Renamed';
  await f.app.request('saveConfig', f.config);
  await expect(f.app.request('execute', { planId: plan.id })).rejects.toThrow('missing');
  await expect(f.app.request('execute', { planId: plan.id, items: [] })).rejects.toThrow();
  await expect(
    f.app.request('preview', { skillIds: ['../escape'], targetIds: ['test:user:-:0'], mode: 'copy' }),
  ).rejects.toThrow();
});
