import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';
import {syncAdmin} from '../src/seekrss/admin-config';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'seek-admin-safety-')),store=new Store(join(dir,'db'));
 return {store,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('credential synchronization rolls back if revoking a session fails',async()=>{
 const {store,close}=fixture();
 try{
  await syncAdmin(store,{password:'fixture-rollback-old-password'});
  store.db.query('INSERT INTO sessions VALUES(?,?,?)').run('fixture-session','fixture-csrf',Date.now()+60_000);
  store.db.exec("CREATE TABLE admin_reset_tokens(id INTEGER PRIMARY KEY,token_hash TEXT); INSERT INTO admin_reset_tokens VALUES(1,'fixture-hash'); CREATE TRIGGER fixture_reject_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'fixture session deletion failure'); END;");
  const admin=store.db.query('SELECT * FROM admin').all(),sessions=store.db.query('SELECT * FROM sessions').all();
  await expect(syncAdmin(store,{password:'fixture-rollback-new-password',username:'new-owner'})).rejects.toThrow('fixture session deletion failure');
  expect(store.db.query('SELECT * FROM admin').all()).toEqual(admin);
  expect(store.db.query('SELECT * FROM sessions').all()).toEqual(sessions);
  expect(store.db.query('SELECT * FROM admin_reset_tokens').all()).toEqual([{id:1,token_hash:'fixture-hash'}]);
 }finally{close();}
});

test('credential rotation preserves every populated application table and its encrypted Bot Token',async()=>{
 const {store,close}=fixture();
 try{
  await syncAdmin(store,{password:'fixture-preserve-old-password',username:'existing-owner'});
  store.saveSettings({admin_telegram_id:'42',bot_token:'synthetic-offline-token'});
  const feed=store.saveFeed({name:'Fixture',url:'https://example.com/feed',backfill:true});
  store.saveRule({kind:'keyword',terms:['fixture']});
  store.saveTarget({name:'Fixture destination',chat_id:'42'});
  expect(store.ingestEntries(feed.id,[{item_key:'fixture-entry',title:'fixture article',summary:'fixture',author:'author',category:'category',link:'https://example.com/article',published_at:null}])).toEqual({inserted:1,queued:1});
  store.db.query('INSERT INTO host_budgets VALUES(?,?,?)').run('example.com',123,456);
  store.db.query('INSERT INTO sessions VALUES(?,?,?)').run('fixture-session','fixture-csrf',Date.now()+60_000);
  const tables=(store.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('admin','sessions','admin_reset_tokens') ORDER BY name").all() as {name:string}[]).map(t=>t.name);
  const snapshot=()=>Object.fromEntries(tables.map(name=>[name,store.db.query('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]));
  const before=snapshot();for(const rows of Object.values(before))expect(rows.length).toBeGreaterThan(0);
  expect(await syncAdmin(store,{password:'fixture-preserve-new-password'})).toBe(true);
  expect(snapshot()).toEqual(before);
  expect(store.getSecretToken()).toBe('synthetic-offline-token');
  expect(store.db.query('SELECT username FROM admin').get()).toEqual({username:'existing-owner'});
  expect(store.db.query('SELECT * FROM sessions').all()).toEqual([]);
 }finally{close();}
});
