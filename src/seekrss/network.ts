import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
// Explicit package path avoids Bun's incomplete built-in `undici` shim.
import { Agent, fetch as undiciFetch } from 'undici/index.js';

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export interface NetworkOptions {
  fetcher?: typeof fetch;
  allowPrivateForTests?: boolean;
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  timeoutMs?: number;
  budgetTimeoutMs?: number;
  maxBytes?: number;
  beforeRequest?: (url: URL, hop: number, signal: AbortSignal, heldHosts: Set<string>) => void | (() => void) | Promise<void | (() => void)>;
}
export interface FeedResponse { status: number; headers: Headers; body: string; url: string }
export class SafeNetwork {
  constructor(private options: NetworkOptions = {}) {}
  private async addresses(url: URL) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Only credential-free HTTP(S) feeds are allowed');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (this.options.resolve ?? ((host) => lookup(host, { all: true, verbatim: true })))(hostname);
    if (!addresses.length || (!this.options.allowPrivateForTests && addresses.some(a => !isPublicAddress(a.address)))) throw new Error('Feed address is not a public unicast address');
    return addresses;
  }
  async fetch(input: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<FeedResponse> {
    const controller = new AbortController();
    // Resource lifetime follows this public request, not an uncancellable DNS
    // promise still running after timeout. Late acquisitions are released at once.
    const releases: (() => void)[] = [];
    let finished = false;
    const own = (release: () => void) => { if (finished) release(); else releases.push(release); };
    let timer: ReturnType<typeof setTimeout>, remaining = this.options.timeoutMs ?? 15_000, activeSince = performance.now();
    const arm = (milliseconds: number, message: string) => { timer = setTimeout(() => controller.abort(new Error(message)), Math.max(0, milliseconds)); };
    const transferDeadline = () => arm(remaining, 'Feed timeout including body');
    // Publisher spacing is not network transfer time. Bound it independently;
    // the supported maximum host floor is one day, with at most three redirects.
    const budgetWait = async (action: () => Promise<void | (() => void)>) => {
      clearTimeout(timer!);
      remaining -= performance.now() - activeSince;
      if (remaining <= 0) controller.abort(new Error('Feed timeout including body'));
      controller.signal.throwIfAborted();
      arm(this.options.budgetTimeoutMs ?? 86_401_000, 'Feed budget wait timeout');
      try { return await action(); }
      finally { clearTimeout(timer!); activeSince = performance.now(); if (!controller.signal.aborted) transferDeadline(); }
    };
    let abort!: () => void;
    const deadline = new Promise<never>((_, reject) => { abort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', abort, { once: true }); });
    const cancel = () => controller.abort(signal?.reason ?? new Error('Feed request stopped'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    transferDeadline();
    try { return await Promise.race([this.perform(input, headers, controller.signal, budgetWait, own), deadline]); }
    finally {
      finished = true;
      clearTimeout(timer!); controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', cancel);
      for (const release of releases.splice(0).reverse()) release();
    }
  }
  private async perform(input: string, headers: Record<string, string>, signal: AbortSignal, budgetWait: (action: () => Promise<void | (() => void)>) => Promise<void | (() => void)>, own: (release: () => void) => void): Promise<FeedResponse> {
    let url = new URL(input);
    const heldHosts = new Set<string>();
    for (let hop = 0; ; hop++) {
      const addresses = await this.addresses(url);
      signal.throwIfAborted();
      const release = await budgetWait(async () => this.options.beforeRequest?.(url, hop, signal, heldHosts));
      if (release) own(release);
      signal.throwIfAborted();
      // The connector never resolves again: DNS validation and socket use one snapshot.
      const dispatcher = new Agent({ connect: { lookup: ((_hostname: string, opts: any, callback: any) => {
        const candidates = opts.family ? addresses.filter(a => a.family === opts.family) : addresses;
        if (!candidates.length) return callback(new Error('No validated address for family'));
        if (opts.all) callback(null, candidates); else callback(null, candidates[0].address, candidates[0].family);
      }) as any } });
      try {
        const response = await (this.options.fetcher ?? undiciFetch as unknown as typeof fetch)(url.href, { headers, redirect: 'manual', dispatcher, signal } as any);
        signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          if (hop >= 3) throw new Error('Too many feed redirects');
          const location = response.headers.get('location');
          if (!location) throw new Error('Missing redirect location');
          const next = new URL(location, url);
          if (next.origin !== url.origin) headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !/^(authorization|cookie|if-none-match|if-modified-since)$/i.test(key)));
          url = next;
          continue;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body?.getReader();
        try {
          while (reader) {
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > Math.min(this.options.maxBytes ?? 2 * 1024 * 1024, 2 * 1024 * 1024)) {
              await reader.cancel();
              throw new Error('Feed body exceeds 2 MiB decoded limit');
            }
            chunks.push(value);
          }
        } finally { reader?.releaseLock(); }
        return { status: response.status, headers: new Headers(response.headers), body: Buffer.concat(chunks).toString('utf8'), url: url.href };
      } finally { await dispatcher.close(); }
    }
  }
}
