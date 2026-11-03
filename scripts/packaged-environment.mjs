import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

// Read-only preflight with the same Electron runtime before launching real application code.
// This tests a temporary process profile, not an OS-level sandbox or a clean virtual machine.
export async function packagedEnvironment(root, electronPath) {
  assert.equal(process.platform, 'win32', 'Packaged environment preflight currently targets Windows.');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(PATH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|SKILL_MANAGER_TEST_MODE|SKILL_MANAGER_TEST_ROOT|APPDATA|LOCALAPPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP)$/i.test(
        key,
      )
    )
      delete env[key];
  }
  const home = path.join(root, 'home'),
    roaming = path.join(home, 'AppData', 'Roaming'),
    local = path.join(home, 'AppData', 'Local');
  const temp = path.join(root, 'temp');
  for (const dir of [home, roaming, local, temp]) await fs.mkdir(dir, { recursive: true });
  Object.assign(env, {
    APPDATA: roaming,
    LOCALAPPDATA: local,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.slice(0, -1),
    HOMEPATH: home.slice(path.parse(home).root.length - 1),
    TEMP: temp,
    TMP: temp,
    PATH: '',
    TSM_PROBE_RESULT: path.join(root, 'environment-probe.json'),
  });
  const probe = path.join(root, 'probe.cjs');
  await fs.writeFile(
    probe,
    `const {app}=require('electron');const fs=require('node:fs');const os=require('node:os');
try { fs.writeFileSync(process.env.TSM_PROBE_RESULT,JSON.stringify({appData:app.getPath('appData'),userData:app.getPath('userData'),home:os.homedir()}));app.exit(0); }
catch (e) { fs.writeFileSync(process.env.TSM_PROBE_RESULT,JSON.stringify({error:'Unable to resolve isolated paths'}));app.exit(0); }`,
  );
  await promisify(execFile)(electronPath, [probe], { env, windowsHide: true, timeout: 15000 });
  const detected = JSON.parse(await fs.readFile(env.TSM_PROBE_RESULT, 'utf8'));
  assert.ok(
    !detected.error,
    'Cannot resolve isolated profile paths; refusing to launch packaged application.',
  );
  const normalized = (v) => path.resolve(v).toLowerCase();
  assert.equal(
    normalized(detected.appData),
    normalized(roaming),
    'APPDATA did not isolate the profile; refusing to launch packaged application.',
  );
  assert.equal(
    normalized(detected.home),
    normalized(home),
    'User home did not isolate the profile; refusing to launch packaged application.',
  );
  assert.ok(normalized(detected.userData).startsWith(normalized(root) + path.sep));
  delete env.TSM_PROBE_RESULT;
  return env;
}
