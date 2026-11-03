import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { privacyIssues } from '../scripts/audit-rules.mjs';

test('staged audit catches a private index version even after the working copy is cleaned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-audit-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    const file = path.join(root, 'README.md');
    fs.writeFileSync(file, ['', 'home', 'private-person', 'skills'].join('/'));
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    fs.writeFileSync(file, '~/.agents/skills');
    const audit = fileURLToPath(new URL('../scripts/audit.mjs', import.meta.url));
    const run = (args) => spawnSync(process.execPath, [audit, ...args], { cwd: root, encoding: 'utf8' });
    expect(run([]).status).toBe(0);
    const staged = run(['--staged']);
    expect(staged.status).toBe(1);
    expect(staged.stderr).toContain('non-generic user directory');
    expect(staged.stderr).not.toContain('private-person');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    expect(run(['--staged']).status).toBe(0);
  } finally {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('skill-audit-'))
      throw new Error('Invalid audit test cleanup scope');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects personal paths on all platforms, including escaped JSON paths', () => {
  for (const path of [
    ['C:', 'Users', 'private-person', 'skills'].join('\\'),
    ['C:', 'Users', 'private-person', 'skills'].join('\\\\'),
    ['', 'Users', 'private-person', 'skills'].join('/'),
    ['', 'home', 'private-person', 'skills'].join('/'),
  ])
    expect(privacyIssues('docs/guide.md', path)).toContain('non-generic user directory');
});

test('permits portable templates and synthetic cross-platform fixtures', () => {
  expect(privacyIssues('config/example.json', '~/.agents/skills {workspace} {data} %USERPROFILE%')).toEqual(
    [],
  );
  for (const path of [
    ['C:', 'Users', 'Example', 'skills'].join('\\\\'),
    ['', 'home', 'example', 'skills'].join('/'),
    ['D:', 'Project'].join('\\'),
  ])
    expect(privacyIssues('tests/paths.test.ts', path)).toEqual([]);
});

test('rejects copied runtime data and credentials even if forcibly staged', () => {
  for (const name of [
    'test-results/screenshot.png',
    '.env',
    '.env.production',
    'config.json',
    'state.json',
    'config.json.backup-123.json',
    'local.pfx',
    'desktop.lnk',
    'release/app.exe',
  ])
    expect(privacyIssues(name, '')).toContain('local data, credentials or generated artifact');
  expect(privacyIssues('.env.example', '# Example only')).toEqual([]);
  const credential = 'ghp_' + 'a'.repeat(36);
  const issues = privacyIssues('README.md', credential);
  expect(issues).toContain('access credential');
  expect(JSON.stringify(issues)).not.toContain(credential);
});

test('checks the current machine and checkout without embedding them in rules', () => {
  const context = {
    username: 'synthetic-owner',
    hostname: 'synthetic-host',
    home: '/synthetic-home',
    workspace: '/synthetic-checkout',
  };
  for (const value of Object.values(context))
    expect(privacyIssues('README.md', value.toUpperCase(), context).length).toBeGreaterThan(0);
  expect(privacyIssues('README.md', 'Portable local Skill manager', context)).toEqual([]);
});
