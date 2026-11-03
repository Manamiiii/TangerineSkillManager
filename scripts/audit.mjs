import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { privacyIssues } from './audit-rules.mjs';
const staged = process.argv.includes('--staged');
const filenames = [
  ...new Set(
    execFileSync(
      'git',
      staged
        ? ['ls-files', '--cached', '-z']
        : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean),
  ),
];
const findings = [];
const context = {
  username: os.userInfo().username,
  hostname: os.hostname(),
  home: os.homedir(),
  workspace: process.cwd(),
};
for (const filename of filenames) {
  const bytes = staged
    ? execFileSync('git', ['show', `:${filename}`], { maxBuffer: 16 * 1024 * 1024 })
    : await fs.readFile(filename);
  const text = bytes.includes(0) ? '' : bytes.toString('utf8');
  for (const reason of privacyIssues(filename, text, context)) findings.push({ filename, reason });
}
if (findings.length) {
  console.error(JSON.stringify(findings, null, 2));
  process.exitCode = 1;
} else
  console.log(
    `Privacy audit passed: ${filenames.length} ${staged ? 'staged' : 'repository'} files; no detected private paths, local artifacts or credentials. Images require a separate visual review.`,
  );
