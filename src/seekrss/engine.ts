import { Store, AppError } from './store';
import { SafeNetwork } from './network';
import { parseFeed } from './parser';
import { renderMessage } from './formatter';
import { telegramRequest } from './telegram';
import type { TelegramTransport } from './types';
import { acquireTelegramSend, completeTelegramSend, deferTelegramSend, telegramSendNextAt } from './telegram-send';

class HostBudgetError extends Error {
  constructor(readonly until: number) { super('重定向目标正在冷却或请求中'); }
}

export interface EngineOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  allowPrivateForTests?: boolean;
  telegramTransport?: TelegramTransport;
}
export class Engine {
  private network: SafeNetwork;
  private now: () => number;
  constructor(private store: Store, private options: EngineOptions = {}) {
    this.network = new SafeNetwork({ fetcher: options.fetcher, allowPrivateForTests: options.allowPrivateForTests, beforeRequest: async (url, hop, signal, heldHosts) => {
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      if (hop === 0) { heldHosts.add(host); return; } // Initial host was reserved by pollFeed.
      const ownHost = heldHosts.has(host);
      const floor = Math.max(1, this.store.getSettings().host_min_interval_seconds) * 1000;
      if (ownHost) {
        const budget = this.store.db.query('SELECT * FROM host_budgets WHERE host=?').get(host) as any;
        const wait = Math.max(budget?.next_at ?? 0, budget?.cooldown_until ?? 0) - this.now();
        if (wait > 0) await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Feed request stopped')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, wait);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      signal.throwIfAborted();
      this.store.db.transaction(() => {
        const budget = this.store.db.query('SELECT * FROM host_budgets WHERE host=?').get(host) as any;
        const until = Math.max(budget?.next_at ?? 0, budget?.cooldown_until ?? 0);
        if ((!ownHost && this.hostFlights.has(host)) || until > this.now()) throw new HostBudgetError(Math.max(until, this.now() + floor));
        this.store.db.query('INSERT INTO host_budgets(host,next_at,cooldown_until) VALUES(?,?,0) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at').run(host, this.now() + floor);
      }).immediate();
      if (!ownHost) {
        this.hostFlights.add(host);
        heldHosts.add(host);
        return () => { this.hostFlights.delete(host); };
      }
    } });
    this.now = options.now ?? Date.now;
  }
  private running = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tasks = new Set<Promise<unknown>>();
  private lastError: string | null = null;
  start() {
    if (this.running) return;
    this.store.recoverDeliveries();
    this.running = true;
    const loop = (action: () => Promise<unknown>, milliseconds: number) => {
      const run = () => {
        if (!this.running) return;
        const task = action().catch(() => { this.lastError = '运行循环失败，请检查配置及数据库'; }).finally(() => {
          this.tasks.delete(task);
        });
        this.tasks.add(task);
        const timer = setTimeout(() => { this.timers.delete(timer); run(); }, milliseconds);
        this.timers.add(timer);
      };
      run();
    };
    loop(() => this.tick(), 100);
    loop(() => this.sendPending(), 100);
  }
  async stop() {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.controllers.values()) controller.abort(new Error('Feed request stopped'));
    await Promise.allSettled([...this.tasks, ...this.flights.values()]);
  }
  status() { return { running: this.running, in_flight: this.flights.size, sending: this.sending, telegram_next_at: this.telegramNextAt, last_error: this.lastError }; }
  preview(maxLength = 4096) {
    const entry = this.store.listEntries({ limit: 1 }).items[0];
    const example = { item_key: 'preview', title: 'SeekRSS 排版示例：香港 VPS', summary: '这是排版示例，不是真实论坛数据。', author: '', category: '', published_at: null, link: 'https://github.com/J0Na1-1/SeekRSS', feed_name: '示例订阅' };
    return { ...renderMessage(entry ?? example, entry?.matched_rules ?? [], this.store.getSettings(), maxLength), example: !entry };
  }
  async testTelegram() {
    if (this.sending || this.now() < this.telegramNextAt) throw new AppError('Telegram 正在发送或冷却，请稍后重试', 429);
    const token = this.store.getSecretToken();
    if (!token) throw new AppError('请先在 Web 配置 Bot Token');
    const targets = this.store.listTargets().filter(t => t.enabled);
    if (!targets.length) throw new AppError('请先添加启用的推送目标');
    if (!acquireTelegramSend(this.store.db, token, this.now())) throw new AppError('Telegram 正在发送或冷却，请稍后重试', 429);
    this.sending = true;
    let accepted = 0;
    let result: any;
    try {
      // One explicit test goes to one target; no burst, no formal deduplication writes.
      const target = targets[0]!;
      const { example: _example, ...preview } = this.preview(4000);
      result = await (this.options.telegramTransport ?? telegramRequest)(token, 'sendMessage', { chat_id: target.chat_id, ...(target.topic_id ? { message_thread_id: target.topic_id } : {}), ...preview, text: '【SeekRSS 测试消息】\n' + preview.text });
      if (result?.ok && Number.isSafeInteger(result.result?.message_id)) accepted++;
      else {
        const code = Number(result?.error_code) || 500;

        throw new AppError(`Telegram 拒绝测试请求（${code}），请检查凭据及目标权限`, 502);
      }
      return { accepted, target_id: target.id, message_id: result.result.message_id, note: 'Telegram API 已接受，不等于手机通知已收到' };
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError('Telegram 测试网络请求失败，结果未知', 502); }
    finally { completeTelegramSend(this.store.db, token, this.now(), result); this.sending = false; }
  }
  private sending = false;
  private get telegramNextAt(): number { return telegramSendNextAt(this.store.db, this.store.getSecretToken()); }
  async sendPending() {
    if (this.sending || this.now() < this.telegramNextAt || this.store.getSettings().paused || !this.store.getSecretToken()) return;
    const delivery = this.store.claimDelivery(this.now());
    if (!delivery) return;
    const token = this.store.getSecretToken();
    if (!acquireTelegramSend(this.store.db, token, this.now())) {
      this.store.finishDelivery(delivery.id, { status: 'retry', next_attempt_at: this.telegramNextAt });
      return;
    }
    this.sending = true;
    let response: any;
    try {
    response = await (this.options.telegramTransport ?? telegramRequest)(token, 'sendMessage', {
      chat_id: delivery.target.chat_id,
      ...(delivery.target.topic_id ? { message_thread_id: delivery.target.topic_id } : {}),
      ...renderMessage(delivery.entry, delivery.entry.matched_rules, this.store.getSettings()),
    });
    if (response?.ok && Number.isSafeInteger(response.result?.message_id)) {
      this.store.finishDelivery(delivery.id, { status: 'sent', message_id: response.result.message_id, sent_at: this.now() });
    } else {
      const code = Number(response?.error_code) || 500;
      const retry = code === 429 || code >= 500;
      const wait = code === 429 ? Math.max(1000, (Number(response?.parameters?.retry_after) || 30) * 1000) : Math.min(300_000, 1000 * 2 ** Math.min(delivery.attempts, 9));
      const until = this.now() + wait;
      this.store.finishDelivery(delivery.id, { status: retry && delivery.attempts < 8 ? 'retry' : 'failed', error: `Telegram HTTP ${code}${retry ? ': 稍后重试' : ': 请检查凭据或目标权限'}`, next_attempt_at: until });
      if (code === 429) deferTelegramSend(this.store.db, token, until);
    }
    } catch {
      this.store.finishDelivery(delivery.id, { status: delivery.attempts < 8 ? 'retry' : 'failed', error: 'Telegram 网络请求失败（结果未知，重试可能重复）', next_attempt_at: this.now() + Math.min(300_000, 1000 * 2 ** delivery.attempts) });
    } finally { completeTelegramSend(this.store.db, token, this.now(), response); this.sending = false; }
  }
  private flights = new Map<number, Promise<unknown>>();
  private controllers = new Map<number, AbortController>();
  private hostFlights = new Set<string>();
  async tick() {
    const feeds = this.store.listFeeds().sort((a, b) => a.next_check_at - b.next_check_at || a.id - b.id);
    await Promise.all(feeds.filter(f => f.enabled && f.next_check_at <= this.now()).map(f => this.pollFeed(f.id)));
  }
  async testFeed(id: number): Promise<any> { return this.pollFeed(id, true); }
  async pollFeed(id: number, preview = false): Promise<any> {
    const feed = this.store.getFeed(id);
    if (!feed?.enabled) return { skipped: 'disabled' };
    const current = () => { const value = this.store.getFeed(id); return value?.enabled && value.revision === feed.revision && value.url === feed.url; };
    if (this.flights.has(id)) return { skipped: 'in-flight' };
    const started = this.now();
    const floor = Math.max(1, this.store.getSettings().host_min_interval_seconds);
    const interval = Math.max(1, feed.interval_seconds, floor);
    // Budget is per exact canonical hostname, across schemes and ports. Aliases
    // are not inferred; administrators must account for publisher domain aliases.
    const host = new URL(feed.url).hostname.toLowerCase().replace(/\.$/, '');
    if (this.hostFlights.has(host) || this.flights.size >= 4) return { skipped: 'concurrency' };
    const reserved = this.store.db.transaction(() => {
      const budget = this.store.db.query('SELECT * FROM host_budgets WHERE host=?').get(host) as any;
      if (feed.next_check_at > started || feed.cooldown_until > started || Math.max(budget?.next_at ?? 0, budget?.cooldown_until ?? 0) > started) return false;
      this.store.db.query('INSERT INTO host_budgets(host,next_at,cooldown_until) VALUES(?,?,0) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at').run(host, started + floor * 1000);
      this.store.updateFeedRuntime(id, { last_checked_at: started, next_check_at: started + interval * 1000, effective_interval_seconds: interval });
      return true;
    }).immediate();
    if (!reserved) return { skipped: 'budget' };
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const work = (async () => {
      const headers: Record<string, string> = {};
      if (!preview && feed.etag) headers['If-None-Match'] = feed.etag;
      if (!preview && feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;
      const response = await this.network.fetch(feed.url, headers, controller.signal);
      const responseHost = new URL(response.url).hostname.toLowerCase().replace(/\.$/, '');
      if (!current()) return { skipped: 'configuration-changed' };
      if (response.status === 304) {
        this.store.updateFeedRuntime(id, { last_success_at: this.now(), failure_count: 0, last_error: null, cooldown_until: 0, last_duration_ms: this.now() - started });
        return { not_modified: true };
      }
      if (response.status === 403) {
        this.store.saveFeed({ enabled: false }, id);
        this.store.updateFeedRuntime(id, { failure_count: feed.failure_count + 1, last_error: 'HTTP 403: 已停源，请检查发布方访问政策后手动重新启用', last_duration_ms: this.now() - started });
        return { error: 'HTTP 403', stopped: true };
      }
      if (response.status === 429 || response.status === 503) {
        const failures = feed.failure_count + 1;
        const header = response.headers.get('retry-after');
        const retry = header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? this.now() + Number(header) * 1000 : header ? Date.parse(header) : NaN;
        const until = Math.max(this.now() + interval * 1000, Number.isFinite(retry) ? retry : this.now() + Math.min(3_600_000, 1000 * 2 ** Math.min(failures, 12)));
        this.store.db.query('UPDATE host_budgets SET cooldown_until=MAX(cooldown_until,?) WHERE host IN (?,?)').run(until, host, responseHost);
        this.store.updateFeedRuntime(id, { failure_count: failures, last_error: `HTTP ${response.status}: 发布方要求退避`, cooldown_until: until, next_check_at: until, last_duration_ms: this.now() - started });
        return { error: `HTTP ${response.status}`, cooldown_until: until };
      }
      if (response.status < 200 || response.status >= 300) throw new Error('HTTP status');
      const entries = parseFeed(response.body, response.url);
      if (preview) return { preview: true, entries: entries.length, sample: entries.slice(0, 3) };
      const result = this.store.ingestEntries(id, entries);
      this.store.updateFeedRuntime(id, { last_success_at: this.now(), failure_count: 0, cooldown_until: 0, last_error: null, etag: response.headers.get('etag'), last_modified: response.headers.get('last-modified'), last_duration_ms: this.now() - started });
      return result;
    })().catch((cause) => {
      if (controller.signal.aborted) return { skipped: 'stopped' };
      if (!current()) return { skipped: 'configuration-changed' };
      if (cause instanceof HostBudgetError) {
        this.store.updateFeedRuntime(id, { next_check_at: cause.until, cooldown_until: cause.until, last_error: cause.message, last_duration_ms: this.now() - started });
        return { skipped: 'redirect-budget', cooldown_until: cause.until };
      }
      const failures = feed.failure_count + 1;
      const until = this.now() + Math.max(interval * 1000, Math.min(3_600_000, 1000 * 2 ** Math.min(failures, 12)));
      this.store.db.query('UPDATE host_budgets SET cooldown_until=MAX(cooldown_until,?) WHERE host=?').run(until, host);
      const error = '抓取或解析失败，请检查源地址、网络及 RSS/Atom 格式';
      this.store.updateFeedRuntime(id, { failure_count: failures, cooldown_until: until, next_check_at: until, last_error: error, last_duration_ms: this.now() - started });
      return { error, cooldown_until: until };
    });
    this.flights.set(id, work);
    this.hostFlights.add(host);
    try { return await work; } finally { this.flights.delete(id); this.controllers.delete(id); this.hostFlights.delete(host); }
  }
}
