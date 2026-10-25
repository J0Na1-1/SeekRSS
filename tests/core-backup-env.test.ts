import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';

test('environment-key backup explicitly warns and restores only with the matching separate key',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-env-backup-'));const source=join(dir,'live','db'),dest=join(dir,'restore','db');
 const env={...process.env,SECRET_KEY:'offline-encryption-fixture-key',DATABASE_PATH:source};
 const run=async(args:string[],extra:Record<string,string>={})=>{
  const p=Bun.spawn([process.execPath,...args],{env:{...env,...extra},stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,err,code};
 };
 try{
  const seed=await run(['-e',"import {Store} from './src/seekrss/store';const s=new Store(process.env.DATABASE_PATH);s.saveSettings({bot_token:'offline-restore-token'});s.close();"]);expect(seed.code).toBe(0);
  const backup=await run(['scripts/backup.ts',dest]);expect(backup.code).toBe(0);expect(backup.out).toContain('SECRET_KEY');expect(backup.out).not.toContain(env.SECRET_KEY);expect(existsSync(join(dir,'restore','secret.key'))).toBe(false);
  const verify="import {Store} from './src/seekrss/store';const s=new Store(process.env.DATABASE_PATH);try{if(s.getSecretToken()!=='offline-restore-token')process.exit(2);}finally{s.close();}";
  expect((await run(['-e',verify],{DATABASE_PATH:dest})).code).toBe(0);
  expect((await run(['-e',verify],{DATABASE_PATH:dest,SECRET_KEY:'offline-wrong-key'})).code).not.toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
