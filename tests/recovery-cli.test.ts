import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/seekrss/store';

test('operator-only CLI issues an expiring HTTPS fragment link, not a new password',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-reset-cli-')),path=join(dir,'db'),store=new Store(path);
 try{
  store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run('acceptance',await Bun.password.hash('offline-cli-password'));
  const child=Bun.spawn([process.execPath,'--no-env-file','scripts/admin-reset.ts'],{env:{...process.env,DATABASE_PATH:path,PUBLIC_ORIGIN:'https://rss.example.test',RESET_TTL_MINUTES:'30'},stdout:'pipe',stderr:'pipe'});
  const stdout=await new Response(child.stdout).text();expect(await child.exited).toBe(0);
  const output=JSON.parse(stdout),url=new URL(output.url),token=new URLSearchParams(url.hash.slice(1)).get('token')!;
  expect(url.origin).toBe('https://rss.example.test');expect(url.pathname).toBe('/reset');expect(url.search).toBe('');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(output).not.toHaveProperty('password');
  const row=store.db.query('SELECT token_hash,expires_at FROM admin_reset_tokens').get() as any;
  expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  expect(row.expires_at-Date.now()).toBeGreaterThan(29*60_000);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
