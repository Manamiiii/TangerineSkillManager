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

// Maintenance acceptance, not a daily launcher. Never inherits the user's application profile.
assert.equal(process.platform, 'win32');
const [previousArgument, portableArgument] = process.argv.slice(2);
assert.ok(previousArgument && portableArgument, 'Pass previous win-unpacked EXE and candidate Portable EXE.');
const previous = path.resolve(previousArgument),
  portable = path.resolve(portableArgument);
const release = await fs.realpath('release');
for (const file of [previous, portable]) {
  const actual = await fs.realpath(file);
  const relative = path.relative(release, actual);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Use this checkout release artifacts.',
  );
}
assert.match(path.basename(previous), /^Tangerine Skill Manager\.exe$/);
assert.match(path.basename(portable), /^TangerineSkillManager-\d+\.\d+\.\d+-win-x64-Portable\.exe$/);
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
assert.equal(path.basename(portable), `TangerineSkillManager-${manifest.version}-win-x64-Portable.exe`);
const digest = async (file) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
const before = { previous: await digest(previous), portable: await digest(portable) };
const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tsm-portable-handoff-'));
const env = await packagedEnvironment(root, electronPath);
let owner;
try {
  owner = await electron.launch({ executablePath: previous, args: [], env, timeout: 30000 });
  await owner.firstWindow();
  const identity = await owner.evaluate(({ app }) => {
    globalThis.handoffEvents = 0;
    app.on('second-instance', () => {
      globalThis.handoffEvents++;
    });
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      pid: process.pid,
      profile: app.getPath('userData'),
    };
  });
  assert.equal(identity.packaged, true);
  assert.notEqual(
    identity.version,
    manifest.version,
    'Previous executable must be a different application version.',
  );
  assert.equal(
    path.resolve(identity.profile).toLowerCase(),
    path.join(env.APPDATA, 'tangerine-skill-manager').toLowerCase(),
  );
  await promisify(execFile)(portable, [], { env, windowsHide: true, timeout: 60000 });
  const after = await owner.evaluate(({ app }) => ({
    version: app.getVersion(),
    pid: process.pid,
    events: globalThis.handoffEvents,
  }));
  assert.equal(after.pid, identity.pid);
  assert.equal(after.version, identity.version);
  assert.equal(after.events, 1, 'The candidate must hand off to the existing instance.');
  assert.equal(
    await fs.stat(path.join(env.LOCALAPPDATA, 'Tangerine', 'Data', 'TangerineSkillManager')).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    ),
    false,
    'Forwarding must not prepare or migrate another library.',
  );
  assert.deepEqual({ previous: await digest(previous), portable: await digest(portable) }, before);
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile(
    'test-results/portable-handoff-result.json',
    JSON.stringify(
      {
        passed: true,
        date: new Date().toISOString(),
        previous,
        portable,
        previousVersion: identity.version,
        candidateVersion: manifest.version,
        previousSha256: before.previous,
        portableSha256: before.portable,
        checks: [
          'candidate wrapper forwards to actual older application',
          'owner PID and runtime version remain unchanged',
          'no new data root or migration',
          'both artifacts unchanged',
        ],
        limitation:
          'Isolated host profile only. A successful Portable exit is not evidence that the current instance upgraded.',
      },
      null,
      2,
    ),
  );
  console.log('Portable handoff acceptance passed: 4 checks; existing runtime remains the older version.');
} finally {
  if (owner) await owner.close();
  console.log('Isolated previous application closed normally; diagnostic profile retained.');
}
