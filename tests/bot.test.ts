import { describe, test, expect } from 'bun:test';
import { BotController } from '../src/seekrss/bot';
import { AppService } from '../src/seekrss/service';
import { Store } from '../src/seekrss/store';

function fixture(respond?: (method:string, payload:any) => any) {
  const calls: {token:string; method:string; payload:any}[] = [];
  let settings = { admin_telegram_id: '42', paused: false };
  const rules: any[] = [], feeds: any[] = [], targets: any[] = [];
  const service: any = {
    listTargets: () => targets.map(t => ({...t})),
    saveTarget: (input:any) => { const target = {id: targets.length + 1, enabled: true, ...input}; targets.push(target); return target; },
    deleteTarget: (id:number) => { const index = targets.findIndex(t => t.id === id); if (index >= 0) targets.splice(index, 1); },
    listFeeds: () => feeds.map(f => ({ ...f })),
    getFeed: (id:number) => feeds.find(f => f.id === id),
    saveFeed: (input:any, id?:number) => {
      if (id !== undefined) { const feed = feeds.find(f => f.id === id); if (!feed) throw new Error('订阅源不存在'); return Object.assign(feed, input, { revision: feed.revision + 1 }); }
      const feed = {id: feeds.length + 1, revision: 1, enabled: true, interval_seconds: 10, effective_interval_seconds: 10, ...input}; feeds.push(feed); return feed;
    },
    deleteFeed: (id:number) => { const index = feeds.findIndex(f => f.id === id); if (index >= 0) feeds.splice(index, 1); },
    listRules: () => rules.map(r => ({ ...r })),
    setRuleEnabled: (id:number, enabled:boolean) => Object.assign(rules.find(r => r.id === id), { enabled }),
    deleteRule: (id:number) => { const index = rules.findIndex(r => r.id === id); if (index >= 0) rules.splice(index, 1); },
    saveRule: (input:any) => { const rule = { id: rules.length + 1, enabled: true, scope: 'all', feed_id: null, ...input }; rules.push(rule); return rule; },
    getSettings: () => ({ ...settings }),
    store: { getSecretToken: () => '123:fake-test-token' },
    saveSettings: (patch:any) => (settings = { ...settings, ...patch }),
  };
  const bot = new BotController(service, { transport: async (token, method, payload) => {
    calls.push({token, method, payload});
    return respond ? await respond(method, payload) : { ok: true, result: { message_id: calls.length } };
  }});
  const update = (text:string, id:any = 42, type = 'private') => ({
    update_id: 1, message: { message_id: 10, from: { id }, chat: { id, type }, text },
  });
  return { bot, service, calls, update };
}

describe('BotController UX', () => {
  test('/add persists comma separated independent include rules, unlike combo', async () => {
    const { bot, service, calls, update } = fixture();
    await bot.handleUpdate(update('/add Linux, RSS，VPS'));
    expect(service.listRules().map((r:any) => [r.kind, r.terms])).toEqual([
      ['keyword', ['Linux']], ['keyword', ['RSS']], ['keyword', ['VPS']],
    ]);
    expect(calls.at(-1)!.payload.text).toContain('3');
  });
  test('combo and block commands preserve their distinct matching semantics', async () => {
    const { bot, service, update } = fixture();
    await bot.handleUpdate(update('/combo Linux, RSS'));
    await bot.handleUpdate(update('/block spam,广告'));
    await bot.handleUpdate(update('/blockcombo cheap, offer'));
    expect(service.listRules().map((r:any) => [r.kind, r.terms])).toEqual([
      ['combo', ['Linux', 'RSS']], ['block', ['spam']], ['block', ['广告']], ['blockcombo', ['cheap', 'offer']],
    ]);
  });
  test('rule management reads shared live state and confirms deletion', async () => {
    const { bot, service, calls, update } = fixture();
    service.saveRule({kind: 'keyword', terms: ['Web新增']});
    await bot.handleUpdate(update('/off 1'));
    expect(service.listRules()[0].enabled).toBe(false);
    await bot.handleUpdate(update('/on 1'));
    expect(service.listRules()[0].enabled).toBe(true);
    await bot.handleUpdate(update('/list'));
    expect(calls.at(-1)!.payload.text).toContain('Web新增');
    await bot.handleUpdate(update('/del 1'));
    expect(service.listRules()).toHaveLength(1);
    expect(calls.at(-1)!.payload.text).toContain('确认');
    await bot.handleUpdate(update('确认'));
    expect(service.listRules()).toHaveLength(0);
  });
  test('rule wizard can retry validation, cancel and expire without mutation', async () => {
    const {bot, service, calls, update} = fixture();
    await bot.handleUpdate(update('添加组合'));
    expect(calls.at(-1)!.payload.text).toContain('逗号');
    await bot.handleUpdate(update('linux,rss'));
    expect(service.listRules()[0].terms).toEqual(['linux', 'rss']);
    await bot.handleUpdate(update('/add'));
    await bot.handleUpdate(update('/cancel'));
    await bot.handleUpdate(update('ignored'));
    expect(service.listRules()).toHaveLength(1);
    await bot.handleUpdate(update('/block'));
    const now = Date.now;
    Date.now = () => now() + 301_000;
    try { await bot.handleUpdate(update('expired')); } finally { Date.now = now; }
    expect(service.listRules()).toHaveLength(1);
    expect(calls.at(-1)!.payload.text).toContain('超时');
  });
  test('feed commands share CRUD, requested interval and enabled state', async () => {
    const { bot, service, calls, update } = fixture();
    await bot.handleUpdate(update('/feedadd https://example.com/rss Example feed'));
    expect(service.listFeeds()[0].name).toBe('Example feed');
    await bot.handleUpdate(update('/interval 1 1'));
    expect(service.getFeed(1).interval_seconds).toBe(1);
    await bot.handleUpdate(update('/feedpause 1'));
    expect(service.getFeed(1).enabled).toBe(false);
    await bot.handleUpdate(update('/feedresume 1'));
    expect(service.getFeed(1).enabled).toBe(true);
    await bot.handleUpdate(update('/feeds'));
    expect(calls.at(-1)!.payload.text).toContain('https://example.com/rss');
    await bot.handleUpdate(update('/feeddel 1'));
    expect(service.listFeeds()).toHaveLength(1);
    await bot.handleUpdate(update('确认'));
    expect(service.listFeeds()).toHaveLength(0);
  });
  test('feed add and edit wizards collect fields and save only at completion', async () => {
    const {bot, service, calls, update} = fixture();
    await bot.handleUpdate(update('/feedadd'));
    expect(calls.at(-1)?.payload.text).toContain('URL');
    await bot.handleUpdate(update('https://example.com/rss Example'));
    expect(service.listFeeds()).toHaveLength(1);
    await bot.handleUpdate(update('/feededit 1'));
    await bot.handleUpdate(update('New name'));
    expect(service.getFeed(1).name).toBe('Example');
    await bot.handleUpdate(update('https://example.com/atom'));
    await bot.handleUpdate(update('2'));
    await bot.handleUpdate(update('off'));
    expect(service.getFeed(1)).toMatchObject({name:'New name', url:'https://example.com/atom', interval_seconds:2, enabled:false});
    expect(calls.at(-1)?.payload.text).toContain('已更新');
  });
  test('validation failures reply actionably and secret-like chat input never reaches service', async () => {
    const {bot, service, calls, update} = fixture();
    service.saveRule = () => { throw new Error('组合至少需要两个词'); };
    await bot.handleUpdate(update('/combo only'));
    expect(calls.at(-1)?.payload.text).toContain('组合至少需要两个词');
    await bot.handleUpdate(update('/add 123456789:offline_fixture_token_never_valid_12345'));
    expect(calls.at(-1)?.payload.text).toContain('Web');
    await bot.handleUpdate(update('/password hello-secret'));
    expect(calls.at(-1)?.payload.text).toContain('Web');
    expect(JSON.stringify(calls.map(c => c.payload))).not.toContain('hello-secret');
  });
  test('private target identity is limited to the configured administrator', async () => {
    const {bot, service, calls, update} = fixture((method, payload) => ({ok:true, result: method === 'getChat' ? {id:Number(payload.chat_id), type:'private'} : true}));
    await bot.handleUpdate(update('/targetadd 42 My phone'));
    expect(service.listTargets()[0]).toMatchObject({chat_id:'42', name:'My phone'});
    await bot.handleUpdate(update('/targetadd 7 Other phone'));
    expect(service.listTargets()).toHaveLength(1);
    expect(calls.at(-1)?.payload.text).toContain('管理员本人');
    await bot.handleUpdate(update('/targets'));
    expect(calls.at(-1)?.payload.text).toContain('My phone');
    await bot.handleUpdate(update('/targetdel 1'));
    await bot.handleUpdate(update('确认'));
    expect(service.listTargets()).toHaveLength(0);
  });
  test('group and channel targets require admin identity and bot posting rights', async () => {
    let allow = false;
    const {bot, service, calls, update} = fixture((method, payload) => ({ok:true, result:
      method === 'getChat' ? {id:-100123, type:'channel'} :
      method === 'getMe' ? {id:999, is_bot:true} :
      method === 'getChatMember' ? payload.user_id === '42' ? {status: allow ? 'administrator' : 'member', user:{id:42}} : {status:'administrator', can_post_messages:true, user:{id:999}} : true,
    }));
    await bot.handleUpdate(update('/targetadd -100123 Channel'));
    expect(service.listTargets()).toHaveLength(0);
    expect(calls.at(-1)?.payload.text).toContain('管理员权限');
    allow = true;
    await bot.handleUpdate(update('/targetadd -100123 Channel'));
    expect(service.listTargets()[0]).toMatchObject({chat_id:'-100123', name:'Channel'});
    expect(calls.filter(c => c.method === 'getChatMember').map(c => c.payload.user_id)).toContain(999);
  });
  test('status/history/test use actual service data and shared SQLite matching', async () => {
    const store = new Store(':memory:'), service = new AppService(store), messages:string[] = [];
    service.saveSettings({admin_telegram_id:'42'});
    const bot = new BotController(service, {transport: async (_token, _method, payload:any) => {messages.push(payload.text); return {ok:true,result:true};}});
    const update = (text:string) => ({message:{from:{id:42},chat:{id:42,type:'private'},text}});
    try {
      service.saveRule({kind:'combo', terms:['Linux','RSS']});
      await bot.handleUpdate(update('/test Linux RSS'));
      expect(messages.at(-1)).toContain('会推送');
      await bot.handleUpdate(update('/test'));
      await bot.handleUpdate(update('unmatched'));
      expect(messages.at(-1)).toContain('不推送');
      await bot.handleUpdate(update('/status'));
      expect(messages.at(-1)).toContain('config_version');
      await bot.handleUpdate(update('/history'));
      expect(messages.at(-1)).toContain('暂无历史');
    } finally {store.close();}
  });
  test('mobile pause/resume persists through the shared service and reads back the actual result', async () => {
    const {bot, service, calls, update} = fixture();
    await bot.handleUpdate(update('暂停推送'));
    expect(service.getSettings().paused).toBe(true);
    expect(calls.at(-1)!.payload.text).toContain('已暂停');
    await bot.handleUpdate(update('恢复推送'));
    expect(service.getSettings().paused).toBe(false);
    expect(calls.at(-1)!.payload.text).toContain('已恢复');
    service.saveSettings = () => ({paused:true});
    service.getSettings = () => ({admin_telegram_id:'42',paused:true});
    await bot.handleUpdate(update('/resume'));
    expect(calls.at(-1)!.payload.text).toContain('未生效');
  });

  test('long administrator replies remain within the Telegram message limit', async () => {
    const {bot,service,calls,update}=fixture(); for(let i=0;i<60;i++)service.saveRule({kind:'keyword',terms:['x'.repeat(100)]});
    await bot.handleUpdate(update('/list'));
    const messages=calls.filter(c=>c.method==='sendMessage'); expect(messages.length).toBeGreaterThan(1); expect(messages.every(c=>c.payload.text.length<=4000)).toBe(true);
  });
  test('target permission lookup cannot mutate configuration after administrator rotation', async () => {
    let release!:(value:any)=>void; const gate=new Promise(resolve=>release=resolve);
    const {bot,service,update}=fixture((method)=>method==='getChat'?gate:{ok:true,result:true});
    const work=bot.handleUpdate(update('/targetadd 42 stale')); await Bun.sleep(1); service.saveSettings({admin_telegram_id:'77'});
    release({ok:true,result:{id:42,type:'private'}}); await work; expect(service.listTargets()).toHaveLength(0);
  });
  test('a new command cancels pending deletion rather than letting a later confirmation delete data', async () => {
    const {bot, service, update} = fixture(); service.saveRule({kind:'keyword',terms:['keep']});
    await bot.handleUpdate(update('/del 1')); await bot.handleUpdate(update('/help')); await bot.handleUpdate(update('确认'));
    expect(service.listRules()).toHaveLength(1);
  });
  test('target and feed edit menu buttons give actionable input guidance', async () => {
    const {bot,calls,update} = fixture();
    await bot.handleUpdate(update('添加目标')); expect(calls.at(-1)?.payload.text).toContain('chat_id');
    await bot.handleUpdate(update('编辑订阅')); expect(calls.at(-1)?.payload.text).toContain('/feededit');
  });
  test('/start exposes supported commands and a persistent actionable keyboard', async () => {
    const {bot, calls, update} = fixture();
    await bot.handleUpdate(update('/start'));
    const message = calls.find(c => c.method === 'sendMessage')!.payload;
    expect(message.chat_id).toBe('42');
    expect(message.text).toContain('/feededit');
    expect(message.text).toContain('/blockcombo');
    expect(message.reply_markup.is_persistent).toBe(true);
    expect(message.reply_markup.keyboard.flat()).toContain('暂停推送');
  });
});

describe('BotController authorization', () => {
  test('rejects mutable, noncanonical or unsafe administrator IDs even when the message matches', async () => {
    const {bot, service, calls, update} = fixture();
    for (const admin of ['@operator', '042', '-42', '0', '42.0', '9007199254740992']) {
      service.saveSettings({admin_telegram_id:admin});
      await bot.handleUpdate(update('/pause', admin));
    }
    expect(service.getSettings().paused).toBe(false);
    expect(calls).toHaveLength(0);
  });
  test('fails closed without exact configured admin and a matching private chat', async () => {
    const {bot, service, calls, update} = fixture();
    await bot.handleUpdate(update('/pause', 7));
    await bot.handleUpdate(update('/pause', 42, 'supergroup'));
    await bot.handleUpdate({...update('/pause'), message: {...update('/pause').message, chat: { id: 7, type: 'private' }}});
    service.saveSettings({admin_telegram_id: ''});
    await bot.handleUpdate(update('/pause'));
    expect(service.getSettings().paused).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
