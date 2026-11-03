import { z } from 'zod';
import { AppError, fail } from './errors';
import { publicJson, type JsonClient } from './public-json';
import type { AppUpdate } from '../shared/types';
export const RELEASE_PAGE = 'https://github.com/Manamiiii/TangerineSkillManager/releases';
const versionPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function isNewerStable(latest: string, current: string): boolean {
  const a = latest.match(versionPattern),
    b = current.match(versionPattern);
  if (!a || !b || a[4]) fail('INVALID_VERSION', '无法识别稳定版本号，请查看发行页面。');
  for (let i = 1; i <= 3; i++) {
    if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]);
  }
  return !!b[4];
}
const releaseSchema = z.object({
  tag_name: z.string().max(100),
  body: z.string().max(200_000).nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
});
export class AppUpdateChecker {
  private cached?: { at: number; value: AppUpdate };
  constructor(
    private version: string,
    private client: JsonClient = publicJson,
  ) {}
  async check(): Promise<AppUpdate> {
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.value;
    let value: AppUpdate;
    try {
      const parsed = releaseSchema.safeParse(
        await this.client(
          new URL('https://api.github.com/repos/Manamiiii/TangerineSkillManager/releases/latest'),
        ),
      );
      if (!parsed.success) fail('INVALID_RESPONSE', 'GitHub 发行数据格式发生变化，请查看发行页面。');
      const r = parsed.data;
      if (r.draft || r.prerelease) fail('INVALID_RESPONSE', '接口没有返回正式发行版，请查看发行页面。');
      value = {
        status: isNewerStable(r.tag_name, this.version) ? 'available' : 'current',
        currentVersion: this.version,
        latestVersion: r.tag_name,
        notes: r.body ?? '',
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== 'HTTP_404') throw e;
      value = {
        status: 'unavailable',
        currentVersion: this.version,
        notes: '暂未找到公开正式发行版，或仓库暂不可访问。',
        checkedAt: new Date().toISOString(),
      };
    }
    this.cached = { at: Date.now(), value };
    return value;
  }
}
