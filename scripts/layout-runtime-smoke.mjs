import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { packagedEnvironment } from './packaged-environment.mjs';

assert.equal(process.platform, 'win32');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : electronPath;
const args = process.argv[2] ? [] : ['.'];
const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tsm-layout-runtime-'));
const env = await packagedEnvironment(root, electronPath);
const moduleFile = path.join(root, 'fixture.cjs');
await build({
  stdin: {
    contents:
      "export { ApplicationService } from './src/core/service'; export { windowsLayout } from './src/desktop/data-layout';",
    resolveDir: process.cwd(),
  },
  outfile: moduleFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
});
const { ApplicationService, windowsLayout } = createRequire(import.meta.url)(moduleFile);
const layout = windowsLayout(env.LOCALAPPDATA, env.APPDATA);
const old = new ApplicationService(
  env.APPDATA,
  env.USERPROFILE,
  undefined,
  path.resolve('examples/clear-plan'),
);
const original = await old.request('snapshot');
const config = original.config;
config.agents[0].userDirectories = [path.join(root, 'copy-target'), path.join(root, 'link-target')];
config.agents[0].projectDirectories = [];
await old.request('saveConfig', config);
await old.request('importExample');
const initial = await old.request('snapshot');
for (const [index, mode] of ['copy', 'symlink'].entries()) {
  const plan = await old.request('preview', {
    skillIds: ['clear-plan'],
    targetIds: [initial.targets[index].id],
    mode,
  });
  assert.equal((await old.request('execute', { planId: plan.id }))[0].status, 'success');
}
const stateBytes = await fs.readFile(old.store.statePath);
const configBytes = await fs.readFile(old.store.configPath);
const helper = path.join(root, 'legacy.cjs');
await fs.writeFile(
  helper,
  `const {app}=require('electron'); const fs=require('node:fs'); const path=require('node:path');
app.setPath('userData',path.join(app.getPath('appData'),'tangerine-skill-manager'));
const locked=app.requestSingleInstanceLock(); fs.writeFileSync(process.env.TSM_LOCK_RESULT,JSON.stringify({locked}));
if(!locked) app.quit(); else {app.whenReady().then(()=>{}); setInterval(()=>{},1000);}`,
);
env.TSM_LOCK_RESULT = path.join(root, 'lock-result.json');
const run = promisify(execFile);
let app, legacy;
const checks = [];
async function call(page, command, input) {
  const result = await page.evaluate(([c, i]) => window.skillManager.request(c, i), [command, input]);
  assert.ok(result.ok, command);
  return result.value;
}
try {
  legacy = await electron.launch({ executablePath: electronPath, args: [helper], env });
  await legacy.evaluate(({ app }) => app.isReady());
  assert.deepEqual(JSON.parse(await fs.readFile(env.TSM_LOCK_RESULT, 'utf8')), { locked: true });
  await run(executable, [...args, '--migrate-data-layout'], { env, windowsHide: true, timeout: 15000 });
  assert.equal(
    await fs.stat(layout.root).then(
      () => true,
      () => false,
    ),
    false,
  );
  await legacy.close();
  legacy = undefined;
  checks.push('actual legacy Electron lock blocks migration without touching destination');
  app = await electron.launch({ executablePath: executable, args: [...args, '--migrate-data-layout'], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.skillManager?.request === 'function');
  const runtime = await app.evaluate(({ app }) =>
    Object.fromEntries(
      ['userData', 'sessionData', 'temp', 'logs', 'crashDumps'].map((k) => [k, app.getPath(k)]),
    ),
  );
  for (const [key, expected] of Object.entries({
    userData: layout.profile,
    sessionData: layout.session,
    temp: layout.temp,
    logs: layout.logs,
    crashDumps: layout.crash,
  }))
    assert.equal(path.resolve(runtime[key]).toLowerCase(), path.resolve(expected).toLowerCase());
  const snapshot = await call(page, 'snapshot');
  assert.equal(snapshot.configPath, path.join(layout.config, 'config.json'));
  assert.equal(snapshot.vaultPath, initial.vaultPath);
  assert.equal(snapshot.installations.length, 2);
  assert.deepEqual(await fs.readFile(path.join(layout.storage, 'state.json')), stateBytes);
  assert.deepEqual(await fs.readFile(path.join(layout.legacy, 'config.pre-tangerine.json')), configBytes);
  for (const target of snapshot.targets) {
    const plan = await call(page, 'preview', {
      skillIds: ['clear-plan'],
      targetIds: [target.id],
      mode: target.id.endsWith(':1') ? 'symlink' : 'copy',
    });
    assert.ok(plan.items.every((i) => i.action === 'skip'));
  }
  await assert.rejects(old.request('snapshot'));
  await assert.rejects(old.request('resetConfig'));
  checks.push(
    'migration retains bytes, existing vault, copy/link ownership and idempotent sync; old API cannot reset guard',
  );
  await run(electronPath, [helper], { env, windowsHide: true, timeout: 15000 });
  assert.deepEqual(JSON.parse(await fs.readFile(env.TSM_LOCK_RESULT, 'utf8')), { locked: false });
  await run(executable, args, { env, windowsHide: true, timeout: 15000 });
  checks.push('old and new second instances refused while new Chromium profile is in use');
  await app.close();
  app = undefined;
  app = await electron.launch({ executablePath: executable, args, env });
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(() => typeof window.skillManager?.request === 'function');
  const restored = await call(reopened, 'snapshot');
  assert.equal(restored.skills.length, 1);
  assert.equal(restored.installations.length, 2);
  assert.deepEqual(await fs.readFile(path.join(layout.storage, 'state.json')), stateBytes);
  checks.push('normal restart uses migrated configuration and records without legacy writes');
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile(
    'test-results/layout-runtime-result.json',
    JSON.stringify(
      {
        passed: true,
        date: new Date().toISOString(),
        executable,
        runtime,
        checks,
        limitation:
          'Synthetic legacy data under a redirected host profile, not real-user migration or a clean Windows machine.',
      },
      null,
      2,
    ),
  );
  console.log(`Data layout runtime acceptance passed: ${checks.length} groups.`);
} finally {
  if (app) await app.close();
  if (legacy) await legacy.close();
  console.log('Isolated migration profile retained for diagnosis.');
}
