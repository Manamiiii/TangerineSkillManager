import { it, expect, afterEach, vi } from 'vitest';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { AppUpdateChecker, isNewerStable } from '../src/core/app-updates';
import { AppError } from '../src/core/errors';
import { publicJson, validateApiUrl } from '../src/core/public-json';
import { externalUrl, githubSource, GitHubMarket, SkillsMPMarket, MarketRegistry } from '../src/core/markets';
import { agentPresets, presetDraft } from '../src/shared/agent-presets';
import { agentSchema, defaultConfig } from '../src/shared/config';
import { expandPath } from '../src/core/paths';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('includes DNS resolution in the public JSON timeout', async () => {
  vi.useFakeTimers();
  vi.spyOn(dns, 'lookup').mockImplementation(() => new Promise(() => {}) as never);
  const pending = expect(
    publicJson(new URL('https://api.github.com/search/repositories?q=test')),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15_000);
  await pending;
});
it('refuses HTTP redirects and bounds JSON response bytes before parsing', async () => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  let status = 302;
  const get = vi.spyOn(https, 'get').mockImplementation(((
    _url: URL,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    const req = new EventEmitter();
    queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(), {
        statusCode: status,
        resume: () => {},
        destroy(this: EventEmitter, error: Error) {
          this.emit('error', error);
        },
      });
      callback(res);
      if (status === 200) res.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
    });
    return req;
  }) as never);
  const url = new URL('https://api.github.com/search/repositories?q=test');
  await expect(publicJson(url)).rejects.toMatchObject({ code: 'HTTP_302' });
  expect(get).toHaveBeenCalledTimes(1);
  status = 200;
  await expect(publicJson(url)).rejects.toMatchObject({ code: 'LIMIT' });
});
it('does not cache API access errors as an up-to-date release', async () => {
  const client = vi.fn(async (_url: URL) => {
    throw new AppError('HTTP_429', 'limited');
  });
  const checker = new AppUpdateChecker('0.1.0', client);
  await expect(checker.check()).rejects.toMatchObject({ code: 'HTTP_429' });
  await expect(checker.check()).rejects.toMatchObject({ code: 'HTTP_429' });
  expect(client).toHaveBeenCalledTimes(2);
});
it('compares stable versions numerically, ignoring build metadata and rejecting prerelease feeds', () => {
  expect(isNewerStable('v0.10.0', '0.2.0')).toBe(true);
  expect(isNewerStable('0.2.0', '0.10.0')).toBe(false);
  expect(isNewerStable('1.0.0+build', '1.0.0')).toBe(false);
  expect(isNewerStable('1.0.0', '1.0.0-beta.1')).toBe(true);
  expect(() => isNewerStable('1.1.0-beta.1', '1.0.0')).toThrow('稳定版本');
  expect(() => isNewerStable('latest', '1.0.0')).toThrow();
});
it('checks only the fixed release API, caches results and keeps release notes inert', async () => {
  const client = vi.fn(async (_url: URL) => ({
    tag_name: 'v0.2.0',
    body: '<script>bad()</script>',
    draft: false,
    prerelease: false,
    html_url: 'https://evil.example',
  }));
  const checker = new AppUpdateChecker('0.1.0', client);
  expect((await checker.check()).status).toBe('available');
  expect((await checker.check()).notes).toContain('<script>');
  expect(client).toHaveBeenCalledTimes(1);
  expect(String(client.mock.calls[0]?.[0])).toBe(
    'https://api.github.com/repos/Manamiiii/TangerineSkillManager/releases/latest',
  );
  expect(externalUrl({ destination: 'releases' })).toBe(
    'https://github.com/Manamiiii/TangerineSkillManager/releases',
  );
});
it('distinguishes no public release, invalid responses and network failure', async () => {
  const absent = new AppUpdateChecker('0.1.0', async () => {
    throw new AppError('HTTP_404', 'absent');
  });
  expect((await absent.check()).status).toBe('unavailable');
  await expect(new AppUpdateChecker('0.1.0', async () => ({ tag_name: '1.0' })).check()).rejects.toThrow(
    '格式',
  );
  await expect(
    new AppUpdateChecker('0.1.0', async () => {
      throw new AppError('NETWORK', 'offline');
    }).check(),
  ).rejects.toThrow('offline');
});
it('blocks unreviewed network endpoints and private DNS results', async () => {
  for (const raw of [
    'http://api.github.com/search/repositories',
    'https://api.github.com/user',
    'https://skillsmp.com/other',
    'https://secret@skillsmp.com/api/v1/skills/search',
    'https://localhost/',
  ])
    expect(() => validateApiUrl(new URL(raw))).toThrow();
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
  await expect(publicJson(new URL('https://skillsmp.com/api/v1/skills/search?q=test'))).rejects.toThrow(
    '私网',
  );
});
it('restricts external browser links and extracts repositories without guessing branches', () => {
  expect(githubSource('https://github.com/example/skills/tree/feature/branch/skill').repository).toBe(
    'https://github.com/example/skills.git',
  );
  for (const url of [
    'file:///etc/passwd',
    'https://github.com.evil.example/a/b',
    'https://user:secret@github.com/a/b',
    'https://github.com/a/b?token=secret',
    'https://github.com/a/b/issues',
    'https://github.com/a/b/tree/%2fetc',
  ])
    expect(() => externalUrl({ destination: 'repository', url })).toThrow();
  expect(() => externalUrl({ destination: 'releases', url: 'https://example.org' })).toThrow();
});
it('provides editable portable templates without duplicate generic/Codex targets', () => {
  const config = defaultConfig(),
    reused = presetDraft('codex', config.agents);
  expect(reused.reused).toBe(true);
  expect(reused.original).toBe('generic');
  reused.value.name = 'changed';
  expect(config.agents[0].name).toBe('Generic .agents');
  for (const p of agentPresets) {
    const agent = presetDraft(p.key, []).value;
    expect(agentSchema.safeParse(agent).success).toBe(true);
    for (const template of [...agent.userDirectories, ...agent.projectDirectories])
      expect(
        expandPath(template, {
          home: 'C:\\Users\\Example',
          data: 'C:\\Data',
          base: 'C:\\Settings',
          workspace: 'D:\\Project',
          platform: 'win32',
        }),
      ).toMatch(/^[CD]:\\/);
  }
  const taken = { ...presetDraft('cline', []).value, userDirectories: ['~/custom'], projectDirectories: [] };
  expect(presetDraft('cline', [taken]).value.key).toBe('cline-2');
});
it('maps market results, preserves repository vs Skill distinction and rejects changed contracts', async () => {
  const gh = new GitHubMarket(async () => ({
    incomplete_results: true,
    items: [
      { full_name: 'example/skills', html_url: 'https://github.com/example/skills', description: 'Example' },
    ],
  }));
  expect((await gh.search('test')).entries[0].kind).toBe('repository');
  const mp = new SkillsMPMarket(async () => ({
    success: true,
    data: {
      skills: [
        { name: 'Test', githubUrl: 'https://github.com/example/skills/tree/main/test' },
        { name: 'Unsafe URL', githubUrl: 'https://localhost/skill' },
      ],
    },
  }));
  const result = await mp.search('test');
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].kind).toBe('skill');
  expect(result.message).toContain('忽略 1');
  await expect(new SkillsMPMarket(async () => ({ success: true, data: {} })).search('test')).rejects.toThrow(
    '格式',
  );
});
it('isolates failing markets and caches successful searches without merging distinct skills', async () => {
  const search = vi.fn(async () => ({
    entries: [
      {
        identity: 'repo/a',
        name: 'One',
        description: '',
        repository: 'https://github.com/example/skills.git',
        sourceUrl: 'https://github.com/example/skills/tree/main/a',
        kind: 'skill' as const,
        markets: ['GitHub'],
      },
      {
        identity: 'repo/b',
        name: 'One',
        description: '',
        repository: 'https://github.com/example/skills.git',
        sourceUrl: 'https://github.com/example/skills/tree/main/b',
        kind: 'skill' as const,
        markets: ['GitHub'],
      },
    ],
  }));
  const registry = new MarketRegistry([
    { key: 'github', search },
    {
      key: 'skillsmp',
      search: async () => {
        throw new AppError('HTTP_429', 'rate limited');
      },
    },
  ]);
  const r = await registry.search('test', ['github', 'skillsmp']);
  expect(r.entries).toHaveLength(2);
  expect(r.sources.map((s) => s.status)).toEqual(['success', 'failed']);
  const cached = await registry.search('test', ['github']);
  expect(cached.sources[0].cached).toBe(true);
  expect(search).toHaveBeenCalledTimes(1);
});
