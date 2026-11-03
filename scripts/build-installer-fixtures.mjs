import fs from 'node:fs/promises';
import { build, Platform, Arch } from 'electron-builder';
import { fixture } from './installer-fixture.mjs';

const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
for (const [label, version] of [
  ['previous', '0.0.9'],
  ['current', manifest.version],
]) {
  await build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    config: {
      ...manifest.build,
      appId: fixture.appId,
      productName: fixture.name,
      directories: { output: `release/installer-acceptance/${label}` },
      extraMetadata: { version },
      nsis: { ...manifest.build.nsis, guid: fixture.guid },
    },
  });
}
