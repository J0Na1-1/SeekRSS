import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/seekrss/store';
import { Engine } from '../src/seekrss/engine';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
function fixture() {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'seekrss-engine-'));
  const store = new Store(join(dir, 'state.db'));
  cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
const rss = (id = '1') => `<rss><channel><item><guid>${id}</guid><title>GPU sale</title><link>https://8.8.8.8/${id}</link></item></channel></rss>`;
function feed(store: Store, path = 'one', extra = {}) { return store.saveFeed({ name: path, url: `https://8.8.8.8/${path}`, interval_seconds: 1, ...extra }); }

function queue(store: Store, count = 1) {
  const f = feed(store, 'queued', { backfill: true });
  store.saveRule({ kind: 'keyword', terms: ['GPU'] });
  const target = store.saveTarget({ name: 'Me', chat_id: '42' });
  store.saveSettings({ bot_token: 'test-token' });
  for (let i = 0; i < count; i++) store.ingestEntries(f.id, [{ item_key: String(i), title: 'GPU <sale>', summary: '', author: '', category: '', published_at: null, link: 'https://example.com/post' }]);
  return target;
}

test('Telegram 429 is persisted and blocks all sends until retry_after expires', async () => {
  const store = fixture(); queue(store, 2); let now = 1000; let calls = 0;
  const engine = new Engine(store, { now: () => now, telegramTransport: async () => ++calls === 1 ? { ok: false, error_code: 429, parameters: { retry_after: 5 } } : { ok: true, result: { message_id: 7 } } });
  await engine.sendPending();
  expect(store.listDeliveries().find(d => d.id === 1)).toMatchObject({ status: 'retry', attempts: 1, next_attempt_at: 6000 });
  now = 5999; await engine.sendPending(); expect(calls).toBe(1);
  now = 6000; await engine.sendPending(); expect(calls).toBe(2);
  expect(store.listDeliveries().find(d => d.id === 1)?.status).toBe('sent');
});

test('outbox checks pause, token and target configuration live without consuming jobs', async () => {
  const store = fixture(); const t = queue(store); const tokens: string[] = [];
  const engine = new Engine(store, { telegramTransport: async token => { tokens.push(token); return { ok: true, result: { message_id: 1 } }; } });
  store.saveSettings({ paused: true }); await engine.sendPending();
  store.saveSettings({ paused: false, clear_token: true }); await engine.sendPending();
  store.saveSettings({ bot_token: 'new-token' }); store.saveTarget({ ...t, enabled: false }, t.id); await engine.sendPending();
  expect(tokens).toEqual([]); expect(store.listDeliveries()[0]).toMatchObject({ status: 'pending', attempts: 0 });
  store.saveTarget({ ...store.listTargets()[0], enabled: true, chat_id: '99' }, t.id);
  await engine.sendPending(); expect(tokens).toEqual(['new-token']);
  expect(store.listDeliveries()[0].status).toBe('sent');
});

test('outbox sends escaped HTML through injected transport and persists Telegram acceptance', async () => {
  const store = fixture(); queue(store); const calls: any[] = []; let now = 1000;
  const engine = new Engine(store, { now: () => now, telegramTransport: async (token, method, payload) => { calls.push({ token, method, payload }); now = 1234; return { ok: true, result: { message_id: 987 } }; } });
  await engine.sendPending();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ token: 'test-token', method: 'sendMessage', payload: { chat_id: '42', parse_mode: 'HTML' } });
  expect(calls[0].payload.text).toContain('&lt;sale&gt;');
  expect(store.listDeliveries()[0]).toMatchObject({ status: 'sent', attempts: 1, message_id: 987, sent_at: 1234 });
});

test('new installations default to the requested summary layout in real outbox payloads', async () => {
  const store = fixture();
  expect(store.getSettings()).toMatchObject({ template: 'summary', show_author: false, show_time: true, summary_length: 300 });
  queue(store); const messages: any[] = [];
  const engine = new Engine(store, { telegramTransport: async (_token, _method, payload) => { messages.push(payload); return { ok: true, result: { message_id: 1 } }; } });
  await engine.sendPending();
  expect(messages[0].text).toBe('<b>GPU</b> &lt;sale&gt;\n命中规则：GPU\n\n暂无简述\n\n发布时间：未知\n原文链接：https://example.com/post');
});

test('network, parse and non-success failures back off durably without baselining', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 }); const f = feed(store); let now = 1000; let phase = 0;
  const engine = new Engine(store, { now: () => now, fetcher: (async () => { if (phase++ === 0) throw new Error('socket token-secret'); if (phase === 2) return new Response('<rss>'); if (phase === 3) return new Response(rss(), { status: 500 }); return new Response(rss()); }) as unknown as typeof fetch });
  await engine.pollFeed(f.id);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: false, failure_count: 1, cooldown_until: 3000 });
  now = 3000; await engine.pollFeed(f.id);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: false, failure_count: 2, cooldown_until: 7000 });
  now = 7000; await engine.pollFeed(f.id);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: false, failure_count: 3, cooldown_until: 15000 });
  now = 15000; await engine.pollFeed(f.id);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: true, failure_count: 0, cooldown_until: 0, last_error: null });
});

test('304 sends validators, consumes budget and keeps entries and initialization unchanged', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 }); const f = feed(store); let now = 1000;
  const requests: any[] = [];
  const engine = new Engine(store, { now: () => now, fetcher: (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => { requests.push(init?.headers); return requests.length === 1 ? new Response(rss(), { headers: { etag: 'v1', 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' } }) : new Response(null, { status: 304 }); }) as unknown as typeof fetch });
  await engine.pollFeed(f.id); now = 2000; await engine.pollFeed(f.id);
  expect(requests[1]).toMatchObject({ 'If-None-Match': 'v1', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' });
  expect(store.listEntries().total).toBe(1);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: true, last_success_at: 2000, next_check_at: 3000, etag: 'v1' });
  await engine.pollFeed(f.id); expect(requests.length).toBe(2);
});

test('403 stops a source durably until an administrator explicitly re-enables it', async () => {
  const store = fixture(); const f = feed(store); let calls = 0; let now = 1000;
  const engine = new Engine(store, { now: () => now, fetcher: (async () => { calls++; return new Response(rss(), { status: 403 }); }) as unknown as typeof fetch });
  await engine.pollFeed(f.id);
  expect(store.getFeed(f.id)).toMatchObject({ enabled: false, initialized: false, failure_count: 1 });
  expect(store.getFeed(f.id)?.last_error).toContain('403');
  now = 100000; await engine.tick(); expect(calls).toBe(1);
});

test('429 Retry-After persists host cooldown across restart without initializing failed feeds', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 });
  const a = feed(store); const b = feed(store, 'two'); let now = 1000; let calls = 0;
  const engine = new Engine(store, { now: () => now, fetcher: (async () => { calls++; return new Response('limited', { status: 429, headers: { 'retry-after': '5' } }); }) as unknown as typeof fetch });
  await engine.pollFeed(a.id);
  expect(store.getFeed(a.id)).toMatchObject({ initialized: false, failure_count: 1, cooldown_until: 6000, next_check_at: 6000 });
  const restart = new Engine(store, { now: () => now, fetcher: (async () => { calls++; return new Response(rss()); }) as unknown as typeof fetch });
  now = 5999; await restart.pollFeed(b.id); expect(calls).toBe(1);
  now = 6000; await restart.pollFeed(b.id); expect(calls).toBe(2);
  expect(store.getFeed(b.id)?.initialized).toBe(true);
});

test('manual and scheduled polls share a durable host budget and single source flight', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 });
  const a = feed(store); const b = feed(store, 'two'); let now = 1000; let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  let started!: () => void; const requestStarted = new Promise<void>(resolve => started = resolve);
  const engine = new Engine(store, { now: () => now, fetcher: (async () => { calls++; started(); await gate; return new Response(rss()); }) as unknown as typeof fetch });
  const first = engine.pollFeed(a.id);
  await requestStarted;
  await engine.pollFeed(a.id); await engine.pollFeed(b.id);
  expect(calls).toBe(1);
  now = 3000; await engine.pollFeed(a.id); expect(calls).toBe(1);
  release(); await first;
  const restart = new Engine(store, { now: () => now, fetcher: (async () => { calls++; return new Response(rss('2')); }) as unknown as typeof fetch });
  await restart.tick();
  expect(calls).toBe(2);
  expect(store.getFeed(b.id)?.initialized).toBe(true);
  await restart.pollFeed(a.id); expect(calls).toBe(2);
  now = 4000; await restart.tick(); expect(calls).toBe(3);
});

test('pollFeed parses and baselines a first successful fetch with live conservative floor', async () => {
  const store = fixture(); const f = feed(store); let now = 1000;
  const engine = new Engine(store, { now: () => now, fetcher: (async () => new Response(rss(), { headers: { etag: 'v1' } })) as unknown as typeof fetch });
  await engine.pollFeed(f.id);
  expect(store.listEntries().total).toBe(1);
  expect(store.getFeed(f.id)).toMatchObject({ initialized: true, last_checked_at: 1000, last_success_at: 1000, next_check_at: 11000, effective_interval_seconds: 10, etag: 'v1' });
  expect(store.listDeliveries()).toEqual([]);
});

test('explicit Telegram test never slices escaped HTML entities or balanced tags', async () => {
  const store = fixture(); queue(store); const f=store.listFeeds()[0]!;
  store.ingestEntries(f.id,[{item_key:'long',title:'<&GPU'.repeat(1800),summary:'',author:'',category:'',link:'',published_at:null}]);
  let payload:any; const engine=new Engine(store,{telegramTransport:async(_t,_m,p)=>{payload=p;return {ok:true,result:{message_id:1}};}});
  await engine.testTelegram(); expect(payload.text.match(/<b>/g)?.length).toBe(payload.text.match(/<\/b>/g)?.length);
  expect(payload.text).not.toMatch(/&(?:a|am|amp|l|lt|q|quo|quot)?$/); expect(payload.text.length).toBeLessThanOrEqual(4096);
});

test('manual feed test shares request budget but never changes baseline or entry deduplication', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 }); const f = feed(store); let calls = 0;
  const engine = new Engine(store, { now: () => 1000, fetcher: (async () => { calls++; return new Response(rss()); }) as any });
  expect(await engine.testFeed(f.id)).toMatchObject({ preview: true, entries: 1 });
  expect(store.getFeed(f.id)?.initialized).toBe(false); expect(store.listEntries().total).toBe(0);
  await engine.pollFeed(f.id); expect(calls).toBe(1);
});

test('preview and explicit Telegram test reuse the renderer without changing the formal outbox', async () => {
  const store = fixture(); queue(store); const before = JSON.stringify(store.listDeliveries()); const calls: any[] = [];
  const engine = new Engine(store, { telegramTransport: async (_token, method, payload) => { calls.push({ method, payload }); return { ok: true, result: { message_id: 8 } }; } });
  expect(engine.preview()).toMatchObject({ parse_mode: 'HTML', example: false });
  const result = await engine.testTelegram();
  expect(result).toMatchObject({ accepted: 1 }); expect(calls).toHaveLength(1);
  expect(calls[0].payload.text).toContain('测试');
  expect(JSON.stringify(store.listDeliveries())).toBe(before);
});

test('slow source does not block the next eligible poll of an unrelated host', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 }); let now = 1000;
  const slow = feed(store, 'slow'); store.saveFeed({ name: 'fast', url: 'https://1.1.1.1/fast', interval_seconds: 1 });
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve); let fast = 0;
  const engine = new Engine(store, { now: () => now, fetcher: (async (url: string) => { if (url.includes('/slow')) await gate; else fast++; return new Response(rss()); }) as any });
  engine.start();
  try { await Bun.sleep(150); now = 2000; await Bun.sleep(250); expect(fast).toBe(2); }
  finally { release(); await engine.stop(); }
});

test('runtime starts real independent collection and sending loops and stops cleanly', async () => {
  const store = fixture(); store.saveSettings({ host_min_interval_seconds: 1 });
  const f = feed(store, 'runtime', { backfill: true }); store.saveRule({ kind: 'keyword', terms: ['GPU'] });
  store.saveTarget({ name: 'offline target', chat_id: '42' }); store.saveSettings({ bot_token: 'offline-token' });
  let fetched = 0, sent = 0;
  const engine = new Engine(store, { fetcher: (async () => { fetched++; return new Response(rss()); }) as any, telegramTransport: async () => { sent++; return { ok: true, result: { message_id: 12 } }; } });
  engine.start();
  try {
    const deadline = Date.now() + 2500;
    while (!sent && Date.now() < deadline) await Bun.sleep(20);
    expect(fetched).toBe(1); expect(sent).toBe(1); expect(engine.status().running).toBe(true);
    expect(store.listDeliveries()[0]).toMatchObject({ status: 'sent', message_id: 12 });
  } finally { await engine.stop(); }
  const snapshot = fetched; await Bun.sleep(150); expect(fetched).toBe(snapshot); expect(engine.status().running).toBe(false);
});

test('changed, paused or deleted source cannot ingest a stale in-flight response', async () => {
  for (const action of ['url', 'pause', 'delete']) {
    const store = fixture(); const f = feed(store); let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const engine = new Engine(store, { fetcher: (async () => { await gate; return new Response(rss(), { headers: { etag: 'stale' } }); }) as any });
    const job = engine.pollFeed(f.id);
    await Bun.sleep(5);
    if (action === 'url') store.saveFeed({ url: 'https://8.8.8.8/new' }, f.id);
    else if (action === 'pause') store.saveFeed({ enabled: false }, f.id);
    else store.deleteFeed(f.id);
    release(); await job;
    expect(store.listEntries().total).toBe(0);
    if (action !== 'delete') expect(store.getFeed(f.id)).toMatchObject({ initialized: false, etag: null, last_success_at: null });
  }
});
