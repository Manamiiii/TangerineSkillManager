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
// Check the actual installer identity before it can touch any registry key or installation.
for (const file of [candidate, previous]) {
  const product = await ps(
    `(Get-Item -LiteralPath $env:TSM_TEST_SETUP -ErrorAction Stop).VersionInfo.ProductName`,
    { TSM_TEST_SETUP: file },
  );
  assert.equal(product, fixture.name, 'Refusing a production or unrelated installer in the fixture test.');
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
const hostShortcut = await ps(
  `[IO.Path]::Combine([Environment]::GetFolderPath('Programs'), '${fixture.name}.lnk')`,
);
assert.equal(
  await fs.stat(hostShortcut).then(
    () => true,
    () => false,
  ),
  false,
  'Existing shortcut must be preserved.',
);
const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tsm-installer-'));
const installed = path.join(root, 'installed');
const env = await packagedEnvironment(root, electronPath);
const shortcut = await ps(
  `[IO.Path]::Combine([Environment]::GetFolderPath('Programs', 'DoNotVerify'), '${fixture.name}.lnk')`,
  env,
);
assert.ok(
  path
    .resolve(shortcut)
    .toLowerCase()
    .startsWith(root.toLowerCase() + path.sep),
);
const executable = path.join(installed, `${fixture.name}.exe`);
const uninstaller = path.join(installed, `Uninstall ${fixture.name}.exe`);
const resultPath = 'test-results/installer-result.json';
await fs.mkdir('test-results', { recursive: true });
await fs.rm(resultPath, { force: true });
let app;
let installedByTest = false;
const checks = [];
const normalize = (value) => path.resolve(value).toLowerCase();
async function verifyRegistration(version) {
  await fs.access(shortcut);
  const registration = JSON.parse(
    await ps(
      `
    $entry = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}' -ErrorAction Stop
    $location = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${guid}' -ErrorAction Stop
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($env:TSM_TEST_SHORTCUT)
    [pscustomobject]@{version=$entry.DisplayVersion; name=$entry.DisplayName; uninstall=$entry.UninstallString; location=$location.InstallLocation; shortcut=$link.TargetPath} | ConvertTo-Json
  `,
      { TSM_TEST_SHORTCUT: shortcut },
    ),
  );
  assert.equal(registration.version, version);
  assert.equal(registration.name, `${fixture.name} ${version}`);
  assert.equal(normalize(registration.location), normalize(installed));
  assert.equal(normalize(registration.shortcut), normalize(executable));
  assert.ok(registration.uninstall.includes(uninstaller));
  assert.ok(registration.uninstall.includes('/currentuser'));
  assert.equal(
    await ps(
      `@('Software\\${guid}', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}', 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}') | ForEach-Object { if (Test-Path -LiteralPath ('HKLM:\\' + $_)) { Write-Output 'present' } }`,
    ),
    '',
    'Per-user installation must not create machine-wide registration.',
  );
}

async function verifyInstalledPayload(setupFile) {
  // The actual installed archive must match the fixture packaged from this checkout.
  const expected = await fs.readFile(
    path.join(path.dirname(setupFile), 'win-unpacked', 'resources', 'app.asar'),
  );
  assert.deepEqual(await fs.readFile(path.join(installed, 'resources', 'app.asar')), expected);
  assert.deepEqual(
    await fs.readFile(path.join(installed, 'resources', 'examples', 'clear-plan', 'SKILL.md')),
    await fs.readFile('examples/clear-plan/SKILL.md'),
  );
}
async function setup(file) {
  // /D must be the last, unquoted NSIS argument even if it contains spaces.
  assert.equal(path.dirname(installed), root);
  await run(file, ['/S', '/currentuser', `/D=${installed}`], { env, windowsHide: true, timeout: 120000 });
  installedByTest = true;
  await fs.access(executable);
  await verifyInstalledPayload(file);
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
    arch: process.arch,
  }));
  assert.ok(runtime.packaged);
  assert.equal(runtime.arch, 'x64');
  assert.equal(path.resolve(runtime.data).toLowerCase(), path.resolve(env.APPDATA).toLowerCase());
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: prefs.sandbox,
      isolation: prefs.contextIsolation,
      webSecurity: prefs.webSecurity,
      node: prefs.nodeIntegration,
    };
  });
  assert.deepEqual(security, { sandbox: true, isolation: true, webSecurity: true, node: false });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.skillManager?.request === 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
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
  await verifyRegistration(first.version);
  await call(first.page, 'importExample');
  const snapshot = await call(first.page, 'snapshot');
  assert.equal(
    normalize(snapshot.configPath),
    normalize(path.join(env.APPDATA, 'skill-manager', 'config.json')),
  );
  assert.ok(normalize(snapshot.vaultPath).startsWith(normalize(env.APPDATA) + path.sep));
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
  checks.push(
    'per-user registration and start menu target verified; installed payload matches fixture; renderer security enabled',
  );
  // Both upgrade and uninstall must refuse to terminate a running app, including silent mode.
  await assert.rejects(setup(candidate), (error) => error.code === 2);
  await assert.rejects(remove(), (error) => error.code === 2);
  await call(first.page, 'snapshot');
  await preserved(files);
  checks.push('running app blocks upgrade and uninstall without termination');
  await close();
  await setup(candidate);
  await preserved(files);
  const upgraded = await open();
  assert.equal(upgraded.version, manifest.version);
  await verifyRegistration(upgraded.version);
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
