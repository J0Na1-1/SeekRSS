import {expect,test} from 'bun:test';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store} from '../src/seekrss/store';
test('deleted configuration IDs are never recycled for stale Web or Telegram commands',()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-id-'));const s=new Store(join(dir,'db'));
 try{const f=s.saveFeed({name:'a',url:'https://example.com/a'});s.deleteFeed(f.id);expect(s.saveFeed({name:'b',url:'https://example.com/b'}).id).toBeGreaterThan(f.id);
 const r=s.saveRule({kind:'keyword',terms:['a']});s.deleteRule(r.id);expect(s.saveRule({kind:'keyword',terms:['b']}).id).toBeGreaterThan(r.id);
 const t=s.saveTarget({name:'a',chat_id:'42'});s.deleteTarget(t.id);expect(s.saveTarget({name:'b',chat_id:'43'}).id).toBeGreaterThan(t.id);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
