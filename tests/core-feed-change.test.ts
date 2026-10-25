import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';

test('changing source URL creates a new baseline and clears validators without losing old archive',()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-url-'));const s=new Store(join(dir,'db'));
 try{const f=s.saveFeed({name:'one',url:'https://example.com/one'});s.updateFeedRuntime(f.id,{initialized:true,etag:'old',last_modified:'old',cooldown_until:9999,failure_count:4});
 const next=s.saveFeed({url:'https://example.com/two'},f.id);expect(next.initialized).toBe(false);expect(next.etag).toBeNull();expect(next.last_modified).toBeNull();expect(next.cooldown_until).toBe(0);expect(next.failure_count).toBe(0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
