import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

test('HTTP bootstrap, durable session, CSRF, authenticated CRUD and redaction',async()=>{
 let factory:any;try{factory=(await import('../src/seekrss/api')).createApi;}catch{}
 expect(typeof factory).toBe('function');
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-api-'));const store=new Store(join(dir,'db'));
 try{const service=new AppService(store);let api=factory(service);let cookie='',csrf='';
 const req=async(path:string,method='GET',data?:unknown,extra:Record<string,string>={})=>{const r=await api.fetch(new Request('http://localhost/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}));return {r,b:await r.json() as any};};
 expect((await req('/feeds')).r.status).toBe(401);expect((await req('/entries')).r.status).toBe(401);
 expect((await req('/auth/status')).b.data.initialized).toBe(false);
 expect((await req('/auth/setup','POST',{username:'admin',password:'offline-test-password',setup_key:'wrong'})).r.status).toBe(403);
 const setup=await req('/auth/setup','POST',{username:'admin',password:'offline-test-password',setup_key:readFileSync(join(dir,'setup.key'),'utf8').trim()});expect(setup.r.status).toBe(200);cookie=setup.r.headers.get('set-cookie')!.split(';')[0]!;
 expect(setup.r.headers.get('set-cookie')).toContain('HttpOnly');expect(setup.r.headers.get('set-cookie')).toContain('SameSite=Strict');
 csrf=(await req('/auth/status')).b.data.csrf;expect(csrf.length).toBeGreaterThan(20);
 expect((await req('/feeds','POST',{name:'n',url:'https://example.com/rss'},{'X-CSRF-Token':'wrong'})).r.status).toBe(403);
 expect((await req('/feeds','POST',{name:'n',url:'https://example.com/rss'},{Origin:'https://evil.test'})).r.status).toBe(403);
 const feed=await req('/feeds','POST',{name:'n',url:'https://example.com/rss'});expect(feed.b.data.name).toBe('n');
 expect((await req('/rules','POST',{kind:'keyword',terms:['VPS']})).b.ok).toBe(true);
 expect((await req('/targets','POST',{name:'me',chat_id:'42'})).b.ok).toBe(true);
 const token='123456:offline_TestToken_1234567890';const settings=await req('/settings','PUT',{bot_token:token,admin_telegram_id:'42'});expect(JSON.stringify(settings.b)).not.toContain(token);expect(settings.b.data.token_configured).toBe(true);
 api=factory(service);expect((await req('/feeds')).b.data).toHaveLength(1);
 expect((await req('/auth/logout','POST',{})).b.ok).toBe(true);expect((await req('/feeds')).r.status).toBe(401);
 const login=await req('/auth/login','POST',{username:'admin',password:'offline-test-password'});expect(login.b.ok).toBe(true);expect(login.r.headers.get('set-cookie')).toBeTruthy();
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
