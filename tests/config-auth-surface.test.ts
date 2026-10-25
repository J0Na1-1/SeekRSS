import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';
import {createWebApp} from '../src/seekrss/app';

test('no HTTP setup or password recovery surface remains, even for an authenticated administrator',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-no-recovery-')),store=new Store(join(dir,'db'));
 try{
  const {syncAdmin}=await import('../src/seekrss/admin-config');await syncAdmin(store,{password:'fixture-config-password'});
  const app=createWebApp(createApi(new AppService(store)));
  const login=await app.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-config-password'})});
  expect(login.status).toBe(200);const body=await login.json() as any;
  const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':body.data.csrf};
  for(const path of ['/reset','/js/reset.js'])expect((await app.request(path)).status).toBe(404);
  for(const path of ['/api/auth/setup','/api/auth/reset','/api/auth/reset/check']){
   expect((await app.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(404);
   expect((await app.request(path,{method:'POST',headers,body:'{}'})).status).toBe(404);
  }
  const html=await (await app.request('/')).text();expect(html).not.toContain('setup_key');expect(html).not.toContain('fixture-config-password');
  expect(store.db.query("SELECT name FROM sqlite_master WHERE name='admin_reset_tokens'").get()).toBeNull();
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
