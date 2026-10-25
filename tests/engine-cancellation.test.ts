import {expect, test} from 'bun:test';
import {Engine} from '../src/seekrss/engine';
import {Store} from '../src/seekrss/store';

for (const mode of ['timeout', 'stop'] as const) {
  test(`${mode} releases intermediate hosts before an unresolved DNS promise settles`, async () => {
    const store = new Store(':memory:');
    let now = 1000, resolveDNS!: (value: {address: string; family: number}[]) => void;
    let dnsStarted!: () => void;
    const dnsPending = new Promise<{address: string; family: number}[]>(resolve => resolveDNS = resolve);
    const resolving = new Promise<void>(resolve => dnsStarted = resolve);
    let directStarted!: () => void, finishDirect!: () => void;
    const directInFlight = new Promise<void>(resolve => directStarted = resolve);
    const directPending = new Promise<void>(resolve => finishDirect = resolve);
    const requests: string[] = [];
    const engine = new Engine(store, {now: () => now, fetcher: (async (url: string) => {
      requests.push(url);
      if (url === 'https://8.8.8.8/rss') return new Response('', {status: 302, headers: {location: 'https://9.9.9.9/feed'}});
      if (url === 'https://9.9.9.9/feed') return new Response('', {status: 302, headers: {location: 'https://pending.example/final'}});
      if (url === 'https://9.9.9.9/direct') { directStarted(); await directPending; }
      return new Response('<rss><channel><item><guid>1</guid><title>First</title></item></channel></rss>');
    }) as any});
    // Inject only the DNS boundary and deadline; no external requests or timers in the resolver.
    const options = (engine as any).network.options;
    options.timeoutMs = mode === 'timeout' ? 60 : 1000;
    options.resolve = async () => { dnsStarted(); return dnsPending; };
    let job: Promise<any> | undefined;
    let recovery: Promise<any> | undefined;
    try {
      store.saveSettings({host_min_interval_seconds: 1});
      const chain = store.saveFeed({url: 'https://8.8.8.8/rss', name: 'chain', interval_seconds: 1});
      const direct = store.saveFeed({url: 'https://9.9.9.9/direct', name: 'direct', interval_seconds: 1});
      const competitor = store.saveFeed({url: 'https://9.9.9.9/competitor', name: 'competitor', interval_seconds: 1});
      job = engine.pollFeed(chain.id);
      await resolving;
      if (mode === 'stop') await engine.stop();
      const result = await job;
      expect(result).toHaveProperty(mode === 'stop' ? 'skipped' : 'error');
      expect(engine.status().in_flight).toBe(0);
      // DNS is deliberately STILL pending: reaching the public boundary must release ownership.
      now = 5000;
      options.timeoutMs = 1000;
      recovery = engine.pollFeed(direct.id);
      // Race with the public result as well: a leaked lock must fail rather than hang the test.
      await Promise.race([directInFlight, recovery]);
      expect(requests).toContain('https://9.9.9.9/direct');
      resolveDNS([{address: '1.1.1.1', family: 4}]);
      await Bun.sleep(5);
      now = 10000;
      expect(await engine.pollFeed(competitor.id)).toMatchObject({skipped: 'concurrency'});
      finishDirect();
      expect(await recovery).not.toHaveProperty('skipped');
      expect(store.getFeed(direct.id)?.initialized).toBe(true);
      expect(requests).not.toContain('https://pending.example/final');
      expect(store.getFeed(chain.id)?.initialized).toBe(false);
    } finally {
      resolveDNS([{address: '1.1.1.1', family: 4}]);
      finishDirect();
      await job; await recovery; await engine.stop(); await Bun.sleep(5); store.close();
    }
  });
}
