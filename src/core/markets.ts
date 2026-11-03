import { z } from 'zod';
import { publicJson, type JsonClient } from './public-json';
import { fail, publicError } from './errors';
import { RELEASE_PAGE } from './app-updates';
import type { Commands, MarketCandidate, MarketSearch } from '../shared/types';

export function githubSource(raw: string): { repository: string; sourceUrl: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('INVALID_URL', '需要公开 GitHub 仓库地址。');
  }
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%|\\/.test(url.pathname)
  )
    fail('INVALID_URL', '需要不含凭据和查询参数的公开 GitHub 仓库地址。');
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (
    parts.length < 2 ||
    !/^[A-Za-z0-9-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[1]) ||
    parts.some((s) => !s || s === '.' || s === '..') ||
    (parts.length > 2 && !['tree', 'blob'].includes(parts[2]))
  )
    fail('INVALID_URL', '无法识别 GitHub 仓库或文件地址。');
  const repo = parts[1].replace(/\.git$/, '');
  if (!repo || repo === '.') fail('INVALID_URL', '仓库名无效。');
  return { repository: `https://github.com/${parts[0]}/${repo}.git`, sourceUrl: url.href };
}
export function externalUrl(input: Commands['openExternal']['input']): string {
  const parsed = z
    .strictObject({
      destination: z.enum(['releases', 'skills-sh', 'skillsmp', 'clawhub', 'repository']),
      url: z.string().max(2048).optional(),
    })
    .parse(input);
  if (parsed.destination === 'repository') return githubSource(parsed.url ?? '').sourceUrl;
  if (parsed.url) fail('INVALID_URL', '固定入口不能指定其他网址。');
  return {
    releases: RELEASE_PAGE,
    'skills-sh': 'https://skills.sh/',
    skillsmp: 'https://skillsmp.com/',
    clawhub: 'https://clawhub.ai/',
  }[parsed.destination];
}

export interface MarketAdapter {
  readonly key: 'github' | 'skillsmp';
  search(query: string): Promise<{ entries: MarketCandidate[]; message?: string }>;
}
const shortText = z.string().max(4000);
export class GitHubMarket implements MarketAdapter {
  readonly key = 'github' as const;
  constructor(private client: JsonClient = publicJson) {}
  async search(query: string) {
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', `${query} topic:agent-skills`);
    url.searchParams.set('per_page', '20');
    const data = z
      .object({
        incomplete_results: z.boolean(),
        items: z
          .array(
            z.object({
              full_name: shortText,
              html_url: z.string().max(2048),
              description: shortText.nullable(),
            }),
          )
          .max(100),
      })
      .safeParse(await this.client(url));
    if (!data.success) fail('INVALID_RESPONSE', 'GitHub 搜索返回格式不兼容，未导入任何内容。');
    const entries = data.data.items.map((item): MarketCandidate => {
      const source = githubSource(item.html_url);
      return {
        ...source,
        identity: source.repository.toLowerCase(),
        name: item.full_name,
        description: item.description ?? '',
        kind: 'repository',
        markets: ['GitHub'],
      };
    });
    return {
      entries,
      message: data.data.incomplete_results
        ? 'GitHub 返回了部分结果。当前搜索仅涵盖 agent-skills 主题仓库。'
        : '仅搜索 agent-skills 主题仓库；结果不是单个 Skill，导入前需发现仓库内容。',
    };
  }
}
export class SkillsMPMarket implements MarketAdapter {
  readonly key = 'skillsmp' as const;
  constructor(private client: JsonClient = publicJson) {}
  async search(query: string) {
    const url = new URL('https://skillsmp.com/api/v1/skills/search');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '20');
    const parsed = z
      .object({
        success: z.literal(true),
        data: z.object({
          skills: z
            .array(
              z.object({
                name: shortText,
                description: shortText.optional(),
                githubUrl: z.string().max(2048),
              }),
            )
            .max(100),
        }),
      })
      .safeParse(await this.client(url));
    if (!parsed.success)
      fail('INVALID_RESPONSE', 'SkillsMP 响应不符合当前适配格式；可改用浏览器查找并导入仓库。');
    let skipped = 0;
    const entries: MarketCandidate[] = [];
    for (const item of parsed.data.data.skills) {
      try {
        const source = githubSource(item.githubUrl);
        const suffix = new URL(source.sourceUrl).pathname.split('/').slice(3).join('/');
        entries.push({
          ...source,
          identity: `${source.repository.toLowerCase()}|${suffix}`,
          name: item.name,
          description: item.description ?? '',
          kind: 'skill',
          markets: ['SkillsMP'],
        });
      } catch {
        skipped++;
      }
    }
    return {
      entries,
      message: `匿名搜索适配（实验性，服务可能要求认证）。${skipped ? `已忽略 ${skipped} 个不支持的来源地址。` : ''}`,
    };
  }
}
export class MarketRegistry {
  private cache = new Map<string, { time: number; result: Awaited<ReturnType<MarketAdapter['search']>> }>();
  constructor(private adapters: MarketAdapter[] = [new GitHubMarket(), new SkillsMPMarket()]) {}
  async search(query: string, keys: Array<'github' | 'skillsmp'>): Promise<MarketSearch> {
    const sources: MarketSearch['sources'] = [];
    const combined = new Map<string, MarketCandidate>();
    const results = await Promise.all(
      keys.map(async (key) => {
        try {
          const adapter = this.adapters.find((a) => a.key === key);
          if (!adapter) fail('NOT_IMPLEMENTED', '这个市场尚未接入。');
          const cacheKey = `${key}:${query}`,
            prior = this.cache.get(cacheKey);
          const cached = !!prior && Date.now() - prior.time < 60_000;
          const result = cached ? prior!.result : await adapter.search(query);
          if (!cached) {
            if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(cacheKey, { time: Date.now(), result });
          }
          return { key, result, cached };
        } catch (e) {
          return { key, error: publicError(e).message };
        }
      }),
    );
    for (const r of results) {
      if (!r.result) {
        sources.push({ key: r.key, status: 'failed', count: 0, message: r.error });
        continue;
      }
      sources.push({
        key: r.key,
        status: 'success',
        count: r.result.entries.length,
        message: r.result.message,
        cached: r.cached,
      });
      for (const entry of r.result.entries) {
        const prior = combined.get(entry.identity);
        if (prior) prior.markets = [...new Set([...prior.markets, ...entry.markets])];
        else combined.set(entry.identity, structuredClone(entry));
      }
    }
    return { entries: [...combined.values()], sources };
  }
}
