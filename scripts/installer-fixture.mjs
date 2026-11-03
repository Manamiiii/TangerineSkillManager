// Isolated identity only; installer policy, bundled application and hooks come from package.json.
export const fixture = {
  appId: 'org.tangerineskillmanager.installeracceptance',
  name: 'Tangerine Skill Manager Acceptance',
  guid: 'd1619770-40eb-45b0-a6fa-d7024eea9ef3',
};

// electron-builder merges these overrides into package.json automatically.
// Never repeat the full build config here: object arrays are concatenated, not deduplicated by value.
export function fixtureOverrides(label, version) {
  if (!['previous', 'current'].includes(label) || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Invalid installer fixture label or version');
  return {
    appId: fixture.appId,
    productName: fixture.name,
    directories: { output: `release/installer-acceptance/${label}` },
    extraMetadata: { version },
    nsis: { guid: fixture.guid },
  };
}
