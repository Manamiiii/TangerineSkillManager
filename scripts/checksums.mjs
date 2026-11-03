import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = path.resolve(process.argv[2] ?? 'release');
const files = (await fs.readdir(directory))
  .filter(
    (name) =>
      /\.(dmg|zip|AppImage)$/.test(name) ||
      /^TangerineSkillManager-.*-win-.*-(Setup|Portable)\.exe$/.test(name),
  )
  .sort();
if (!files.length) throw new Error('No distribution files found.');
const lines = [];
for (const name of files) {
  const bytes = await fs.readFile(path.join(directory, name));
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Checksums written for ${files.length} distribution files.`);
