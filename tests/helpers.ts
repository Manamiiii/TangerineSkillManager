import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationService } from '../src/core/service';
import type { Config } from '../src/shared/config';
export const markdown = (version = '1.0.0') =>
  `---\nname: Example Skill\ndescription: A safe test fixture\nversion: ${version}\nauthor: Community\nmetadata:\n  category: example\n---\n\n# Example\nExplain the requested task before making changes.\n`;
export async function fixture() {
  const base = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(base, 'tsm-test-'));
  const home = path.join(root, 'home'),
    data = path.join(root, 'data'),
    source = path.join(root, 'source'),
    target = path.join(root, 'target'),
    project = path.join(root, 'project');
  for (const dir of [home, data, source, target, project]) await fs.mkdir(dir);
  await fs.mkdir(path.join(source, 'example-skill'));
  await fs.writeFile(path.join(source, 'example-skill', 'SKILL.md'), markdown());
  const app = new ApplicationService(data, home);
  const initial = await app.request('snapshot', undefined);
  const config: Config = {
    ...initial.config,
    agents: [
      {
        key: 'test',
        name: 'Test Agent',
        enabled: true,
        order: 0,
        userDirectories: [target],
        projectDirectories: ['{workspace}/.agents/skills'],
        extraDirectories: [],
        readOnlySources: [],
      },
    ],
    projects: [{ key: 'example', name: 'Example project', root: project }],
    providers: [
      { key: 'local', kind: 'local', name: 'Local fixture', enabled: true, location: source, offline: true },
    ],
  };
  await app.request('saveConfig', config);
  const importSkill = () => app.request('importSkill', { sourceKey: 'local', relativePath: 'example-skill' });
  const preview = (mode: 'copy' | 'symlink' = 'copy') =>
    app.request('preview', { skillIds: ['example-skill'], targetIds: ['test:user:-:0'], mode });
  const sync = async (mode: 'copy' | 'symlink' = 'copy') =>
    app.request('execute', { planId: (await preview(mode)).id });
  const cleanup = async () => {
    if (path.dirname(root) !== base || !path.basename(root).startsWith('tsm-test-'))
      throw new Error('Invalid fixture cleanup scope');
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root, home, data, source, target, project, app, config, importSkill, preview, sync, cleanup };
}
