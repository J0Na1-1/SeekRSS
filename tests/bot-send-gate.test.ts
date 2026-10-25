import {expect,test} from 'bun:test';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';import {AppService} from '../src/seekrss/service';import {Engine} from '../src/seekrss/engine';import {BotController} from '../src/seekrss/bot';

test('Bot replies respect outbox 429 and never immediately send an error reply after their own 429',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-send-gate-'));const store=new Store(join(dir,'db'));let now=Date.now();const calls:string[]=[];
 const transport=async(_token:string,method:string)=>{calls.push(method);return {ok:false,error_code:429,parameters:{retry_after:120}};};
 const message={message:{from:{id:42},chat:{id:42,type:'private'},text:'/status'}};
 try{
  store.saveSettings({bot_token:'offline-token',admin_telegram_id:'42'});const f=store.saveFeed({name:'test',url:'https://example.com/rss',backfill:true});store.saveRule({kind:'keyword',terms:['GPU']});store.saveTarget({name:'me',chat_id:'42'});
  store.ingestEntries(f.id,[{item_key:'1',title:'GPU',summary:'',link:'',author:'',category:'',published_at:null}]);
  const engine=new Engine(store,{now:()=>now,telegramTransport:transport});await engine.sendPending();
  const bot=new BotController(new AppService(store),{transport});
  await bot.handleUpdate(message);expect(calls).toEqual(['sendMessage']);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Bot reply 429 is persisted and stops its error reply and all outbox sends',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-bot-429-'));const store=new Store(join(dir,'db'));let calls=0;
 try{
  store.saveSettings({bot_token:'offline-token',admin_telegram_id:'42'});
  const transport=async()=>{calls++;return {ok:false,error_code:429,parameters:{retry_after:120}};};
  const bot=new BotController(new AppService(store),{transport});
  await bot.handleUpdate({message:{from:{id:42},chat:{id:42,type:'private'},text:'/status'}});
  expect(calls).toBe(1);
  await bot.handleUpdate({message:{from:{id:42},chat:{id:42,type:'private'},text:'/status'}});
  const f=store.saveFeed({url:'https://example.com/rss',name:'test',backfill:true});store.saveRule({kind:'keyword',terms:['GPU']});store.saveTarget({name:'me',chat_id:'42'});store.ingestEntries(f.id,[{item_key:'1',title:'GPU',summary:'',link:'',author:'',category:'',published_at:null}]);
  const engine=new Engine(store,{telegramTransport:transport});
  await engine.sendPending();expect(calls).toBe(1);expect(store.listDeliveries()[0]?.attempts).toBe(0);
  await expect(engine.testTelegram()).rejects.toThrow('冷却');
  expect(calls).toBe(1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
