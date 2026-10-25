import {expect,test} from 'bun:test';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Store} from '../src/seekrss/store';import {Engine} from '../src/seekrss/engine';

test('outbox retries unknown network results, stops permanent errors, and recovers sending after restart',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seekrss-retry-'));const path=join(dir,'db');let store=new Store(path);let now=1000;let calls=0;
 try{
 const feed=store.saveFeed({name:'test',url:'https://example.com/rss',backfill:true});store.saveRule({kind:'keyword',terms:['GPU']});store.saveTarget({name:'test',chat_id:'42'});store.saveSettings({bot_token:'offline-token'});
 store.ingestEntries(feed.id,[{item_key:'retry',title:'GPU',summary:'',author:'',category:'',link:'',published_at:null}]);
 const engine=new Engine(store,{now:()=>now,telegramTransport:async()=>{calls++;throw new Error('private-token-and-url');}});
 await engine.sendPending();expect(store.listDeliveries()[0]).toMatchObject({status:'retry',attempts:1,next_attempt_at:3000});expect(store.listDeliveries()[0].error).not.toContain('private-token');
 now=3000;store.claimDelivery(now);store.close();store=new Store(path);
 const restart=new Engine(store,{now:()=>now,telegramTransport:async()=>{calls++;return {ok:false,error_code:403};}});restart.start();await Bun.sleep(30);await restart.stop();
 expect(store.listDeliveries()[0]).toMatchObject({status:'failed',attempts:3});now=100000;await restart.sendPending();expect(calls).toBe(2);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
