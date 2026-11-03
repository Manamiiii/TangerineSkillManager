import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packagedEnvironment } from './packaged-environment.mjs';
import { launchPortable } from './portable-launch.mjs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const packagedIndex = process.argv.indexOf('--packaged');
const packagedExecutable = packagedIndex < 0 ? undefined : process.argv[packagedIndex + 1];
const portable = process.argv.includes('--portable');
const publicNetwork = process.argv.includes('--public-network');
let networkResult;
if (portable && !packagedExecutable) throw new Error('--portable requires --packaged.');
if (packagedIndex >= 0 && (!packagedExecutable || !path.isAbsolute(packagedExecutable)))
  throw new Error('--packaged requires the absolute path to a packaged application executable.');
const base = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(path.join(base, 'tsm-desktop-'));
const source = path.join(root, 'source'),
  target = path.join(root, 'home', 'agent-skills'),
  project = path.join(root, 'project');
for (const dir of [path.join(root, 'home'), path.join(source, 'example-skill'), target, project])
  await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
  path.join(source, 'example-skill', 'SKILL.md'),
  '---\nname: Example Skill\ndescription: A local-first desktop acceptance example.\nversion: 1.0.0\nauthor: Community\n---\n\n# Example\nDescribe your approach before editing files.\n',
);
await fs.writeFile(path.join(target, 'keep.txt'), 'unmanaged neighbor');
let env = { ...process.env, SKILL_MANAGER_TEST_MODE: '1', SKILL_MANAGER_TEST_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
// The Windows app must not depend on Node, npm, Git or any other CLI on PATH.
if (process.platform === 'win32') env.PATH = '';
let app;
try {
  await fs.mkdir('test-results', { recursive: true });
  if (packagedExecutable) env = await packagedEnvironment(root, electronPath);
  console.log('Profile preflight complete; launching application.');
  app = portable
    ? await launchPortable(packagedExecutable, env)
    : await electron.launch({
        executablePath: packagedExecutable ?? electronPath,
        args: packagedExecutable ? [] : ['.'],
        env,
        timeout: 30_000,
      });
  app.process().stderr.on('data', (chunk) => process.stderr.write(chunk));
  if (packagedExecutable && !portable) {
    const runtime = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      appData: app.getPath('appData'),
      home: process.getBuiltinModule('os').homedir(),
    }));
    expect(runtime.packaged).toBe(true);
    expect(path.resolve(runtime.appData).toLowerCase()).toBe(path.resolve(env.APPDATA).toLowerCase());
    expect(path.resolve(runtime.home).toLowerCase()).toBe(path.resolve(root, 'home').toLowerCase());
  }
  const page = await app.firstWindow();
  console.log('Application window connected.');
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: '你的 Skill，本地掌控。' })).toBeVisible();
  if (packagedExecutable) {
    const snapshot = await page.evaluate(() => window.skillManager.request('snapshot', undefined));
    expect(snapshot.ok).toBe(true);
    expect(path.dirname(snapshot.value.configPath).toLowerCase()).toBe(
      path.join(env.APPDATA, 'skill-manager').toLowerCase(),
    );
  }
  expect(
    await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.skillManager?.request })),
  ).toEqual({ node: 'undefined', bridge: 'function' });
  const navigate = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '试用内置示例', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear Plan', exact: true })).toBeVisible();
  await expect(fs.stat(path.join(root, 'home', '.agents'))).rejects.toThrow();
  await navigate('Agent');
  await expect(page.getByLabel('Agent 模板', { exact: true })).toHaveValue('codex');
  await page.screenshot({ path: 'test-results/agent-templates.png', fullPage: true });
  await page.getByRole('button', { name: '编辑已有目录配置', exact: true }).click();
  await expect(page.getByLabel('唯一标识')).toHaveValue('generic');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('Agent 模板', { exact: true }).selectOption('claude-code');
  await page.getByRole('button', { name: '使用此模板', exact: true }).click();
  await expect(page.getByLabel('用户级目录', { exact: false })).toHaveValue('~/.claude/skills');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '禁用', exact: true }).click();
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click();
  await expect(page.getByLabel('唯一标识')).toHaveValue(/^agent-[a-f0-9]{8}$/);
  await page.getByLabel('唯一标识').fill('demo');
  await page.getByLabel('显示名称', { exact: true }).fill('Demo Agent');
  await page.getByLabel('用户级目录', { exact: false }).fill('~/agent-skills');
  await page.getByRole('button', { name: '保存 Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo Agent', exact: true })).toBeVisible();
  await navigate('项目');
  await page.getByRole('button', { name: '绑定项目', exact: true }).click();
  await page.getByLabel('项目标识').fill('demo-project');
  await page.getByLabel('项目名称').fill('Demo project');
  await page.getByLabel('项目目录', { exact: true }).fill(project);
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo project', exact: true })).toBeVisible();
  await navigate('来源');
  await page.getByRole('button', { name: '添加来源', exact: true }).click();
  await expect(page.getByLabel('来源标识')).toHaveValue(/^source-[a-f0-9]{8}$/);
  await expect(page.getByLabel('分支 / 标签（可选）')).toHaveCount(0);
  await page.getByLabel('Provider', { exact: true }).selectOption('git');
  await expect(page.getByLabel('分支 / 标签（可选）')).toBeVisible();
  await page.getByLabel('Provider', { exact: true }).selectOption('local');
  await page.getByLabel('来源标识').fill('demo-source');
  await page.getByLabel('显示名称', { exact: true }).fill('Demo source');
  await page.getByLabel('位置', { exact: false }).fill(source);
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await page.getByRole('button', { name: '发现 Skill', exact: true }).click();
  await page.getByRole('button', { name: '导入本地库', exact: true }).click();
  await expect(page.getByRole('button', { name: '已在本地库', exact: true })).toBeVisible();
  await navigate('本地库');
  await fs.writeFile(
    path.join(source, 'example-skill', 'SKILL.md'),
    '---\nname: Example Skill\ndescription: Updated test skill\nversion: 2.0.0\n---\n# Previewed update\n',
  );
  await page.getByRole('button', { name: '检查更新', exact: true }).last().click();
  await page.getByRole('button', { name: '预览更新', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '预览 Skill 更新' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('SKILL.md', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/skill-update-preview.png', fullPage: true });
  await fs.writeFile(
    path.join(source, 'example-skill', 'SKILL.md'),
    '---\nname: Example Skill\ndescription: Newer remote content\nversion: 3.0.0\n---\n# Newer update\n',
  );
  await page.getByRole('button', { name: '应用此更新', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '预览 Skill 更新' })).toHaveCount(0);
  await expect(page.getByText('Updated test skill', { exact: true })).toBeVisible();
  await page.getByLabel('选择 example-skill', { exact: true }).check();
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/library.png', fullPage: true });
  if (process.argv.includes('--docs')) {
    expect(await page.locator('body').innerText()).not.toContain(os.userInfo().username);
    await fs.mkdir('docs/images', { recursive: true });
    await page.screenshot({ path: 'docs/images/library.png', fullPage: true });
  }
  await navigate('同步');
  for (const checkbox of await page.locator('.target-card input[type=checkbox]').all())
    await checkbox.check();
  await page.getByRole('button', { name: '预览同步计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '同步计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '执行计划', exact: true }).click();
  await expect(page.locator('.result-row .badge.green')).toHaveCount(2);
  expect(await fs.readFile(path.join(target, 'example-skill', 'SKILL.md'), 'utf8')).toContain('2.0.0');
  expect(
    await fs.readFile(path.join(project, '.agents', 'skills', 'example-skill', 'SKILL.md'), 'utf8'),
  ).toContain('Example');
  await page.screenshot({ path: 'test-results/sync.png', fullPage: true });
  if (process.argv.includes('--docs')) {
    expect(await page.locator('body').innerText()).not.toContain(os.userInfo().username);
    await page.screenshot({ path: 'docs/images/sync.png', fullPage: true });
  }
  await page.getByRole('button', { name: '预览同步计划', exact: true }).click();
  await expect(page.getByRole('button', { name: '执行计划', exact: true })).toBeDisabled();
  await page.getByText('扫描详情与安装记录', { exact: false }).click();
  await page.getByRole('button', { name: '卸载副本', exact: true }).first().click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '卸载副本', exact: true })).toHaveCount(1);
  expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('unmanaged neighbor');
  await navigate('来源');
  await page.getByText('发现 Skill · 多来源搜索与市场入口', { exact: true }).click();
  await expect(page.getByRole('button', { name: '搜索选中来源', exact: true })).toBeVisible();
  await expect(page.getByLabel('SkillsMP（实验性）', { exact: true })).not.toBeChecked();
  await page.screenshot({ path: 'test-results/market-discovery.png', fullPage: true });
  await navigate('设置');
  await expect(page.getByLabel('域名解析方式', { exact: true })).toHaveValue('system');
  await page.getByLabel('域名解析方式', { exact: true }).selectOption('cloudflare');
  await page.getByRole('button', { name: '保存网络设置', exact: true }).click();
  await expect(page.getByText('当前已保存：Cloudflare HTTPS DNS', { exact: true })).toBeVisible();
  await page.reload();
  await navigate('设置');
  await expect(page.getByLabel('域名解析方式', { exact: true })).toHaveValue('cloudflare');
  if (publicNetwork) {
    // Explicit flag only: real main-process requests, saved configuration, no DNS monkeypatch.
    await page.getByRole('button', { name: '检查应用更新', exact: true }).click();
    await expect(page.locator('[aria-label="应用版本更新"] [role="status"]')).toBeVisible({ timeout: 20000 });
    networkResult = await page.evaluate(async () => {
      const call = async (name, input) => {
        const response = await window.skillManager.request(name, input);
        if (!response.ok) throw new Error(response.error.code + ': ' + response.error.message);
        return response.value;
      };
      const markets = await call('searchMarkets', { query: 'testing', markets: ['github', 'skillsmp'] });
      if (markets.sources.some((s) => s.status !== 'success' || s.count < 1))
        throw new Error('Real market search failed: ' + JSON.stringify(markets.sources));
      const { config } = await call('snapshot');
      config.providers.push({
        key: 'public-test',
        kind: 'git',
        name: 'Public test',
        enabled: true,
        location: 'https://github.com/obra/superpowers.git',
        ref: 'main',
        subdirectory: 'skills/writing-plans',
        offline: false,
      });
      await call('saveConfig', config);
      const candidates = await call('discover', { sourceKey: 'public-test' });
      if (candidates.length !== 1 || candidates[0].id !== 'writing-plans')
        throw new Error('Unexpected Git discovery result');
      const skill = await call('importSkill', { sourceKey: 'public-test', relativePath: '.' });
      if (!/^[a-f0-9]{40}$/.test(skill.source?.commit ?? ''))
        throw new Error('Missing Git commit provenance');
      const update = await call('checkUpdate', { id: skill.id });
      if (update.available) throw new Error('Git content changed during acceptance; rerun explicitly.');
      const release = await call('checkAppUpdate');
      return {
        markets: markets.sources.map((s) => ({ key: s.key, count: s.count })),
        git: 'discovery, import, commit provenance, unchanged update',
        release: release.status,
      };
    });
    console.log('Real configured application network checks:', JSON.stringify(networkResult));
  }
  await page.getByLabel('域名解析方式', { exact: true }).selectOption('system');
  await page.getByRole('button', { name: '保存网络设置', exact: true }).click();
  await expect(page.getByText('当前已保存：系统 DNS', { exact: true })).toBeVisible();
  const reverted = await page.evaluate(() => window.skillManager.request('snapshot', undefined));
  expect(reverted.value.config.network).toBeUndefined();
  await expect(page.getByRole('button', { name: '检查应用更新', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-updates.png', fullPage: true });
  const invalidLink = await page.evaluate(() =>
    window.skillManager.request('openExternal', { destination: 'repository', url: 'file:///forbidden' }),
  );
  expect(invalidLink.ok).toBe(false);
  expect(errors).toEqual([]);
  await fs.writeFile(
    `test-results/${portable ? 'portable' : packagedExecutable ? 'packaged' : 'desktop'}${publicNetwork ? '-network' : ''}-result.json`,
    JSON.stringify(
      {
        passed: true,
        networkResult,
        artifact: packagedExecutable
          ? {
              filename: path.basename(packagedExecutable),
              sha256: createHash('sha256')
                .update(await fs.readFile(packagedExecutable))
                .digest('hex'),
              portable,
            }
          : undefined,
        runtime: packagedExecutable
          ? 'packaged application, isolated process environment (not a clean VM)'
          : 'development Electron',
        checks: [
          'isolated renderer',
          'agent creation',
          'project binding',
          'local provider discovery',
          'vault import',
          'preview',
          'user and project copy sync',
          'idempotent preview',
          'safe uninstall',
          'no renderer errors',
          'opt-in bundled sample without Agent writes',
          'automatically generated identifiers',
          'capability-driven source fields',
          'Agent templates and shared-directory reuse',
          'previewed Skill update applies frozen content',
          'opt-in market search controls',
          'application update entry',
          'external URL IPC rejection',
          'explicit DNS opt-in persists across reload',
          'system DNS restore removes optional configuration',
          ...(publicNetwork
            ? [
                'real release API through configured app',
                'real multi-market search through configured app',
                'real Git import and update through configured app',
              ]
            : []),
          ...(process.platform === 'win32' ? ['Windows runtime without CLI search path'] : []),
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `Desktop acceptance passed: ${(process.platform === 'win32' ? 21 : 20) + (publicNetwork ? 3 : 0)} checks, ${packagedExecutable ? 'packaged application' : 'development Electron'}, isolated temporary user data.`,
  );
} catch (error) {
  console.error('Desktop acceptance failed:', error.message);
  throw error;
} finally {
  if (app) {
    const child = app.process();
    let timer;
    const closed = await Promise.race([
      app.close().then(
        () => true,
        () => false,
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 5000);
      }),
    ]);
    clearTimeout(timer);
    if (!closed && process.platform === 'win32' && child.exitCode === null) {
      // Only terminate the child process tree created by this test, never another app instance.
      await promisify(execFile)(
        path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 },
      ).catch(() => {});
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  }
  if (path.dirname(root) !== base || !path.basename(root).startsWith('tsm-desktop-'))
    throw new Error('Invalid cleanup scope');
  // Native input methods may create locked files inside a redirected Windows profile.
  // Remove only our test data, leaving host-managed caches to the operating system.
  const cleanup = packagedExecutable
    ? [
        'source',
        'project',
        'home/agent-skills',
        'home/AppData/Roaming/skill-manager',
        'home/AppData/Roaming/tangerine-skill-manager',
        'probe.cjs',
        'environment-probe.json',
      ].map((relative) => path.join(root, relative))
    : [root];
  for (const entry of cleanup)
    await fs
      .rm(entry, { recursive: true, force: true })
      .catch(() => console.warn('Temporary test data remains locked; cleanup deferred.'));
  console.log('Test application closed; test data cleanup finished.');
}
