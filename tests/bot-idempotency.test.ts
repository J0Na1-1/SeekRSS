import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';import {AppService} from '../src/seekrss/service';import {BotController} from '../src/seekrss/bot';

test('wizard input is restored after both prompt and error replies fail, then replay advances only once',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-bot-wizard-'));const store=new Store(join(dir,'db'));
 try{
  const service=new AppService(store);store.saveSettings({admin_telegram_id:'42'});
  const feed=service.saveFeed({url:'https://example.com/rss',name:'Original'});
  let fail=false;const bot=new BotController(service,{transport:async()=>{if(fail)throw new Error('offline');return {ok:true,result:true};}});
  const update=(id:number,text:string)=>({update_id:id,message:{from:{id:42},chat:{id:42,type:'private'},text}});
  const apply=(id:number,text:string)=>bot.handleUpdate(update(id,text),{key:'telegram_offset_wizard',offset:id+1});
  await apply(100,`/feededit ${feed.id}`);
  fail=true;await expect(apply(101,'Renamed')).rejects.toThrow('offline');
  fail=false;await apply(101,'Renamed');await apply(101,'Renamed');
  await apply(102,'https://example.com/new');await apply(103,'2');await apply(104,'off');
  expect(store.getFeed(feed.id)).toMatchObject({name:'Renamed',url:'https://example.com/new',interval_seconds:2,enabled:false});
  expect(store.db.query("SELECT value FROM meta WHERE key='telegram_offset_wizard'").get()).toEqual({value:105});
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},15000);

test('a multi-rule mutation rolls back completely when a later rule fails validation',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-bot-atomic-'));const store=new Store(join(dir,'db'));
 try{
  const service=new AppService(store);store.saveSettings({admin_telegram_id:'42'});
  const bot=new BotController(service,{transport:async()=>({ok:true,result:true})});
  await bot.handleUpdate({update_id:20,message:{from:{id:42},chat:{id:42,type:'private'},text:'/add valid,'+'x'.repeat(101)}},{key:'telegram_offset_offline',offset:21});
  expect(store.listRules()).toHaveLength(0);
  expect(store.db.query("SELECT value FROM meta WHERE key='telegram_offset_offline'").get()).toBeNull();
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a committed Bot mutation is never replayed after reply failure and controller/database restart',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-bot-replay-'));const path=join(dir,'db');let store=new Store(path);let bot:BotController|undefined;
 const update={update_id:10,message:{from:{id:42},chat:{id:42,type:'private'},text:'/add first,second'}};
 const boot=async()=>{
  let commands:any[]=[];let polled=false;
  bot=new BotController(new AppService(store),{transport:async(_token,method,payload:any)=>{
   if(method==='getWebhookInfo')return {ok:true,result:{url:''}};
   if(method==='setMyCommands'){commands=payload.commands;return {ok:true,result:true};}
   if(method==='getMyCommands')return {ok:true,result:commands};
   if(method==='getUpdates'){if(!polled){polled=true;return {ok:true,result:[update]};}return new Promise(()=>{});}
   if(method==='sendMessage')throw new Error('offline reply failed');
   return {ok:true,result:true};
  }});
  await bot.start();await Bun.sleep(30);
 };
 try{
  store.saveSettings({admin_telegram_id:'42',bot_token:'offline-token'});
  await boot();expect(store.listRules()).toHaveLength(2);await bot!.stop();await Bun.sleep(5);store.close();store=new Store(path);
  await boot();expect(store.listRules()).toHaveLength(2);
  expect((store.db.query("SELECT value FROM meta WHERE key LIKE 'telegram_offset_%'").get() as any)?.value).toBe(11);
 }finally{await bot?.stop();await Bun.sleep(5);store.close();rmSync(dir,{recursive:true,force:true});}
});
