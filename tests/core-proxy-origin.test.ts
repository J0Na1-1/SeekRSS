import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {syncAdmin} from '../src/seekrss/admin-config';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';

test('configured HTTPS public origin supports reverse-proxy login without trusting forwarded headers',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-proxy-'));
 const oldOrigin=process.env.PUBLIC_ORIGIN,oldSecure=process.env.COOKIE_SECURE;
 process.env.PUBLIC_ORIGIN='https://192.0.2.10';process.env.COOKIE_SECURE='true';
 const store=new Store(join(dir,'db'));
 try{
  await syncAdmin(store,{password:'offline-proxy-password'});
  const api=createApi(new AppService(store));
  const request=(origin:string,extra:Record<string,string>={})=>api.fetch(new Request('http://192.0.2.10/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...extra},body:JSON.stringify({username:'admin',password:'offline-proxy-password'})}));
  expect((await request('https://evil.test',{'X-Forwarded-Proto':'https','X-Forwarded-Host':'192.0.2.10'})).status).toBe(403);
  expect((await request('http://192.0.2.10')).status).toBe(403);
  const result=await request('https://192.0.2.10');expect(result.status).toBe(200);
  expect(result.headers.get('set-cookie')).toContain('Secure');
  expect(result.headers.get('set-cookie')).toContain('HttpOnly');
 }finally{
  store.close();rmSync(dir,{recursive:true,force:true});
  if(oldOrigin===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=oldOrigin;
  if(oldSecure===undefined)delete process.env.COOKIE_SECURE;else process.env.COOKIE_SECURE=oldSecure;
 }
});
