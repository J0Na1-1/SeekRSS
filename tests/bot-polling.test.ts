import {describe, test, expect, afterEach} from 'bun:test';
import {Database} from 'bun:sqlite';
import {BotController} from '../src/seekrss/bot';

const resources:{bot:BotController;db:Database}[] = [];
afterEach(async () => { for (const {bot,db} of resources.splice(0)) { await bot.stop(); db.close(); } });
const delay = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate:() => boolean) {
  const deadline = Date.now() + 2500; // Shared sends enforce at least one second between replies.
  while (!predicate() && Date.now() < deadline) await delay(2);
  expect(predicate()).toBe(true);
}
function deferred<T = any>() {
  let resolve!:(value:T) => void;
  const promise = new Promise<T>(done => {resolve=done;});
  return {promise,resolve};
}
const update = (id:number, text:string, admin=42) => ({update_id:id,message:{from:{id:admin},chat:{id:admin,type:'private'},text}});

function setup(overrides?: (method:string, payload:any, token:string, signal?:AbortSignal) => any) {
  let token = '123456:fake-transport-token', admin = '42';
  const calls:{token:string;method:string;payload:any}[] = [];
  let commands:any[] = [];
  const db = new Database(':memory:');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY,value INTEGER NOT NULL)');
  const rules:any[] = [];
  const service:any = {getSettings:() => ({admin_telegram_id:admin}),
    store:{getSecretToken:() => token, db},
    saveRule:(rule:any) => {rules.push(rule); return rule;}, listRules:() => rules,
  };
  const transport = async (token:string,method:string,payload:any,signal?:AbortSignal) => {
    calls.push({token,method,payload});
    const custom = overrides?.(method,payload,token,signal);
    if (custom !== undefined) return custom;
    if (method === 'getWebhookInfo') return {ok:true,result:{url:''}};
    if (method === 'setMyCommands') {commands=payload.commands; return {ok:true,result:true};}
    if (method === 'getMyCommands') return {ok:true,result:commands};
    if (method === 'getUpdates') return new Promise(() => {});
    return {ok:true,result:true};
  };
  const bot = new BotController(service, {transport});
  resources.push({bot,db});
  return {bot,calls,service,db,transport,setToken:(value:string) => {token=value;},setAdmin:(value:string) => {admin=value;}};
}

describe('safe long polling', () => {
  test('active webhook is not overwritten and status explains the blocker', async () => {
    const {bot,calls} = setup(method => method === 'getWebhookInfo' ? {ok:true,result:{url:'https://existing.example/webhook-secret'}} : undefined);
    await bot.start();
    expect(bot.status().running).toBe(false);
    expect((bot.status() as any).last_error).toContain('webhook');
    expect(calls.some(c => c.method === 'deleteWebhook' || c.method === 'getUpdates' || c.method === 'setMyCommands')).toBe(false);
    expect(JSON.stringify(bot.status())).not.toContain('webhook-secret');
    await bot.stop();
  });
  test('uses the official transport by default without making a live request', async () => {
    const original = globalThis.fetch;
    const requests:string[] = [];
    globalThis.fetch = (async (input:any) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ok:true,result:{url:'https://owned.example/hook'}}));
    }) as typeof fetch;
    const bot = new BotController({getSettings:() => ({admin_telegram_id:'42'}), store:{getSecretToken:() => '123456:fake-offline-token'}} as any);
    try {
      await bot.start();
      expect(requests).toEqual(['https://api.telegram.org/bot123456:fake-offline-token/getWebhookInfo']);
      expect(bot.status().last_error).toContain('webhook');
    } finally { await bot.stop(); globalThis.fetch = original; }
  });
  test('registers and reads back commands for the exact administrator chat scope', async () => {
    const {bot,calls} = setup();
    try {
      await bot.start();
      const writes = calls.filter(c => c.method === 'setMyCommands');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.payload.scope).toEqual({type:'chat', chat_id:'42'});
      expect(writes[0]!.payload.commands.map((c:any) => c.command)).toContain('feededit');
      expect(writes[0]!.payload.commands.map((c:any) => c.command)).toContain('cancel');
      expect(calls.find(c => c.method === 'getMyCommands')!.payload.scope).toEqual(writes[0]!.payload.scope);
      expect(bot.status().running).toBe(true);
    } finally { await bot.stop(); }
  });
  test('does not claim running when the command scope read-back differs', async () => {
    const {bot,calls} = setup(method => method === 'getMyCommands' ? {ok:true,result:[]} : undefined);
    await bot.start();
    expect(bot.status().running).toBe(false);
    expect(bot.status().last_error).toContain('命令');
    expect(calls.some(c => c.method === 'getUpdates')).toBe(false);
    await bot.stop();
  });
  test('long polls serially and resumes the durable offset after a controller restart', async () => {
    const gate = deferred();
    let polls = 0;
    const {bot,calls,service,transport} = setup((method,payload) => {
      if (method === 'getUpdates' && ++polls === 1) return {ok:true,result:[update(10,'/add first'),update(11,'/add second')]};
      if (method === 'sendMessage' && payload.text.includes('已添加') && service.listRules().length === 1) return gate.promise;
    });
    await bot.start();
    await until(() => service.listRules().length === 1);
    expect(calls.filter(c => c.method === 'getUpdates')).toHaveLength(1);
    expect(service.listRules().map((r:any) => r.terms[0])).toEqual(['first']);
    gate.resolve({ok:true,result:true});
    await until(() => calls.filter(c => c.method === 'getUpdates').length === 2);
    const second = calls.filter(c => c.method === 'getUpdates')[1]!.payload;
    expect(second).toMatchObject({offset:12,timeout:25,allowed_updates:['message']});
    await bot.stop();
    const restarted = new BotController(service,{transport});
    try {
      await restarted.start();
      await until(() => calls.filter(c => c.method === 'getUpdates').length === 3);
      expect(calls.filter(c => c.method === 'getUpdates')[2]!.payload.offset).toBe(12);
      expect(service.getSettings().admin_telegram_id).toBe('42');
    } finally { await restarted.stop(); }
  });
  test('unreadable encrypted credentials fail closed with a redacted runtime error', async () => {
    const {bot,service,calls}=setup(); service.store.getSecretToken=()=>{throw new Error('secret-path raw-token');};
    await bot.start(); expect(bot.status().running).toBe(false); expect(calls).toHaveLength(0);
    expect(bot.status().last_error).toContain('凭据'); expect(JSON.stringify(bot.status())).not.toContain('raw-token');
  });
  test('transient startup network failure can recover after bounded backoff', async () => {
    let fail=true; const {bot,calls}=setup(method=>method==='getWebhookInfo'&&fail?Promise.reject(new Error('offline')):undefined);
    await bot.start(); expect(bot.status().running).toBe(false); await bot.sync(); expect(calls.filter(c=>c.method==='getWebhookInfo')).toHaveLength(1);
    fail=false; const realNow=Date.now; Date.now=()=>realNow()+31_000;
    try{await bot.sync(); expect(bot.status().running).toBe(true);}finally{Date.now=realNow;}
  });
  test('rotating token or administrator rejects old poll results and clears wizard state', async () => {
    const stale = deferred(); let first = true;
    const { bot, service, calls, setToken, setAdmin } = setup((method) => {
      if (method === 'getUpdates' && first) { first = false; return stale.promise; }
    });
    await bot.start(); await bot.handleUpdate(update(1, '/add'));
    setToken('987654:replacement_offline_token'); setAdmin('77'); await bot.sync();
    stale.resolve({ ok: true, result: [update(8, '/add stale')] });
    await delay(20);
    await bot.handleUpdate(update(9, 'not-a-rule', 77));
    expect(service.listRules()).toHaveLength(0);
    expect(calls.filter(c => c.method === 'getUpdates').at(-1)!.token).toBe('987654:replacement_offline_token');
    expect(calls.filter(c => c.method === 'getUpdates').at(-1)!.payload.offset).toBe(0);
    expect(JSON.stringify(bot.status())).not.toContain('replacement_offline');
  });
  test('409 stops polling rather than fighting another instance', async () => {
    const { bot, calls } = setup(method => method === 'getUpdates' ? { ok: false, error_code: 409 } : undefined);
    await bot.start(); await until(() => !bot.status().running); await delay(300);
    expect(calls.filter(c => c.method === 'getUpdates')).toHaveLength(1);
    expect(bot.status().last_error).toContain('409');
  });
  test('429 obeys retry_after and stop cancels cooldown promptly', async () => {
    const { bot, calls } = setup(method => method === 'getUpdates' ? { ok: false, error_code: 429, parameters: { retry_after: 10 } } : undefined);
    await bot.start(); await delay(150);
    expect(calls.filter(c => c.method === 'getUpdates')).toHaveLength(1);
    const started = Date.now(); await bot.stop(); expect(Date.now() - started).toBeLessThan(100);
  });
  test('start fails closed until token and admin are configured', async () => {
    const {bot,calls,setToken,setAdmin} = setup();
    setAdmin('');
    await bot.start();
    expect(calls).toHaveLength(0);
    expect(bot.status().running).toBe(false);
    setAdmin('42');setToken('');
    await bot.sync();
    expect(calls).toHaveLength(0);
    await bot.stop();
  });
});
