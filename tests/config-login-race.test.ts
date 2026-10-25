import {expect,test,spyOn} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';
import {syncAdmin} from '../src/seekrss/admin-config';

test('a pending login cannot create a stale session after locally configured credentials change',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-config-login-race-')),store=new Store(join(dir,'db'));
 let verify:ReturnType<typeof spyOn>|undefined;
 try{
  await syncAdmin(store,{password:'fixture-old-password'});
  const api=createApi(new AppService(store));
  let release!:(v:boolean)=>void,entered!:()=>void;const pending=new Promise<boolean>(r=>release=r),started=new Promise<void>(r=>entered=r);
  verify=spyOn(Bun.password,'verify').mockImplementationOnce((()=>{entered();return pending;}) as any);
  const login=api.fetch(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-old-password'})}));
  await started;verify.mockRestore();verify=undefined;
  await syncAdmin(store,{password:'fixture-new-password'});release(true);
  const response=await login;expect(response.status).toBe(401);expect(response.headers.get('set-cookie')).toBeNull();
  expect(store.db.query('SELECT count(*) n FROM sessions').get()).toEqual({n:0});
 }finally{verify?.mockRestore();store.close();rmSync(dir,{recursive:true,force:true});}
});
