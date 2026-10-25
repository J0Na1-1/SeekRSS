import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';import {Engine} from '../src/seekrss/engine';

test('real local publisher uses one-second cadence, baseline then delivers once under three seconds',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seekrss-local-loop-'));const store=new Store(join(dir,'db'));
 let published=false,visibleAt=0,acceptedAt=0;const requests:number[]=[];const accepted:any[]=[];
 const publisher=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests.push(Date.now());return new Response(`<rss><channel><item><guid>old</guid><title>GPU old</title></item>${published?'<item><guid>new</guid><title>GPU new</title><link>https://example.com/post</link></item>':''}</channel></rss>`,{headers:{'content-type':'application/rss+xml'}});}});
 store.saveSettings({host_min_interval_seconds:1,bot_token:'offline-token'});const feed=store.saveFeed({name:'LOCAL TEST',url:`http://127.0.0.1:${publisher.port}/rss`,interval_seconds:1});store.saveRule({kind:'keyword',terms:['GPU']});store.saveTarget({name:'Offline transport',chat_id:'42'});
 const engine=new Engine(store,{allowPrivateForTests:true,telegramTransport:async(_t,_m,p)=>{accepted.push(p);acceptedAt=Date.now();return {ok:true,result:{message_id:91}};}});
 const until=async(fn:()=>boolean)=>{const deadline=Date.now()+3500;while(!fn()&&Date.now()<deadline)await Bun.sleep(10);expect(fn()).toBe(true);};
 try{engine.start();await until(()=>store.getFeed(feed.id)!.initialized);expect(accepted).toHaveLength(0);published=true;visibleAt=Date.now();await until(()=>accepted.length===1);expect(acceptedAt-visibleAt).toBeLessThan(3000);await Bun.sleep(1100);expect(accepted).toHaveLength(1);expect(requests.length).toBeGreaterThanOrEqual(3);expect(requests.slice(1).every((n,i)=>n-requests[i]!>=950)).toBe(true);expect(store.listDeliveries()[0]).toMatchObject({status:'sent',message_id:91});}
 finally{await engine.stop();publisher.stop(true);store.close();rmSync(dir,{recursive:true,force:true});}
});
