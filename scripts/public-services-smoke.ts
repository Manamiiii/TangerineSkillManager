import { AppUpdateChecker } from '../src/core/app-updates';
import { GitHubMarket, SkillsMPMarket } from '../src/core/markets';
import { publicError } from '../src/core/errors';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { useDiagnosticDns } from './diagnostic-dns';
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
if (!process.argv.includes('--run')) throw new Error('Pass --run to explicitly contact GitHub and SkillsMP.');
const diagnostic = process.argv.includes('--diagnostic-dns');
const restore = diagnostic ? useDiagnosticDns(['api.github.com', 'skillsmp.com']) : () => {};
console.log(
  `Resolver: ${diagnostic ? 'explicit Cloudflare DoH diagnostic (test process only)' : 'system default'}`,
);
const checks = [
  {
    name: 'GitHub application releases',
    run: async () => ({ status: (await new AppUpdateChecker(version).check()).status }),
  },
  {
    name: 'GitHub repository search',
    run: async () => ({ count: (await new GitHubMarket().search('skills')).entries.length }),
  },
  {
    name: 'SkillsMP anonymous search',
    run: async () => ({ count: (await new SkillsMPMarket().search('testing')).entries.length }),
  },
];
const results = await Promise.all(
  checks.map(async (check) => {
    try {
      return { name: check.name, passed: true, result: await check.run() };
    } catch (e) {
      return { name: check.name, passed: false, error: publicError(e) };
    }
  }),
);
await fs.mkdir('test-results', { recursive: true });
restore();
await fs.writeFile(
  `test-results/public-services${diagnostic ? '-diagnostic' : ''}.json`,
  JSON.stringify(results, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.passed)) process.exitCode = 1;
