import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const notices = [],
  licenses = new Set();
for (const [folder, entry] of Object.entries(lock.packages)) {
  if (!folder || entry.dev || !folder.startsWith('node_modules/')) continue;
  const directory = path.resolve(root, folder);
  if (!directory.startsWith(path.join(root, 'node_modules') + path.sep))
    throw new Error('Invalid dependency path');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const expression =
    typeof manifest.license === 'string'
      ? manifest.license
      : JSON.stringify(manifest.license ?? manifest.licenses ?? 'See package license');
  licenses.add(expression);
  const files = (await fs.readdir(directory))
    .filter((f) => /^(license|licence|copying|notice)(\..+)?$/i.test(f))
    .sort();
  const texts = [];
  for (const file of files) {
    if ((await fs.stat(path.join(directory, file))).isFile())
      texts.push(await fs.readFile(path.join(directory, file), 'utf8'));
  }
  notices.push({
    key: `${manifest.name}@${manifest.version}`,
    text: `${manifest.name}@${manifest.version}\nLicense: ${expression}\n\n${texts.length ? texts.join('\n\n') : 'The package declares the license above. Refer to its distributed source for full notices.'}`,
  });
}
const unique = [...new Map(notices.map((n) => [n.key, n])).values()].sort((a, b) =>
  a.key.localeCompare(b.key, 'en'),
);
await fs.writeFile(
  'THIRD_PARTY_NOTICES.txt',
  'Third-party production dependency notices\n\nElectron and Chromium notices are distributed separately with the packaged runtime.\nThis file records dependency metadata and bundled notice texts; it is not legal advice.\n\n' +
    unique
      .map((n) => n.text)
      .join('\n\n------------------------------------------------------------\n\n')
      .trimEnd() +
    '\n',
);
console.log(
  `Generated notices for ${unique.length} production dependencies. Declared licenses: ${[...licenses].sort().join(', ')}.`,
);
