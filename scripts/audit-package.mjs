import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { listPackage, extractFile, statFile } from '@electron/asar';
import { privacyIssues } from './audit-rules.mjs';

const archive = process.argv[2] ?? 'release/win-unpacked/resources/app.asar';
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const packagedManifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
for (const field of ['name', 'version', 'license', 'main'])
  assert.equal(packagedManifest[field], manifest[field], `Packaged identity differs: ${field}`);
const context = {
  home: os.homedir(),
  workspace: process.cwd(),
  username: os.userInfo().username,
  hostname: os.hostname(),
};
let checked = 0;
for (const entry of listPackage(archive)) {
  const name = entry.replaceAll('\\', '/').replace(/^\//, '');
  if (!/^(dist\/|dist-desktop\/|package\.json$|LICENSE$|THIRD_PARTY_NOTICES\.txt$)/.test(name)) continue;
  const nativeName = path.normalize(name);
  if (statFile(archive, nativeName).files) continue;
  const bytes = extractFile(archive, nativeName);
  if (name !== 'package.json')
    assert.deepEqual(bytes, await fs.readFile(name), `Packaged file differs from source: ${name}`);
  const findings = privacyIssues(`packaged/${path.basename(name)}`, bytes.toString('utf8'), context);
  assert.deepEqual(findings, [], `Private information in packaged file: ${name}`);
  checked++;
}
assert.ok(checked >= 7, 'No application payload found; refusing an empty audit.');
assert.deepEqual(
  await fs.readFile(path.join(path.dirname(archive), 'examples', 'clear-plan', 'SKILL.md')),
  await fs.readFile('examples/clear-plan/SKILL.md'),
  'Packaged example differs from the public example',
);
console.log(`Packaged application privacy and source consistency passed: ${checked} files.`);
