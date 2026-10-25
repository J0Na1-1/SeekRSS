import {expect,test} from 'bun:test';import {Store} from '../src/seekrss/store';import {Engine} from '../src/seekrss/engine';

test('stopping during redirect spacing cancels the wait and does not initialize the feed',async()=>{
 const store=new Store(':memory:');let calls=0;let started!:()=>void;const firstRequest=new Promise<void>(resolve=>started=resolve);
 const engine=new Engine(store,{fetcher:(async(url:string)=>{
  calls++;started();return url.endsWith('/rss')?new Response('',{status:301,headers:{location:'/canonical'}}):new Response('<rss><channel><item><guid>1</guid></item></channel></rss>');
 }) as any});
 try{
  store.saveSettings({host_min_interval_seconds:1});const feed=store.saveFeed({url:'https://8.8.8.8/rss',name:'stop',interval_seconds:1});
  const job=engine.pollFeed(feed.id);await firstRequest;await Bun.sleep(10);
  const before=Date.now();await engine.stop();await job;
  expect(Date.now()-before).toBeLessThan(250);expect(calls).toBe(1);expect(store.getFeed(feed.id)?.initialized).toBe(false);
 }finally{await engine.stop();store.close();}
});

test('a sixteen-second host floor does not consume the network transfer deadline',async()=>{
 const store=new Store(':memory:');const starts:number[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:16});const feed=store.saveFeed({url:'https://8.8.8.8/rss',name:'long floor',interval_seconds:16});
  const engine=new Engine(store,{fetcher:(async(url:string)=>{
   starts.push(Date.now());return url.endsWith('/rss')?new Response('',{status:301,headers:{location:'/canonical'}}):new Response('<rss><channel><item><guid>long-floor</guid><title>First</title></item></channel></rss>');
  }) as any});
  const result=await engine.pollFeed(feed.id);
  expect(result).not.toHaveProperty('error');expect(store.getFeed(feed.id)?.initialized).toBe(true);
  expect(starts).toHaveLength(2);expect(starts[1]!-starts[0]!).toBeGreaterThanOrEqual(15950);
 }finally{store.close();}
},25000);

test('cross-host then same-host redirects retain chain ownership and do not starve',async()=>{
 const store=new Store(':memory:');const requests:string[]=[];const starts:number[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:1});const feed=store.saveFeed({url:'https://8.8.8.8/rss',name:'chain',interval_seconds:1});
  const engine=new Engine(store,{fetcher:(async(url:string)=>{
   requests.push(url);starts.push(Date.now());
   if(url==='https://8.8.8.8/rss')return new Response('',{status:302,headers:{location:'https://9.9.9.9/feed'}});
   if(url==='https://9.9.9.9/feed')return new Response('',{status:301,headers:{location:'/canonical'}});
   return new Response('<rss><channel><item><guid>1</guid><title>First</title></item></channel></rss>');
  }) as any});
  const result=await engine.pollFeed(feed.id);
  expect(result).not.toHaveProperty('skipped');expect(store.getFeed(feed.id)?.initialized).toBe(true);
  expect(requests).toEqual(['https://8.8.8.8/rss','https://9.9.9.9/feed','https://9.9.9.9/canonical']);
  expect(starts[2]!-starts[1]!).toBeGreaterThanOrEqual(950);
 }finally{store.close();}
});

test('same-host redirects obey spacing without permanently starving a valid feed',async()=>{
 const store=new Store(':memory:');let now=Date.now();const starts:number[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:1});const feed=store.saveFeed({url:'https://8.8.8.8/rss',name:'redirect',interval_seconds:1});
  const engine=new Engine(store,{fetcher:(async(url:string)=>{starts.push(Date.now());return url.endsWith('/rss')?new Response('',{status:301,headers:{location:'/canonical'}}):new Response('<rss><channel><item><guid>1</guid><title>GPU</title></item></channel></rss>');}) as any});
  await engine.pollFeed(feed.id);
  expect(store.getFeed(feed.id)?.initialized).toBe(true);expect(starts).toHaveLength(2);expect(starts[1]!-starts[0]!).toBeGreaterThanOrEqual(950);
 }finally{store.close();}
});

test('a redirect chain keeps intermediate-host ownership until its final response finishes',async()=>{
 const store=new Store(':memory:');let now=1000;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reached!:()=>void;const final=new Promise<void>(resolve=>reached=resolve);const requests:string[]=[];const jobs:Promise<unknown>[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:1});const chain=store.saveFeed({url:'https://8.8.8.8/rss',name:'chain'});const direct=store.saveFeed({url:'https://9.9.9.9/direct',name:'direct'});
  const engine=new Engine(store,{now:()=>now,fetcher:(async(url:string)=>{
   requests.push(url);
   if(url==='https://8.8.8.8/rss')return new Response('',{status:302,headers:{location:'https://9.9.9.9/feed'}});
   if(url==='https://9.9.9.9/feed')return new Response('',{status:302,headers:{location:'https://1.1.1.1/final'}});
   reached();await gate;return new Response('<rss><channel/></rss>');
  }) as any});
  jobs.push(engine.pollFeed(chain.id));await final;now=4000;
  expect(await engine.pollFeed(direct.id)).toMatchObject({skipped:'concurrency'});
  expect(requests).not.toContain('https://9.9.9.9/direct');release();await Promise.all(jobs);
  await engine.pollFeed(direct.id);expect(requests).toContain('https://9.9.9.9/direct');
 }finally{release();await Promise.all(jobs);store.close();}
});

test('redirect target remains single-flight even after its interval has elapsed',async()=>{
 const store=new Store(':memory:');let now=1000;let release!:()=>void;const gate=new Promise<void>(r=>release=r);let targetCalls=0;
 const jobs:Promise<unknown>[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:1});
  const a=store.saveFeed({url:'https://8.8.8.8/a',name:'A',interval_seconds:1});const b=store.saveFeed({url:'https://1.1.1.1/b',name:'B',interval_seconds:1});
  const engine=new Engine(store,{now:()=>now,fetcher:(async(url:string)=>{
   if(new URL(url).hostname!=='9.9.9.9')return new Response('',{status:302,headers:{location:'https://9.9.9.9/rss'}});
   targetCalls++;await gate;return new Response('<rss><channel/></rss>');
  }) as any});
  jobs.push(engine.pollFeed(a.id));await Bun.sleep(10);now=4000;
  jobs.push(engine.pollFeed(b.id));await Bun.sleep(10);expect(targetCalls).toBe(1);
 }finally{release();await Promise.all(jobs);store.close();}
});

test('redirect destinations share durable host cooldown with direct and unrelated origin feeds',async()=>{
 const store=new Store(':memory:');let now=1000;const requests:string[]=[];
 try{
  store.saveSettings({host_min_interval_seconds:1});
  const a=store.saveFeed({url:'https://8.8.8.8/a',name:'A',interval_seconds:1});
  const b=store.saveFeed({url:'https://1.1.1.1/b',name:'B',interval_seconds:1});
  const direct=store.saveFeed({url:'https://9.9.9.9/direct',name:'target',interval_seconds:1});
  const fetcher=(async(url:string)=>{
   requests.push(url);
   if(new URL(url).hostname!=='9.9.9.9')return new Response('',{status:302,headers:{location:'https://9.9.9.9/rss'}});
   return new Response('limited',{status:429,headers:{'retry-after':'120'}});
  }) as unknown as typeof fetch;
  await new Engine(store,{now:()=>now,fetcher}).pollFeed(a.id);
  await new Engine(store,{now:()=>now,fetcher}).pollFeed(b.id);
  await new Engine(store,{now:()=>now,fetcher}).pollFeed(direct.id);
  expect(requests.filter(u=>new URL(u).hostname==='9.9.9.9')).toHaveLength(1);
  expect(store.db.query('SELECT cooldown_until FROM host_budgets WHERE host=?').get('9.9.9.9')).toEqual({cooldown_until:121000});
  expect(store.getFeed(b.id)!.initialized).toBe(false);
 }finally{store.close();}
});
