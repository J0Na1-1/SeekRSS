import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {Store} from '../src/seekrss/store';
test('same-directory backups preserve encryption key and remain decryptable',async()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-backup-same-'));const source=join(dir,'live.db'),output=join(dir,'backup.db');const s=new Store(source);
 try{s.saveSettings({bot_token:'123456:offline_test_secret_token_12345'});const key=readFileSync(join(dir,'secret.key')).toString('hex');
 const process=Bun.spawn([Bun.which('bun')||globalThis.process.execPath,'scripts/backup.ts',output],{env:{...globalThis.process.env,DATABASE_PATH:source},stdout:'pipe',stderr:'pipe'});expect(await process.exited).toBe(0);expect(readFileSync(join(dir,'secret.key')).toString('hex')).toBe(key);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
