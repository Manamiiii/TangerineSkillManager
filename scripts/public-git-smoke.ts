import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ApplicationService } from '../src/core/service';
import { publicError } from '../src/core/errors';
import { useDiagnosticDns } from './diagnostic-dns';

// Explicit opt-in network test. Never part of ordinary tests or application startup.
const diagnostic = process.argv.includes('--diagnostic-dns');
const [url, ref = 'main', subdirectory = 'examples/clear-plan'] = process.argv
  .slice(2)
  .filter((v) => v !== '--diagnostic-dns');
if (!url)
  throw new Error(
    'Provide an explicit public HTTPS repository URL, optional ref and Skill subdirectory. This test never connects to an implicit default.',
  );
const base = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(path.join(base, 'tsm-public-git-'));
const expectedId = subdirectory.split('/').filter(Boolean).at(-1)!;
const restore = diagnostic ? useDiagnosticDns([new URL(url).hostname]) : () => {};
console.log(
  `Resolver: ${diagnostic ? 'explicit Cloudflare DoH diagnostic (test process only)' : 'system default'}`,
);
try {
  const app = new ApplicationService(path.join(root, 'data'), path.join(root, 'home'));
  const snapshot = await app.request('snapshot', undefined);
  await app.request('saveConfig', {
    ...snapshot.config,
    agents: [],
    providers: [
      {
        key: 'public-example',
        kind: 'git',
        name: 'Public project example',
        enabled: true,
        location: url,
        ref,
        subdirectory,
        offline: false,
      },
    ],
  });
  const discovered = await app.request('discover', { sourceKey: 'public-example' });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, expectedId);
  const skill = await app.request('importSkill', { sourceKey: 'public-example', relativePath: '.' });
  assert.match(skill.source?.commit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(skill.id, expectedId);
  const update = await app.request('checkUpdate', { id: expectedId });
  assert.equal(update.available, false);
  console.log(
    'Public Git acceptance passed: HTTPS fetch, explicit branch/subdirectory, discovery, import, commit provenance and unchanged-content check.',
  );
} catch (error) {
  const failure = publicError(error);
  console.error(`Public Git acceptance did not pass: ${failure.code}: ${failure.message}`);
  process.exitCode = 1;
} finally {
  restore();
  if (path.dirname(root) !== base || !path.basename(root).startsWith('tsm-public-git-'))
    throw new Error('Invalid cleanup scope');
  await fs.rm(root, { recursive: true, force: true });
}
