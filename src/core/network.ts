import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { z } from 'zod';
import { AppError, fail } from './errors';
import type { DnsMode } from '../shared/config';

export type AddressResolver = (host: string, signal: AbortSignal) => Promise<LookupAddress[]>;
export function isPublicAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
const answerSchema = z.object({
  Status: z.literal(0),
  Answer: z.array(z.object({ type: z.number().int(), data: z.string().max(1024) })).max(256),
});
export function parseDnsAnswer(value: unknown): LookupAddress[] {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) fail('DNS_RESPONSE', 'HTTPS DNS 未返回有效的地址记录。');
  const answers = parsed.data.Answer.filter((a) => a.type === 1);
  if (!answers.length || answers.some((a) => net.isIP(a.data) !== 4))
    fail('DNS_RESPONSE', 'HTTPS DNS 未返回有效的 IPv4 地址。');
  return checked(answers.map((a) => ({ address: a.data, family: 4 })));
}
function checked(addresses: LookupAddress[]): LookupAddress[] {
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    fail(
      'PRIVATE_NETWORK',
      '目标解析到私网或保留地址，已阻止连接。可检查 DNS，或在设置中显式选择 HTTPS DNS。',
    );
  return addresses;
}
async function cloudflare(host: string, signal: AbortSignal): Promise<LookupAddress[]> {
  const url = new URL('https://1.1.1.1/dns-query');
  url.searchParams.set('name', host);
  url.searchParams.set('type', 'A');
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        signal,
        headers: { accept: 'application/dns-json', 'accept-encoding': 'identity' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new AppError('DNS_HTTP', 'HTTPS DNS 服务暂不可用；未跟随重定向或切换其他解析方式。'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) res.destroy(new AppError('DNS_RESPONSE', 'HTTPS DNS 响应超过 64 KiB。'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(parseDnsAnswer(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
          } catch (error) {
            reject(
              error instanceof AppError ? error : new AppError('DNS_RESPONSE', 'HTTPS DNS 响应格式无效。'),
            );
          }
        });
      },
    );
    req.on('error', () =>
      reject(
        new AppError('DNS_NETWORK', '无法连接 HTTPS DNS 服务，请检查网络和系统证书；也可切回系统 DNS。'),
      ),
    );
  });
}

// Every call uses exactly one chosen resolver. Never fall back silently or change OS settings.
export async function resolvePublic(host: string, signal: AbortSignal, mode: DnsMode = 'system') {
  const hostname = host.replace(/^\[|\]$/g, '');
  if (signal.aborted) fail('TIMEOUT', '网络请求已取消或超时。');
  if (net.isIP(hostname)) return checked([{ address: hostname, family: net.isIP(hostname) }]);
  if (
    hostname.length > 253 ||
    !hostname.includes('.') ||
    !/^[a-z0-9.-]+$/i.test(hostname) ||
    hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    /\.(local|localhost|internal|test|invalid|example)$/i.test(hostname)
  )
    fail('NETWORK_SCOPE', '只支持公开域名，不发送本地或内部域名查询。');
  const controller = new AbortController();
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new AppError('TIMEOUT', 'DNS 查询已取消或超过 8 秒，请检查网络。'));
      controller.abort();
    };
  });
  const timer = setTimeout(onAbort, 8000);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      cancelled,
      mode === 'cloudflare'
        ? cloudflare(hostname, controller.signal)
        : dns
            .lookup(hostname, { all: true })
            .then(checked)
            .catch((error) => {
              if (error instanceof AppError) throw error;
              throw new AppError('DNS_NETWORK', '系统 DNS 查询失败，请检查网络或在设置中选择解析方式。');
            }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
