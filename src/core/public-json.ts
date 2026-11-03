import https from 'node:https';
import { resolvePublic, type AddressResolver } from './network';
import { AppError, fail } from './errors';
import { isPublicAddress } from './network';

export type JsonClient = (url: URL) => Promise<unknown>;
// Only these reviewed, read-only endpoints are available to application features.
export function validateApiUrl(url: URL): void {
  const allowed =
    (url.hostname === 'api.github.com' &&
      ['/repos/Manamiiii/TangerineSkillManager/releases/latest', '/search/repositories'].includes(
        url.pathname,
      )) ||
    (url.hostname === 'skillsmp.com' && url.pathname === '/api/v1/skills/search');
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    fail('NETWORK_SCOPE', '请求不属于已支持的公开接口。');
}
export function createPublicJson(resolver: AddressResolver = resolvePublic): JsonClient {
  return async (url) => {
    validateApiUrl(url);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AppError('TIMEOUT', '连接超过 15 秒，请检查网络后重试。'));
      }, 15_000);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const addresses = await resolver(url.hostname, controller.signal);
          if (controller.signal.aborted) throw new AppError('TIMEOUT', '请求已超时。');
          if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
            fail('PRIVATE_NETWORK', '公开服务解析到私网或保留地址，已阻止连接。请检查 DNS 或代理配置。');
          return new Promise<unknown>((resolve, reject) => {
            const req = https.get(
              url,
              {
                signal: controller.signal,
                headers: {
                  accept: 'application/json',
                  'accept-encoding': 'identity',
                  'user-agent': 'TangerineSkillManager',
                },
                lookup: ((
                  _host: string,
                  options: { all?: boolean },
                  callback: (...args: unknown[]) => void,
                ) => {
                  if (options.all) callback(null, addresses);
                  else callback(null, addresses[0].address, addresses[0].family);
                }) as NonNullable<https.RequestOptions['lookup']>,
              },
              (res) => {
                if (res.statusCode !== 200) {
                  const status = res.statusCode ?? 0;
                  res.resume();
                  reject(
                    new AppError(
                      `HTTP_${status}`,
                      status === 429 || status === 403
                        ? '服务拒绝访问或已达到请求限额，请稍后重试；也可使用浏览器入口。'
                        : status === 401
                          ? '服务要求认证；当前仅支持匿名访问，可使用浏览器入口。'
                          : `公开服务返回 HTTP ${status}，未跟随重定向。`,
                    ),
                  );
                  return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 2 * 1024 * 1024) res.destroy(new AppError('LIMIT', '服务响应超过 2 MiB。'));
                  else chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () => {
                  try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                  } catch {
                    reject(new AppError('INVALID_RESPONSE', '服务返回了无法解析的数据，请稍后重试。'));
                  }
                });
              },
            );
            req.on('error', () =>
              reject(
                new AppError(
                  controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
                  controller.signal.aborted
                    ? '请求超时，请稍后重试。'
                    : '无法连接公开服务，请检查网络和系统证书。',
                ),
              ),
            );
          });
        })(),
      ]);
    } finally {
      clearTimeout(timer!);
      controller.abort();
    }
  };
}
export const publicJson = createPublicJson();
