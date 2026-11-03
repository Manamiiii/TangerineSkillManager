import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import { getConfig } from 'app-builder-lib/out/util/config/config.js';
import { fixture, fixtureOverrides } from '../scripts/installer-fixture.mjs';

test('installer fixtures inherit production policy without duplicate resource copy jobs', async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const production = await getConfig(process.cwd(), null, undefined);
  for (const [label, version] of [
    ['previous', '0.0.9'],
    ['current', manifest.version],
  ]) {
    const effective = await getConfig(process.cwd(), null, fixtureOverrides(label, version));
    expect(effective.extraResources).toEqual(production.extraResources);
    expect(effective.extraResources).toHaveLength(1);
    expect(effective.win.target).toEqual(production.win.target);
    expect(effective.nsis).toEqual({ ...production.nsis, guid: fixture.guid });
    expect(effective.nsis.perMachine).toBe(false);
    expect(effective.nsis.allowElevation).toBe(false);
    expect(effective.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(effective.appId).toBe(fixture.appId);
    expect(effective.appId).not.toBe(production.appId);
    expect(effective.productName).not.toBe(production.productName);
    expect(effective.nsis.guid).not.toBe(production.nsis.guid);
    expect(effective.extraMetadata.version).toBe(version);
  }
});

test('fixture build locations and versions cannot escape the isolated output directories', () => {
  expect(() => fixtureOverrides('../production', '0.1.0')).toThrow();
  expect(() => fixtureOverrides('current', '../version')).toThrow();
});
