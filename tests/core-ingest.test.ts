import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseFeed} from '../src/seekrss/parser';
const entry=(key:string,title='香港 VPS')=>({item_key:key,title,link:'https://example.com/'+key,summary:'优惠',author:'Ada',category:'交易',published_at:null});
test('parsed empty GUID entries are all archived and replay stays deduplicated',()=>{
 const store=new Store(':memory:');
 try{
  const feed=store.saveFeed({name:'Empty GUID',url:'https://example.com/rss'});
  const entries=parseFeed('<rss><channel><item><guid/><title>First</title></item><item><guid isPermaLink="false"/><title>Second</title></item></channel></rss>',feed.url);
  expect(store.ingestEntries(feed.id,entries)).toEqual({inserted:2,queued:0});
  expect(store.ingestEntries(feed.id,entries)).toEqual({inserted:0,queued:0});
  expect(store.listEntries().total).toBe(2);
 }finally{store.close();}
});

test('ingestion baselines first fetch and persists unique per-target outbox',()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-ingest-'));const s=new Store(join(dir,'db'));
 try{expect(typeof s.saveRule).toBe('function'); if(!s.saveRule)return;
 const f=s.saveFeed({name:'rss',url:'https://example.com/rss'});s.saveRule({kind:'combo',terms:['香港','VPS']});s.saveRule({kind:'block',terms:['求购']});s.saveTarget({name:'me',chat_id:'42'});s.saveTarget({name:'channel',chat_id:'-10042'});
 expect(s.ingestEntries(f.id,[entry('1')])).toEqual({inserted:1,queued:0});
 expect(s.ingestEntries(f.id,[entry('1'),entry('2'),entry('3','求购香港 VPS')])).toEqual({inserted:2,queued:2});
 expect(s.ingestEntries(f.id,[entry('2')]).queued).toBe(0);expect(s.listEntries().total).toBe(3);expect(s.listDeliveries()).toHaveLength(2);
 const job=s.claimDelivery();expect(job?.status).toBe('sending');s.finishDelivery(job!.id,{status:'sent',message_id:123});expect(s.listDeliveries().filter(d=>d.status==='sent')).toHaveLength(1);
 s.saveSettings({paused:true});expect(s.ingestEntries(f.id,[entry('4')]).queued).toBe(0);s.saveSettings({paused:false});expect(s.ingestEntries(f.id,[entry('4')]).queued).toBe(0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
