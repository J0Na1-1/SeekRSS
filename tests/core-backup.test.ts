import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Database} from 'bun:sqlite';import {mkdtempSync,rmSync,existsSync,statSync} from 'node:fs';import {join} from 'node:path';import {Store} from '../src/seekrss/store';
test('backup produces a consistent, private database with matching encryption key and refuses overwrite',async()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-backup-'));const source=join(dir,'live','db'),output=join(dir,'backup','db');const store=new Store(source);
 try{store.saveSettings({bot_token:'123456:offline_test_secret_token_12345'});store.saveFeed({name:'persisted',url:'https://example.com/rss'});
 const run=()=>Bun.spawn([process.execPath,'scripts/backup.ts',output],{cwd:process.cwd(),env:{...process.env,DATABASE_PATH:source},stdout:'pipe',stderr:'pipe'});
 const job=run();expect(await job.exited).toBe(0);expect(existsSync(join(dir,'backup','secret.key'))).toBe(true);expect(statSync(output).mode&0o777).toBe(0o600);
 const copy=new Store(output);try{expect(copy.listFeeds()[0]?.name).toBe('persisted');expect(copy.getSecretToken()).toBe(store.getSecretToken());}finally{copy.close();}
 expect(await run().exited).toBe(1);expect(store.listFeeds()).toHaveLength(1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
