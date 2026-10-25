import type { AppService } from './service';
import type { TelegramTransport } from './types';
import { telegramRequest } from './telegram';
import { createHash } from 'node:crypto';
import { acquireTelegramSend, completeTelegramSend, telegramSendNextAt } from './telegram-send';

export interface BotOptions {
  transport?: TelegramTransport;
  engine?: { pollFeed: (id: number) => Promise<unknown>; testTelegram: () => Promise<unknown> };
}

const BUTTONS: Record<string, string> = {
  '添加关键词': '/add', '添加组合': '/combo', '添加屏蔽词': '/block', '添加屏蔽组合': '/blockcombo',
  '规则列表': '/list', '添加订阅': '/feedadd', '订阅列表': '/feeds', '编辑订阅': '/feededit',
  '暂停推送': '/pause', '恢复推送': '/resume', '运行状态': '/status', '历史记录': '/history',
  '测试匹配': '/test', '推送目标': '/targets', '添加目标': '/targetadd', '帮助': '/help', '取消': '/cancel',
};
const HELP = `SeekRSS 单管理员控制台（仅私聊）\n/add 词1,词2 — 独立关键词\n/combo 词1,词2 — AND 组合\n/block 词1,词2 — 独立屏蔽\n/blockcombo 词1,词2 — AND 屏蔽\n/list /on ID /off ID /del ID\n/feedadd URL [名称] /feeds /feededit ID /feeddel ID\n/interval ID 秒 /feedpause ID /feedresume ID\n/pause /resume — 仅暂停推送，继续归档，恢复不补发\n/status /history /test [文本]\n/targets /targetadd chat_id [名称] /targetdel ID\n/cancel — 取消向导\n/start /help\nBot Token 仅在受保护的 Web 设置页配置；管理员密码仅在服务器本地 docker-compose 的 -pwd= 参数或源码 .env 文件配置。切勿发送到聊天。`;
const COMMANDS = ['start', 'help', 'add', 'combo', 'block', 'blockcombo', 'list', 'on', 'off', 'del',
  'feedadd', 'feeds', 'feededit', 'feeddel', 'interval', 'feedpause', 'feedresume', 'pause', 'resume',
  'status', 'history', 'test', 'targets', 'targetadd', 'targetdel', 'cancel']
  .map(command => ({ command, description: `SeekRSS /${command}` }));
const KEYBOARD = {
  keyboard: Object.keys(BUTTONS).reduce<string[][]>((rows, label, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1]!.push(label);
    return rows;
  }, []), resize_keyboard: true, is_persistent: true,
};

function validAdmin(admin: string): boolean {
  return /^[1-9]\d*$/.test(admin) && Number.isSafeInteger(Number(admin));
}

export class BotController {
  private pending?: { expires: number; command: string; args?: string; id?: number; revision?: number; step?: number; draft?: any };
  private running = false;
  private lastError: string | null = null;
  private enabled = false;
  private identity = '';
  private controller?: AbortController;
  private monitor?: ReturnType<typeof setInterval>;
  private syncing?: Promise<void>;
  private retryAt = Infinity;
  constructor(private service: AppService, private options: BotOptions = {}) {}

  async start(): Promise<void> {
    this.enabled = true;
    if (!this.monitor) this.monitor = setInterval(() => { void this.sync(); }, 250);
    await this.sync();
  }
  async sync(): Promise<void> {
    if (!this.enabled) return;
    if (this.syncing) return this.syncing;
    this.syncing = this.configure().catch(() => { this.controller?.abort(); this.running = false; this.lastError = '无法读取 Telegram 凭据或配置，请检查加密密钥'; }).finally(() => { this.syncing = undefined; });
    return this.syncing;
  }
  private async configure(): Promise<void> {
    const admin = this.service.getSettings().admin_telegram_id;
    const token = this.service.store.getSecretToken();
    const identity = validAdmin(admin) && token ? createHash('sha256').update(token + ':' + admin).digest('hex') : '';
    if (identity === this.identity && (this.running || Date.now() < this.retryAt)) return;
    this.controller?.abort();
    this.pending = undefined;
    this.identity = identity;
    this.running = false;
    this.retryAt = Infinity;
    if (!identity || !this.enabled) return;
    const controller = this.controller = new AbortController();
    const current = () => this.enabled && !controller.signal.aborted && this.identity === identity && this.service.getSettings().admin_telegram_id === admin && this.service.store.getSecretToken() === token;
    const call = async (method: string, payload: unknown) => {
      if (!current()) throw new Error('配置已变更');
      const result = await this.request(token, method, payload, controller.signal);
      if (!current()) throw new Error('配置已变更');
      if (!result?.ok) throw new Error(`Telegram 初始化请求失败（${Number(result?.error_code) || 500}）`);
      return result.result;
    };
    try {
      const webhook = await call('getWebhookInfo', {});
      if (webhook?.url) throw new Error('存在 webhook；请在原系统停用后再启动长轮询，不会自动接管。');
      const scope = { type: 'chat', chat_id: admin };
      await call('setMyCommands', { scope, commands: COMMANDS });
      const commands = await call('getMyCommands', { scope });
      if (!Array.isArray(commands) || commands.length !== COMMANDS.length || commands.some((c, i) =>
        c.command !== COMMANDS[i]!.command || c.description !== COMMANDS[i]!.description)) throw new Error('Telegram 命令读回不一致，请重试。');
      this.lastError = null;
      this.running = true;
      void this.poll(token, identity, controller, current);
    } catch (error) { this.lastError = this.safeError(error); if (!/webhook|命令|401|403/.test(this.lastError)) this.retryAt = Date.now() + 30_000; }
  }
  private async request(token: string, method: string, payload: unknown, signal: AbortSignal): Promise<any> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('请求已停止')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
    try { return await Promise.race([(this.options.transport ?? telegramRequest)(token, method, payload, signal), cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private async poll(token: string, identity: string, controller: AbortController, current: () => boolean) {
    const key = 'telegram_offset_' + identity;
    const db = this.service.store.db;
    let offset = (db.query('SELECT value FROM meta WHERE key=?').get(key) as any)?.value ?? 0;
    let failures = 0;
    while (current()) {
      let wait = 100;
      try {
        const result = await this.request(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, controller.signal);
        if (!current()) break;
        if (!result?.ok) {
          const code = Number(result?.error_code);
          if ([401, 403, 409].includes(code)) { this.lastError = `Telegram ${code}：凭据失效或有其他轮询实例，请检查后重启`; break; }
          wait = code === 429 ? Math.max(1000, (Number(result.parameters?.retry_after) || 30) * 1000) : Math.min(60_000, 1000 * 2 ** Math.min(++failures, 6));
          this.lastError = `Telegram ${code || '请求失败'}：等待退避后重试`;
        } else {
          if (!Array.isArray(result.result)) throw new Error('无效更新');
          for (const update of result.result) {
            if (!current()) break;
            if (!Number.isSafeInteger(update.update_id) || update.update_id < offset) continue;
            await this.handleUpdate(update, { key, offset: update.update_id + 1 });
            if (!current()) break;
            offset = update.update_id + 1;
            db.query('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, offset);
          }
          failures = 0; this.lastError = null;
        }
      } catch { if (!current()) break; this.lastError = 'Telegram 长轮询网络失败，稍后重试'; wait = Math.min(60_000, 1000 * 2 ** Math.min(++failures, 6)); }
      if (current()) await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, wait); controller.signal.addEventListener('abort', done, { once: true }); });
    }
    if (this.identity === identity) this.running = false;
  }
  async stop(): Promise<void> { this.enabled = false; if (this.monitor) clearInterval(this.monitor); this.monitor = undefined; this.controller?.abort(); this.identity = ''; this.running = false; this.pending = undefined; }
  status() { return { running: this.running, last_error: this.lastError }; }

  async handleUpdate(update: any, acknowledgement?: { key: string; offset: number }): Promise<void> {
    const message = update?.message;
    const admin = this.service.getSettings().admin_telegram_id;
    if (!validAdmin(admin) || message?.chat?.type !== 'private' || String(message?.from?.id) !== admin || String(message?.chat?.id) !== admin) return;
    const db = this.service.store.db;
    if (acknowledgement && ((db.query('SELECT value FROM meta WHERE key=?').get(acknowledgement.key) as any)?.value ?? 0) >= acknowledgement.offset) return;
    const pendingBefore = this.pending ? structuredClone(this.pending) : undefined;
    const identityBefore = this.identity, tokenBefore = this.service.store.getSecretToken();
    let committed = false;
    const commit = <T>(action: () => T): T => {
      const apply = () => {
        const result = action();
        if (acknowledgement) db.query('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)').run(acknowledgement.key, acknowledgement.offset);
        return result;
      };
      const result = acknowledgement ? db.transaction(apply).immediate() : apply();
      committed = true;
      return result;
    };
    try {
      await this.dispatch(message, admin, commit);
      if (!committed && acknowledgement) commit(() => {});
    }
    catch (error) {
      if (committed) { this.lastError = '配置已保存，但 Telegram 回复失败；不会重复执行'; return; }
      if (this.identity === identityBefore && this.service.getSettings().admin_telegram_id === admin && this.service.store.getSecretToken() === tokenBefore) this.pending = pendingBefore;
      await this.reply(admin, `操作失败：${this.safeError(error)}`);
    }
  }

  private safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : '操作未完成，请检查配置后重试';
    const token = this.service.store.getSecretToken();
    return (token ? message.split(token).join('[已脱敏]') : message)
      .replace(/\b\d{5,}:[A-Za-z0-9_-]{15,}\b/g, '[已脱敏]')
      .replace(/https?:\/\/\S+/g, '[地址已隐藏]').slice(0, 500);
  }

  private async dispatch(message: any, admin: string, commit: <T>(action: () => T) => T): Promise<void> {
    let text = BUTTONS[message.text] ?? message.text;
    if (typeof text === 'string' && (/\b\d{5,}:[A-Za-z0-9_-]{15,}\b/.test(text) || /^\/(?:token|password|settoken|setpassword)\b/i.test(text))) {
      this.pending = undefined;
      await this.reply(admin, '拒绝接收 Token 或密码。Bot Token 请在受保护的 Web 设置页配置；管理员密码请在服务器本地 docker-compose 的 -pwd= 参数或源码 .env 文件配置。请删除聊天中的敏感消息。');
      return;
    }
    if (typeof text !== 'string') return;
    if (text.startsWith('/')) this.pending = undefined;
    if (text === '/feededit' || text === '/targetadd') {
      await this.reply(admin, text === '/feededit' ? '请先 /feeds 查看 ID，再发送 /feededit ID。' : '请发送 /targetadd chat_id [名称]，例如 /targetadd 你的数字ID 手机。');
      return;
    }
    if (text === '/cancel') {
      this.pending = undefined;
      await this.reply(admin, '已取消向导。');
      return;
    }
    if (this.pending && Date.now() > this.pending.expires) {
      this.pending = undefined;
      if (!text.startsWith('/')) { await this.reply(admin, '向导已超时，请重新发送命令。'); return; }
    }
    if (!text.startsWith('/') && this.pending?.command === 'feedadd') {
      text = `/feedadd ${text}`;
      this.pending = undefined;
    }
    if (!text.startsWith('/') && this.pending?.command === 'feededit') {
      const pending = this.pending, step = pending.step ?? 0;
      if (text !== '-') {
        if (step === 0) pending.draft.name = text;
        if (step === 1) pending.draft.url = text;
        if (step === 2) pending.draft.interval_seconds = Number(text);
        if (step === 3) pending.draft.enabled = text === 'on' || text === '启用';
      }
      if (step < 3) {
        pending.step = step + 1;
        await this.reply(admin, ['请输入 URL，- 保持不变。', '请输入抓取间隔秒数，- 保持不变。', '请输入 on/off 启用状态，- 保持不变。'][step]!);
      } else {
        commit(() => this.service.saveFeed({ ...pending.draft, revision: pending.revision }, pending.id));
        this.pending = undefined;
        await this.reply(admin, '订阅已更新。');
      }
      return;
    }
    if (text === '/feedadd') {
      this.pending = { command: 'feedadd', expires: Date.now() + 300_000 };
      await this.reply(admin, '请输入 URL [名称]；5 分钟超时，/cancel 取消。');
      return;
    }
    const edit = text.match(/^\/feededit ([1-9]\d*)$/);
    if (edit) {
      const feed = this.service.getFeed(Number(edit[1]));
      if (!feed) throw new Error('订阅源不存在');
      this.pending = { command: 'feededit', id: feed.id, revision: feed.revision, step: 0, draft: {}, expires: Date.now() + 300_000 };
      await this.reply(admin, `编辑 #${feed.id}，请输入新名称；- 保持不变，/cancel 取消。`);
      return;
    }
    if (!text.startsWith('/') && this.pending && ['add', 'combo', 'block', 'blockcombo'].includes(this.pending.command)) {
      text = `/${this.pending.command} ${text}`;
      this.pending = undefined;
    }
    if (/^\/(add|combo|block|blockcombo)$/.test(text)) {
      this.pending = { command: text.slice(1), expires: Date.now() + 300_000 };
      await this.reply(admin, '请输入逗号分隔的词；组合至少两个词。5 分钟超时，/cancel 取消。');
      return;
    }
    if (text === '确认' && this.pending && ['del', 'feeddel', 'targetdel'].includes(this.pending.command)) {
      commit(() => {
        if (this.pending!.command === 'del') this.service.deleteRule(this.pending!.id!);
        else if (this.pending!.command === 'targetdel') this.service.deleteTarget(this.pending!.id!);
        else this.service.deleteFeed(this.pending!.id!);
      });
      this.pending = undefined;
      await this.reply(admin, '已删除。');
      return;
    }
    if (!text.startsWith('/') && this.pending?.command === 'test') {
      text = `/test ${text}`;
      this.pending = undefined;
    }
    if (text === '/test') {
      this.pending = {command:'test', expires:Date.now() + 300_000};
      await this.reply(admin, '请输入要测试匹配的文本；不会实际发送。/cancel 取消。');
      return;
    }
    if (text.startsWith('/test ')) {
      const result = this.service.testRule({text: text.slice(6)});
      await this.reply(admin, `${result.would_push ? '会推送' : '不推送'}（仅规则预览）\n命中：${result.matched.map(r => r.name || r.terms.join(' + ')).join('、') || '无'}\n屏蔽：${result.blocked.map(r => r.name || r.terms.join(' + ')).join('、') || '无'}`);
      return;
    }
    if (text === '/status') {
      await this.reply(admin, JSON.stringify(this.service.getStatus(), null, 2));
      return;
    }
    if (text === '/history') {
      const entries = this.service.listEntries({limit:10}).items;
      const deliveries = this.service.listDeliveries(10);
      await this.reply(admin, entries.length || deliveries.length ? [
        ...entries.map(entry => `#${entry.id} ${entry.feed_name}: ${entry.title}\n命中 ${entry.matched_rules.join('、') || '无'} / 屏蔽 ${entry.blocked_rules.join('、') || '无'}`),
        ...deliveries.map(delivery => `投递 #${delivery.id}: ${delivery.status} 尝试 ${delivery.attempts} 次${delivery.error ? ` — ${this.safeError(new Error(delivery.error))}` : ''}`),
      ].join('\n\n') : '暂无历史记录。');
      return;
    }
    if (text.startsWith('/targetadd ')) {
      const tokenAtStart = this.service.store.getSecretToken();
      const [chatId, ...name] = text.slice(11).trim().split(/\s+/);
      if (!chatId || !/^-?[1-9]\d*$/.test(chatId)) throw new Error('chat_id 必须是稳定数字 ID');
      const chat = await this.api('getChat', { chat_id: chatId });
      if (String(chat?.id) !== chatId) throw new Error('Telegram 返回的目标身份不匹配');
      if (chat.type === 'private') {
        if (chatId !== admin) throw new Error('私人目标仅允许管理员本人');
      } else if (['group', 'supergroup', 'channel'].includes(chat.type)) {
        const me = await this.api('getMe', {});
        const member = await this.api('getChatMember', {chat_id:chatId, user_id:admin});
        if (!['creator', 'administrator'].includes(member?.status)) throw new Error('需要您在该群组或频道拥有管理员权限');
        const bot = await this.api('getChatMember', {chat_id:chatId, user_id:me.id});
        const canPost = chat.type === 'channel' ? ['creator', 'administrator'].includes(bot?.status) && bot.can_post_messages === true
          : ['creator', 'administrator', 'member'].includes(bot?.status) || (bot?.status === 'restricted' && bot.is_member === true && bot.can_send_messages === true);
        if (!canPost || (chat.type !== 'channel' && !['creator', 'administrator'].includes(bot.status) && chat.permissions?.can_send_messages === false)) throw new Error('机器人没有该目标的发送权限，请先添加机器人并授予权限');
      } else throw new Error('不支持的目标类型');
      if (this.service.getSettings().admin_telegram_id !== admin || this.service.store.getSecretToken() !== tokenAtStart) return;
      const target = commit(() => this.service.saveTarget({chat_id: chatId, name: name.join(' ') || chatId, enabled: true}));
      await this.reply(admin, `已添加目标 #${target.id} ${target.name}`);
      return;
    }
    if (text === '/targets') {
      await this.reply(admin, this.service.listTargets().map(target => `#${target.id} ${target.enabled ? '启用' : '停用'} ${target.name} (${target.chat_id})`).join('\n') || '暂无目标。');
      return;
    }
    const targetDelete = text.match(/^\/targetdel ([1-9]\d*)$/);
    if (targetDelete) {
      this.pending = { command: 'targetdel', id: Number(targetDelete[1]), expires: Date.now() + 300_000 };
      await this.reply(admin, '确认删除目标？发送“确认”，或 /cancel。');
      return;
    }
    if (text.startsWith('/feedadd ')) {
      const [url, ...name] = text.slice(9).trim().split(/\s+/);
      const feed = commit(() => this.service.saveFeed({ url, name: name.join(' ') || url }));
      await this.reply(admin, `已添加订阅 #${feed.id} ${feed.name}`);
      return;
    }
    if (text === '/feeds') {
      await this.reply(admin, this.service.listFeeds().map(feed => `#${feed.id} ${feed.enabled ? '启用' : '暂停'} ${feed.name}\n${feed.url}\n请求 ${feed.interval_seconds} 秒 / 实际下限 ${feed.effective_interval_seconds} 秒`).join('\n\n') || '暂无订阅。');
      return;
    }
    const feedAction = text.match(/^\/(interval|feedpause|feedresume|feeddel) ([1-9]\d*)(?: (\d+))?$/);
    if (feedAction) {
      const id = Number(feedAction[2]);
      if (feedAction[1] === 'feeddel') {
        this.pending = { command: 'feeddel', id, expires: Date.now() + 300_000 };
        await this.reply(admin, `确认删除订阅 #${id} 及关联历史？发送“确认”，或 /cancel。`);
      } else {
        const feed = commit(() => this.service.saveFeed(feedAction[1] === 'interval' ? { interval_seconds: Number(feedAction[3]) } : { enabled: feedAction[1] === 'feedresume' }, id));
        await this.reply(admin, `订阅 #${id} 已更新；请求 ${feed.interval_seconds} 秒，实际下限 ${feed.effective_interval_seconds} 秒。`);
      }
      return;
    }
    if (text === '/list') {
      await this.reply(admin, this.service.listRules().map(rule => `#${rule.id} ${rule.enabled ? '启用' : '停用'} ${rule.kind} [${rule.scope}] ${rule.terms.join(' + ')} 来源:${rule.feed_id ?? '全部'}`).join('\n') || '暂无规则。');
      return;
    }
    const action = typeof text === 'string' ? text.match(/^\/(on|off|del) ([1-9]\d*)$/) : null;
    if (action) {
      const id = Number(action[2]);
      if (action[1] === 'del') {
        this.pending = { command: 'del', id, expires: Date.now() + 300_000 };
        await this.reply(admin, `确认删除规则 #${id}？请发送“确认”，或 /cancel。`);
      } else {
        commit(() => this.service.setRuleEnabled(id, action[1] === 'on'));
        await this.reply(admin, `规则 #${id} 已${action[1] === 'on' ? '启用' : '停用'}。`);
      }
      return;
    }
    const ruleCommand = typeof text === 'string' ? text.match(/^\/(add|combo|block|blockcombo)\s+([\s\S]+)$/) : null;
    if (ruleCommand) {
      const kind = ruleCommand[1] === 'add' ? 'keyword' : ruleCommand[1] as 'combo' | 'block' | 'blockcombo';
      const terms = ruleCommand[2]!.split(/[,，]/).map(term => term.trim()).filter(Boolean);
      const groups = kind === 'keyword' || kind === 'block' ? terms.map(term => [term]) : [terms];
      commit(() => { for (const group of groups) this.service.saveRule({ kind, terms: group }); });
      await this.reply(admin, `已添加 ${groups.length} 条规则。`);
    }
    if (text === '/start' || text === '/help') await this.reply(admin, HELP);
    if (text === '/pause' || text === '/resume') {
      const paused = text === '/pause';
      commit(() => this.service.saveSettings({ paused }));
      await this.reply(admin, this.service.getSettings().paused === paused
        ? paused ? '已暂停推送，继续归档；恢复后仅推送新条目。' : '已恢复推送，不补发暂停期间的条目。'
        : '设置未生效，请在 Web 核查后重试。');
    }
  }

  private async reply(chat: string, text: string) {
    for (let offset = 0; offset < text.length; offset += 3900) {
      if (this.service.getSettings().admin_telegram_id !== chat) return;
      const token = this.service.store.getSecretToken(), db = this.service.store.db;
      if (db) {
        const wait = telegramSendNextAt(db, token) - Date.now();
        if (wait > 1000) { this.lastError = 'Telegram 正在发送或限流，命令回复暂不可用'; return; }
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (this.service.getSettings().admin_telegram_id !== chat || this.service.store.getSecretToken() !== token) return;
        if (!acquireTelegramSend(db, token, Date.now())) return;
      }
      let result: any;
      try {
        result = await (this.options.transport ?? telegramRequest)(token, 'sendMessage', { chat_id: chat, text: text.slice(offset, offset + 3900), reply_markup: KEYBOARD });
      } finally { if (db) completeTelegramSend(db, token, Date.now(), result); }
      if (result?.ok === false) throw new Error('Telegram 回复失败，请检查运行状态');
    }
  }

  private async api(method: string, payload: unknown): Promise<any> {
    const result = await (this.options.transport ?? telegramRequest)(this.service.store.getSecretToken(), method, payload);
    if (result?.ok === false) throw new Error('Telegram 请求失败');
    return result?.ok === true ? result.result : result;
  }
}
