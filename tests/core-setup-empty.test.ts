import {expect,test} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';

test('Compose empty SETUP_KEY requires the generated nonempty bootstrap key',async()=>{
 const previous=process.env.SETUP_KEY;process.env.SETUP_KEY='';
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-setup-empty-'));const store=new Store(join(dir,'db'));
 try{
  const api=createApi(new AppService(store));
  const setup=(setup_key:string)=>api.fetch(new Request('http://localhost/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'offline-test-password',setup_key})}));
  expect((await setup('')).status).toBe(403);
  expect(store.db.query('SELECT id FROM admin').get()).toBeNull();
  const key=readFileSync(join(dir,'setup.key'),'utf8').trim();expect(key.length).toBeGreaterThan(20);
  expect((await setup(key)).status).toBe(200);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.SETUP_KEY;else process.env.SETUP_KEY=previous;}
});
