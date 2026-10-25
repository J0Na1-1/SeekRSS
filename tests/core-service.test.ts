import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import * as services from '../src/seekrss/service';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';

test('shared application service validates CRUD and optimistic updates without exposing secrets',()=>{
 expect(typeof (services as any).AppService).toBe('function');
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-service-'));const store=new Store(join(dir,'db'));
 try{
 const s=new (services as any).AppService(store);
 expect(()=>s.saveFeed({name:'x',url:'file:///etc/passwd'})).toThrow();
 expect(()=>s.saveFeed({name:'x',url:'https://user:secret@example.com/'})).toThrow();
 expect(()=>s.saveFeed({name:'x',url:'https://example.com/',interval_seconds:0})).toThrow();
 const f=s.saveFeed({name:'Test',url:'https://example.com/rss',interval_seconds:1});
 expect(s.listFeeds()).toHaveLength(1);expect(f.effective_interval_seconds).toBe(10);
 expect(()=>s.saveFeed({name:'duplicate',url:f.url})).toThrow('已存在');
 expect(()=>s.saveRule({kind:'combo',terms:['only one']})).toThrow();
 expect(()=>s.saveRule({kind:'keyword',terms:['one','two']})).toThrow();
 const r=s.saveRule({kind:'combo',terms:['香港','VPS'],feed_id:f.id});
 expect(s.testRule({text:'香港 vps',feed_id:f.id}).would_push).toBe(true);
 s.saveRule({...r,name:'updated'},r.id);expect(()=>s.saveRule({...r,revision:1},r.id)).toThrow('版本冲突');
 expect(s.setRuleEnabled(r.id,false).enabled).toBe(false);
 expect(s.testRule({text:'香港 vps',feed_id:f.id}).would_push).toBe(false);
 expect(()=>s.saveTarget({name:'bad',chat_id:'not an id'})).toThrow();
 const t=s.saveTarget({name:'me',chat_id:'42'});expect(s.listTargets()).toHaveLength(1);
 expect(()=>s.saveSettings({host_min_interval_seconds:0})).toThrow();
 expect(()=>s.saveSettings({bot_token:'garbage'})).toThrow();
 s.saveSettings({paused:true,host_min_interval_seconds:1});expect(s.getSettings().paused).toBe(true);expect(s.getFeed(f.id).effective_interval_seconds).toBe(1);
 s.deleteTarget(t.id);s.deleteRule(r.id);s.deleteFeed(f.id);expect(s.listFeeds()).toEqual([]);expect(s.listRules()).toEqual([]);expect(s.listTargets()).toEqual([]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
