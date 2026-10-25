import {expect,test,spyOn} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/seekrss/store';
import {AppService} from '../src/seekrss/service';
import {createApi} from '../src/seekrss/api';

const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
test('operator reset link is hashed, expiring, single-use and revokes all old sessions without changing configuration',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-recovery-')),store=new Store(join(dir,'db'));
 try{
  const api=createApi(new AppService(store));
  const post=(path:string,data:any,headers:Record<string,string>={})=>api.fetch(new Request('http://localhost/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost',...headers},body:JSON.stringify(data)}));
  const initial=await post('setup',{username:'acceptance',password:'old-offline-password',setup_key:readFileSync(join(dir,'setup.key'),'utf8').trim()});
  const cookie=initial.headers.get('set-cookie')!.split(';')[0]!;
  store.saveRule({kind:'keyword',terms:['keep-me']});
  const {AdminRecovery}=await import('../src/seekrss/recovery');
  const recovery=new AdminRecovery(store.db),issued=recovery.issue(60_000);
  expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const row=store.db.query('SELECT token_hash,expires_at FROM admin_reset_tokens').get() as any;
  expect(row.token_hash).toBe(sha(issued.token));expect(row.expires_at).toBe(issued.expires_at);
  expect((await post('reset/check',{token:issued.token})).status).toBe(200);
  expect((await post('reset',{token:issued.token,password:'new-offline-password',confirm_password:'new-offline-password'},{Origin:'https://evil.test'})).status).toBe(403);
  expect((await post('reset',{token:issued.token,password:'new-offline-password',confirm_password:'not-the-same'})).status).toBe(400);
  expect((await post('reset',{token:issued.token,password:'short',confirm_password:'short'})).status).toBe(400);
  const result=await post('reset',{token:issued.token,password:'new-offline-password',confirm_password:'new-offline-password'});
  expect(result.status).toBe(200);expect(result.headers.get('set-cookie')).toBeNull();
  expect(store.db.query('SELECT count(*) AS n FROM sessions').get()).toEqual({n:0});
  expect((await api.fetch(new Request('http://localhost/api/feeds',{headers:{Cookie:cookie}}))).status).toBe(401);
  expect(store.listRules()[0]!.terms).toEqual(['keep-me']);
  expect((await post('reset',{token:issued.token,password:'another-offline-password',confirm_password:'another-offline-password'})).status).toBe(403);
  expect((await post('login',{username:'acceptance',password:'old-offline-password'})).status).toBe(401);
  expect((await post('login',{username:'acceptance',password:'new-offline-password'})).status).toBe(200);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('reset tokens expire, supersede predecessors, persist restart and have one concurrent winner',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-reset-life-')),path=join(dir,'db');let store=new Store(path);
 try{
  const {AdminRecovery}=await import('../src/seekrss/recovery');
  store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run('acceptance',await Bun.password.hash('offline-before-reset'));
  let recovery=new AdminRecovery(store.db);
  const first=recovery.issue(),second=recovery.issue();
  expect(()=>recovery.check(first.token)).toThrow();
  expect(()=>recovery.check('')).toThrow();
  expect(()=>recovery.issue(3600_001)).toThrow();
  store.db.query('UPDATE admin_reset_tokens SET expires_at=?').run(Date.now()-1);
  expect(()=>recovery.check(second.token)).toThrow();
  const valid=recovery.issue();store.close();store=new Store(path);recovery=new AdminRecovery(store.db);
  expect(recovery.check(valid.token).username).toBe('acceptance');
  const results=await Promise.allSettled([recovery.reset(valid.token,'offline-one-password','offline-one-password'),recovery.reset(valid.token,'offline-two-password','offline-two-password')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(store.db.query('SELECT count(*) AS n FROM admin_reset_tokens').get()).toEqual({n:0});
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid anonymous reset requests cannot exhaust a valid token budget',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-reset-budget-')),store=new Store(join(dir,'db'));
 try{
  const {AdminRecovery}=await import('../src/seekrss/recovery');
  store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run('acceptance',await Bun.password.hash('offline-before-reset'));
  const api=createApi(new AppService(store)),issued=new AdminRecovery(store.db).issue();
  const check=(token:string)=>api.fetch(new Request('http://localhost/api/auth/reset/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}));
  for(let i=0;i<12;i++)expect((await check('x'.repeat(43))).status).toBe(403);
  expect((await check(issued.token)).status).toBe(200);
  for(let i=0;i<9;i++)expect((await check(issued.token)).status).toBe(200);
  expect((await check(issued.token)).status).toBe(429);
  const replacement=new AdminRecovery(store.db).issue();expect((await check(replacement.token)).status).toBe(200);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a login awaiting old-password verification cannot mint a session after password reset',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-reset-login-race-')),store=new Store(join(dir,'db'));
 let verify:ReturnType<typeof spyOn>|undefined;
 try{
  const {AdminRecovery}=await import('../src/seekrss/recovery');
  store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run('acceptance',await Bun.password.hash('old-offline-password'));
  const api=createApi(new AppService(store)),recovery=new AdminRecovery(store.db),issued=recovery.issue();
  let release!:(value:boolean)=>void;const pending=new Promise<boolean>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  verify=spyOn(Bun.password,'verify').mockImplementation((()=>{entered();return pending;}) as any);
  const login=api.fetch(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'acceptance',password:'old-offline-password'})}));
  await started;await recovery.reset(issued.token,'new-offline-password','new-offline-password');release(true);
  const response=await login;expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(store.db.query('SELECT count(*) AS n FROM sessions').get()).toEqual({n:0});
 }finally{verify?.mockRestore();store.close();rmSync(dir,{recursive:true,force:true});}
});
