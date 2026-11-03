import { it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { resolvePublic, parseDnsAnswer } from '../src/core/network';
import { createPublicJson } from '../src/core/public-json';
import { configSchema, defaultConfig } from '../src/shared/config';
import { migrateConfig } from '../src/core/store';
import { ApplicationService } from '../src/core/service';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('saving or restoring network settings makes no requests and takes effect without restarting', async () => {
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, 'tsm-network-'));
  const get = mockHttp(answer());
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '198.18.0.1', family: 4 }] as never);
  try {
    const app = new ApplicationService(path.join(root, 'data'), path.join(root, 'home'));
    const { config } = await app.request('snapshot', undefined);
    await app.request('saveConfig', { ...config, network: { dns: 'cloudflare' } });
    expect(get).not.toHaveBeenCalled();
    expect((await app.store.loadConfig()).network?.dns).toBe('cloudflare');
    expect(await app.resolveNetwork('github.com', signal())).toEqual([{ address: '8.8.8.8', family: 4 }]);
    await app.request('resetConfig', undefined);
    expect(get).toHaveBeenCalledTimes(1);
    await expect(app.resolveNetwork('github.com', signal())).rejects.toMatchObject({
      code: 'PRIVATE_NETWORK',
    });
    expect((await app.store.loadConfig()).network).toBeUndefined();
  } finally {
    if (path.dirname(root) !== base || !path.basename(root).startsWith('tsm-network-'))
      throw new Error('Invalid test scope');
    await fs.rm(root, { recursive: true, force: true });
  }
});
const signal = () => new AbortController().signal;
const answer = (address = '8.8.8.8') => ({ Status: 0, Answer: [{ type: 1, data: address }] });
function mockHttp(body: unknown, statusCode = 200, oversized = false) {
  return vi.spyOn(https, 'get').mockImplementation(((
    _url: URL,
    _options: unknown,
    callback: (res: unknown) => void,
  ) => {
    const req = new EventEmitter();
    queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(), {
        statusCode,
        resume: () => {},
        destroy(this: EventEmitter, error: Error) {
          this.emit('error', error);
        },
      });
      callback(res);
      if (statusCode === 200) {
        res.emit('data', oversized ? Buffer.alloc(65537) : Buffer.from(JSON.stringify(body)));
        res.emit('end');
      }
    });
    return req;
  }) as never);
}
it('keeps legacy/default configs on system DNS and validates explicit opt-in', () => {
  const original = defaultConfig();
  expect(original.network).toBeUndefined();
  expect(migrateConfig(original)).toEqual({ config: original, migrated: false });
  expect(migrateConfig({ ...original, version: 0 }).config.network).toBeUndefined();
  expect(configSchema.parse({ ...original, network: { dns: 'cloudflare' } }).network?.dns).toBe('cloudflare');
  expect(() => configSchema.parse({ ...original, network: { dns: 'automatic' } })).toThrow();
  expect(() =>
    configSchema.parse({ ...original, network: { dns: 'cloudflare', endpoint: 'https://example.org' } }),
  ).toThrow();
});
it('never silently falls back or calls HTTPS DNS from the system mode', async () => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '198.18.0.1', family: 4 }] as never);
  const get = mockHttp(answer());
  await expect(resolvePublic('github.com', signal())).rejects.toMatchObject({ code: 'PRIVATE_NETWORK' });
  expect(get).not.toHaveBeenCalled();
});
it('queries only the fixed TLS endpoint with a hostname, then validates all addresses', async () => {
  const lookup = vi.spyOn(dns, 'lookup');
  const get = mockHttp(answer());
  expect(await resolvePublic('github.com', signal(), 'cloudflare')).toEqual([
    { address: '8.8.8.8', family: 4 },
  ]);
  const [url, options] = get.mock.calls[0] as unknown as [URL, https.RequestOptions];
  expect(url.href).toBe('https://1.1.1.1/dns-query?name=github.com&type=A');
  expect(options.rejectUnauthorized).not.toBe(false);
  expect(lookup).not.toHaveBeenCalled();
  for (const address of ['127.0.0.1', '10.0.0.1', '198.18.0.1', '::1', 'not-an-ip'])
    expect(() => parseDnsAnswer(answer(address))).toThrow();
  expect(() =>
    parseDnsAnswer({ Status: 0, Answer: [...answer().Answer, ...answer('10.0.0.1').Answer] }),
  ).toThrow();
  expect(() => parseDnsAnswer({ Status: 3 })).toThrow();
});
it('refuses local names and private IP literals without sending DNS requests', async () => {
  const get = mockHttp(answer());
  for (const host of [
    'localhost',
    'repo.local',
    'repo.internal',
    '127.0.0.1',
    '[::1]',
    'user@github.com',
    'a..com',
  ])
    await expect(resolvePublic(host, signal(), 'cloudflare')).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it('bounds DNS bodies, rejects redirects and malformed responses without fallback', async () => {
  const lookup = vi.spyOn(dns, 'lookup');
  let get = mockHttp(answer(), 302);
  await expect(resolvePublic('github.com', signal(), 'cloudflare')).rejects.toMatchObject({
    code: 'DNS_HTTP',
  });
  get.mockRestore();
  get = mockHttp(answer(), 200, true);
  await expect(resolvePublic('github.com', signal(), 'cloudflare')).rejects.toMatchObject({
    code: 'DNS_RESPONSE',
  });
  get.mockRestore();
  mockHttp({ unexpected: true });
  await expect(resolvePublic('github.com', signal(), 'cloudflare')).rejects.toMatchObject({
    code: 'DNS_RESPONSE',
  });
  expect(lookup).not.toHaveBeenCalled();
});
it('cancels a stalled system resolver within the DNS deadline', async () => {
  vi.useFakeTimers();
  vi.spyOn(dns, 'lookup').mockImplementation(() => new Promise(() => {}) as never);
  const result = expect(resolvePublic('github.com', signal())).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(8000);
  await result;
});
it('honors caller cancellation and aborts an outstanding HTTPS DNS request', async () => {
  let requestSignal: AbortSignal | undefined;
  vi.spyOn(https, 'get').mockImplementation(((_url: URL, options: https.RequestOptions) => {
    requestSignal = options.signal;
    return new EventEmitter();
  }) as never);
  const controller = new AbortController();
  const result = expect(resolvePublic('github.com', controller.signal, 'cloudflare')).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  controller.abort();
  await result;
  expect(requestSignal?.aborted).toBe(true);
});
it('pins the chosen public addresses while preserving the API hostname and TLS validation', async () => {
  const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
  const get = mockHttp({ items: [] });
  await createPublicJson(resolver)(new URL('https://api.github.com/search/repositories?q=skills'));
  const [url, options] = get.mock.calls[0] as unknown as [URL, https.RequestOptions];
  expect(url.hostname).toBe('api.github.com');
  expect(options.rejectUnauthorized).not.toBe(false);
  const callback = vi.fn();
  (options.lookup as Function)('api.github.com', { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  expect(resolver).toHaveBeenCalledWith('api.github.com', expect.any(AbortSignal));
});
