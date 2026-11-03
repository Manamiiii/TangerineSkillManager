import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { packagedEnvironment } from './packaged-environment.mjs';
import { fixture } from './installer-fixture.mjs';

assert.equal(process.platform, 'win32');
const [candidateArgument, previousArgument] = process.argv.slice(2);
assert.ok(candidateArgument && previousArgument, 'Pass candidate Setup.exe and older fixture Setup.exe.');
const candidate = path.resolve(candidateArgument),
  previous = path.resolve(previousArgument);
for (const file of [candidate, previous]) {
  assert.ok(
    file.startsWith(path.resolve('release/installer-acceptance') + path.sep),
    'Only isolated acceptance fixture packages are allowed.',
  );
}
assert.notEqual(candidate, previous, 'Upgrade requires a distinct older fixture.');
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const guid = fixture.guid;
assert.match(guid, /^[a-f0-9-]{36}$/);
const run = promisify(execFile);
const powershell = path.join(
  process.env.SystemRoot,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
async function ps(script, extra = {}) {
  return (
    await run(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 30000, env: { ...process.env, ...extra } },
    )
  ).stdout.trim();
}
// The real installer uses HKCU even with a redirected profile. Never replace an existing installation.
const registryScript = `@('HKCU','HKLM') | ForEach-Object {
  $hive = $_
  @('Software\\${guid}', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}', 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}') | ForEach-Object {
    if (Test-Path -LiteralPath ($hive + ':\\' + $_)) { Write-Output 'present' }
  }
}`;
assert.equal(
  await ps(registryScript),
  '',
  'Existing installation detected; use a disposable Windows account.',
);
const shortcut = await ps(
  `[IO.Path]::Combine([Environment]::GetFolderPath('Programs'), '${fixture.name}.lnk')`,
);
assert.equal(
  await fs.stat(shortcut).then(
    () => true,
    () => false,
  ),
  false,
  'Existing shortcut must be preserved.',
);
const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tsm-installer-'));
const installed = path.join(root, 'installed');
const env = await packagedEnvironment(root, electronPath);
const executable = path.join(installed, `${fixture.name}.exe`);
const uninstaller = path.join(installed, `Uninstall ${fixture.name}.exe`);
const resultPath = 'test-results/installer-result.json';
await fs.mkdir('test-results', { recursive: true });
await fs.rm(resultPath, { force: true });
let app;
let installedByTest = false;
const checks = [];
async function setup(file) {
  // /D must be the last, unquoted NSIS argument even if it contains spaces.
  assert.equal(path.dirname(installed), root);
  await run(file, ['/S', '/currentuser', `/D=${installed}`], { env, windowsHide: true, timeout: 120000 });
  installedByTest = true;
  await fs.access(executable);
}
async function remove() {
  assert.equal(path.dirname(uninstaller), installed);
  assert.equal(path.dirname(installed), root);
  // _?= executes the uninstaller in place so the exit code covers the actual operation.
  await run(uninstaller, ['/S', '/currentuser', `_?=${installed}`], {
    env,
    windowsHide: true,
    timeout: 120000,
  });
  installedByTest = false;
  assert.equal(await ps(registryScript), '', 'Uninstall registration remains.');
  assert.equal(
    await fs.stat(executable).then(
      () => true,
      () => false,
    ),
    false,
  );
}
async function open() {
  app = await electron.launch({ executablePath: executable, args: [], env, timeout: 30000 });
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    data: app.getPath('appData'),
  }));
  assert.ok(runtime.packaged);
  assert.equal(path.resolve(runtime.data).toLowerCase(), path.resolve(env.APPDATA).toLowerCase());
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.skillManager?.request === 'function');
  return { page, version: runtime.version };
}
async function close() {
  if (app) {
    await app.close();
    app = undefined;
  }
}
async function call(page, command, input) {
  const reply = await page.evaluate(
    ([name, value]) => window.skillManager.request(name, value),
    [command, input],
  );
  assert.ok(reply.ok, `Application request failed: ${command}`);
  return reply.value;
}
async function preserved(files) {
  for (const [file, bytes] of files)
    assert.deepEqual(await fs.readFile(file), bytes, 'User data changed during installation.');
}
try {
  await setup(previous);
  assert.ok((await ps(registryScript)).includes('present'));
  const first = await open();
  assert.notEqual(first.version, manifest.version);
  await call(first.page, 'importExample');
  const snapshot = await call(first.page, 'snapshot');
  const target = path.join(root, 'target');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep.txt'), 'unmanaged neighbor');
  const config = snapshot.config;
  config.agents.forEach((agent) => {
    agent.enabled = false;
  });
  // Use the existing default Agent shape; only redirect its path into this test root.
  const agent = config.agents[0];
  agent.enabled = true;
  agent.userDirectories = [target];
  const saved = await call(first.page, 'saveConfig', config);
  const eligible = saved.targets.filter((entry) => path.resolve(entry.path) === target);
  assert.equal(eligible.length, 1);
  const plan = await call(first.page, 'preview', {
    skillIds: ['clear-plan'],
    targetIds: [eligible[0].id],
    mode: 'copy',
  });
  const executed = await call(first.page, 'execute', { planId: plan.id });
  assert.ok(executed.length > 0 && executed.every((item) => item.status === 'success'));
  const files = await Promise.all(
    [
      snapshot.configPath,
      path.join(path.dirname(snapshot.configPath), 'state.json'),
      path.join(snapshot.vaultPath, 'clear-plan', 'SKILL.md'),
      path.join(target, 'clear-plan', 'SKILL.md'),
      path.join(target, 'keep.txt'),
    ].map(async (file) => [file, await fs.readFile(file)]),
  );
  checks.push('older fixture installed; real packaged app imports and synchronizes bundled example');
  // Both upgrade and uninstall must refuse to terminate a running app, including silent mode.
  await assert.rejects(setup(candidate), (error) => error.code === 2);
  await assert.rejects(remove(), (error) => error.code === 2);
  await call(first.page, 'snapshot');
  checks.push('running app blocks upgrade and uninstall without termination');
  await close();
  await setup(candidate);
  await preserved(files);
  const upgraded = await open();
  assert.equal(upgraded.version, manifest.version);
  assert.equal((await call(upgraded.page, 'snapshot')).skills.length, 1);
  await close();
  checks.push('upgrade changes version and preserves config, vault, records and synchronized files');
  await remove();
  await preserved(files);
  checks.push('uninstall removes app registration and executable; user data and Agent copies remain');
  await setup(candidate);
  const reinstalled = await open();
  assert.equal((await call(reinstalled.page, 'snapshot')).skills.length, 1);
  await close();
  await preserved(files);
  await remove();
  assert.equal(
    await fs.stat(shortcut).then(
      () => true,
      () => false,
    ),
    false,
  );
  checks.push('reinstall recovers existing library; final uninstall removes start menu shortcut');
  const digest = async (file) =>
    createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  await fs.writeFile(
    resultPath,
    JSON.stringify(
      {
        passed: true,
        date: new Date().toISOString(),
        platform: process.platform,
        release: os.release(),
        candidate: path.basename(candidate),
        sha256: await digest(candidate),
        previous: path.basename(previous),
        previousSha256: await digest(previous),
        checks,
        limitation:
          'Host system with isolated application profile and test application identity, not a clean Windows VM. Both fixtures use the release installer policy and current code; the older fixture has an older version number. Production-identity installer UI still needs manual acceptance.',
      },
      null,
      2,
    ),
  );
  console.log(`Installer acceptance passed: ${checks.length} lifecycle groups.`);
} finally {
  await close();
  if (installedByTest) await remove();
  // Preserve the isolated test profile for diagnosis; never recursively remove OS-managed caches.
  console.log('Installer test ended; isolated temporary profile retained for diagnosis.');
}
