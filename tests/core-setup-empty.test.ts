import {expect,test} from 'bun:test';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';

test('an uninitialized API cannot create an administrator remotely or generate a bootstrap key',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-no-web-setup-')),store=new Store(join(dir,'db'));
 try{
  const api=createApi(new AppService(store));
  const result=await api.fetch(new Request('http://localhost/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-cannot-register',setup_key:''})}));
  expect(result.status).toBe(404);expect(store.db.query('SELECT * FROM admin').get()).toBeNull();
  expect(existsSync(join(dir,'setup.key'))).toBe(false);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
