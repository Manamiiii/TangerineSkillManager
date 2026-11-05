import fs from 'node:fs/promises';
import { build, Platform, Arch } from 'electron-builder';
import { fixtureOverrides } from './installer-fixture.mjs';

const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
for (const [label, version] of [
  ['previous', '0.0.9'],
  ['previous-family', '0.1.0'],
  ['current', manifest.version],
]) {
  await build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    config: fixtureOverrides(label, version),
  });
}
