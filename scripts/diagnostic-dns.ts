import dns from 'node:dns/promises';
import https from 'node:https';
import { isPublicAddress } from '../src/core/providers';

/** Explicit test-process-only resolver. Never imported by application entry points. */
export function useDiagnosticDns(hosts: string[]): () => void {
  const original = dns.lookup;
  const allowed = new Set(hosts);
  const resolve = async (hostname: string) => {
    if (!allowed.has(hostname))
      throw new Error('Diagnostic DNS hostname is outside the explicit test scope.');
    const url = new URL('https://1.1.1.1/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', 'A');
    const signal = AbortSignal.timeout(8000);
    const response = await new Promise<string>((resolve, reject) => {
      const request = https.get(url, { signal, headers: { accept: 'application/dns-json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('Diagnostic DNS HTTP failure.'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) res.destroy(new Error('Diagnostic DNS response too large.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      request.on('error', reject);
    });
    const data = JSON.parse(response) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    const addresses =
      data.Answer?.filter((a) => a.type === 1).map((a) => ({ address: a.data, family: 4 })) ?? [];
    if (data.Status !== 0 || !addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new Error('Diagnostic DNS did not return exclusively public addresses.');
    return addresses;
  };
  // Both production transports request lookup(host, { all: true }); no HTTP response is mocked.
  dns.lookup = (async (hostname: string, options?: { all?: boolean }) => {
    const addresses = await resolve(hostname);
    return options?.all ? addresses : addresses[0];
  }) as typeof dns.lookup;
  return () => {
    dns.lookup = original;
  };
}
