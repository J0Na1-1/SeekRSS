import { test, expect } from 'bun:test';
import { SafeNetwork, isPublicAddress } from '../src/seekrss/network';

test('bounds decoded bodies and total timeout including body', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (new URL(req.url).pathname === '/gzip') return new Response(Bun.gzipSync('x'.repeat(2 * 1024 * 1024 + 1)), { headers: { 'content-encoding': 'gzip' } });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first')); }, cancel() {} }));
  } });
  try {
    const network = new SafeNetwork({ allowPrivateForTests: true, timeoutMs: 100 });
    await expect(network.fetch(`http://127.0.0.1:${server.port}/gzip`)).rejects.toThrow('2 MiB');
    await expect(network.fetch(`http://127.0.0.1:${server.port}/slow`)).rejects.toThrow(/timeout/i);
  } finally { server.stop(true); }
});
test('transfer timeout excludes bounded publisher waiting but still spans all network hops', async () => {
  let calls = 0;
  const network = new SafeNetwork({ timeoutMs: 90, beforeRequest: async (_url, hop) => { if (hop) await Bun.sleep(150); }, fetcher: (async () => {
    calls++; await Bun.sleep(55);
    return calls === 1 ? new Response('', { status: 302, headers: { location: '/canonical' } }) : new Response('<rss/>');
  }) as any });
  const started = Date.now();
  await expect(network.fetch('https://8.8.8.8/rss')).rejects.toThrow(/timeout/i);
  expect(calls).toBe(2);expect(Date.now() - started).toBeGreaterThanOrEqual(200);
});
test('publisher budget waiting is independently bounded and aborts its waiter before transport', async () => {
  let aborted = false, calls = 0;
  const network = new SafeNetwork({ timeoutMs: 20, budgetTimeoutMs: 60, beforeRequest: async (_url, _hop, signal) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }), fetcher: (async () => { calls++; return new Response('<rss/>'); }) as any });
  await expect(network.fetch('https://8.8.8.8/rss')).rejects.toThrow(/budget wait timeout/i);
  expect(aborted).toBe(true);expect(calls).toBe(0);
});
test('a late budget callback releases its lease exactly once without starting transport', async () => {
  let complete!: (release: () => void) => void, started!: () => void;
  const callback = new Promise<void>(resolve => started = resolve);
  const pending = new Promise<() => void>(resolve => complete = resolve);
  let calls = 0, released = 0;
  const network = new SafeNetwork({ budgetTimeoutMs: 40, beforeRequest: async () => { started(); return pending; }, fetcher: (async () => { calls++; return new Response('<rss/>'); }) as any });
  const job = network.fetch('https://8.8.8.8/rss');
  await callback;
  await expect(job).rejects.toThrow(/budget wait timeout/i);
  complete(() => released++);
  await Bun.sleep(5);
  expect(released).toBe(1);expect(calls).toBe(0);
});
test('validates every redirect and stops at three hops', async () => {
  let calls = 0;
  const blocked = new SafeNetwork({ fetcher: (async () => { calls++; return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } }); }) as any });
  await expect(blocked.fetch('https://8.8.8.8/feed')).rejects.toThrow('public');
  expect(calls).toBe(1);
  calls = 0;
  const loop = new SafeNetwork({ fetcher: (async () => { calls++; return new Response('', { status: 302, headers: { location: '/loop' } }); }) as any });
  await expect(loop.fetch('https://8.8.8.8/feed')).rejects.toThrow('redirect');
  expect(calls).toBe(4);
});
test('pins the validated DNS snapshot in the connection lookup and rejects mixed DNS', async () => {
  let resolutions = 0;
  const network = new SafeNetwork({ resolve: async () => { resolutions++; return [{ address: '8.8.8.8', family: 4 }]; }, fetcher: (async (_url: string, options: any) => {
    expect(options.dispatcher).toBeDefined();
    return new Response('<rss/>');
  }) as any });
  await network.fetch('https://publisher.example/rss');
  expect(resolutions).toBe(1);
  const mixed = new SafeNetwork({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }] });
  await expect(mixed.fetch('https://publisher.example/rss')).rejects.toThrow('public');
});
test('denies non-global addresses and unsafe URL authorities without transport', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '100.64.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '192.0.0.1', '2001:db8::1']) expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  let called = 0;
  const network = new SafeNetwork({ fetcher: (async () => { called++; return new Response('x'); }) as unknown as typeof fetch });
  for (const url of ['http://127.1/feed', 'file:///etc/passwd', 'http://user:pass@8.8.8.8/']) await expect(network.fetch(url)).rejects.toThrow();
  expect(called).toBe(0);
});
