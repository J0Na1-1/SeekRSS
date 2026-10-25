import {expect,test} from 'bun:test';import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store} from '../src/seekrss/store';
test('backup refuses to overwrite a different encryption key belonging to older backups',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-key-'));const source=join(dir,'live','db'),dest=join(dir,'archive','db');const s=new Store(source);
 try{s.saveSettings({bot_token:'123456:offline_test_secret_token_12345'});mkdirSync(join(dir,'archive'));writeFileSync(join(dir,'archive','secret.key'),'existing unrelated key');
 const p=Bun.spawn([process.execPath,'scripts/backup.ts',dest],{env:{...process.env,DATABASE_PATH:source},stdout:'pipe',stderr:'pipe'});expect(await p.exited).toBe(1);expect(readFileSync(join(dir,'archive','secret.key'),'utf8')).toBe('existing unrelated key');expect(existsSync(dest)).toBe(false);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
