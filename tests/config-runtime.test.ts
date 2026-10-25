import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
function environment(){const env={...process.env};for(const key of ['ADMIN_PASSWORD','ADMIN_USERNAME','DATABASE_PATH','PUBLIC_ORIGIN','COOKIE_SECURE','PORT','HOST','NODE_ENV'])delete env[key];return env;}

test('production startup fails before creating a database when the local password is absent or malformed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-config-missing-'));
 try{
  const db=join(dir,'new','db');
  for(const args of [[],['-pwd=short']]){
   const child=Bun.spawn([process.execPath,'--no-env-file','--tsconfig-override',join(root,'tsconfig.json'),join(root,'src/server.ts'),...args],{cwd:dir,env:{...environment(),DATABASE_PATH:db},stdout:'pipe',stderr:'pipe'});
   const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
   expect(exit).not.toBe(0);expect(stderr).toContain('Configure a valid local administrator password');
   expect(stdout+stderr).not.toContain('-pwd=short');expect(existsSync(db)).toBe(false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('source deployment reads password from a private local .env before accepting a login',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-config-dotenv-'));
 const probe=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});const port=probe.port;await probe.stop(true);
 writeFileSync(join(dir,'.env'),`ADMIN_USERNAME=fixture-owner\nADMIN_PASSWORD='fixture-$-with=a-password'\nHOST=127.0.0.1\nPORT=${port}\nDATABASE_PATH=./data/seekrss.db\n`,{mode:0o600});
 const child=Bun.spawn([process.execPath,'--tsconfig-override',join(root,'tsconfig.json'),join(root,'src/server.ts')],{cwd:dir,env:environment(),stdout:'pipe',stderr:'pipe'});
 const stdout=new Response(child.stdout).text(),stderr=new Response(child.stderr).text();
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await Bun.sleep(30);}
  expect(ready).toBe(true);
  const result=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fixture-owner',password:'fixture-$-with=a-password'})});
  expect(result.status).toBe(200);expect(result.headers.get('set-cookie')).toContain('HttpOnly');
  for(const path of ['/reset','/js/reset.js','/.env'])expect((await fetch(base+path)).status).toBe(404);
  expect((await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(404);
 }finally{child.kill();await child.exited;const logs=await stdout+await stderr;expect(logs).not.toContain('fixture-$-with=a-password');rmSync(dir,{recursive:true,force:true});}
});
