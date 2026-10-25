import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';

test('unchanged credentials still remove legacy reset tokens and explicit username changes revoke sessions',async()=>{
 const {syncAdmin}=await import('../src/seekrss/admin-config');
 const dir=mkdtempSync(join(tmpdir(),'seek-config-rename-')),store=new Store(join(dir,'db'));
 try{
  await syncAdmin(store,{password:'fixture-valid-password'});
  store.db.exec('CREATE TABLE admin_reset_tokens(id INTEGER PRIMARY KEY,token_hash TEXT)');
  store.db.query('INSERT INTO sessions VALUES(?,?,?)').run('fixture-session','fixture-csrf',Date.now()+60_000);
  expect(await syncAdmin(store,{password:'fixture-valid-password'})).toBe(false);
  expect(store.db.query("SELECT name FROM sqlite_master WHERE name='admin_reset_tokens'").get()).toBeNull();
  expect(store.db.query('SELECT count(*) n FROM sessions').get()).toEqual({n:1});
  expect(await syncAdmin(store,{password:'fixture-valid-password',username:'new-owner'})).toBe(true);
  expect(store.db.query('SELECT username FROM admin').get()).toEqual({username:'new-owner'});
  expect(store.db.query('SELECT count(*) n FROM sessions').get()).toEqual({n:0});
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('startup configuration creates the sole administrator and preserves unchanged sessions and application data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-config-admin-')),store=new Store(join(dir,'db'));
 try{
  let sync:any;try{sync=(await import('../src/seekrss/admin-config')).syncAdmin;}catch{}
  expect(typeof sync).toBe('function');
  expect(await sync(store,{password:'fixture-initial-password'})).toBe(true);
  const admin=store.db.query('SELECT * FROM admin').get() as any;
  expect(admin.username).toBe('admin');expect(admin.password_hash).not.toBe('fixture-initial-password');
  expect(await Bun.password.verify('fixture-initial-password',admin.password_hash)).toBe(true);
  store.db.query('INSERT INTO sessions VALUES(?,?,?)').run('session-fixture','csrf-fixture',Date.now()+60_000);
  store.saveRule({kind:'keyword',terms:['keep-me']});
  expect(await sync(store,{password:'fixture-initial-password'})).toBe(false);
  expect(store.db.query('SELECT count(*) n FROM sessions').get()).toEqual({n:1});
  expect(store.db.query('SELECT * FROM admin').get()).toEqual(admin);
  expect(store.listRules()[0]!.terms).toEqual(['keep-me']);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('configured password replaces legacy credentials without renaming the administrator or changing subscriptions',async()=>{
 const {syncAdmin}=await import('../src/seekrss/admin-config');
 const dir=mkdtempSync(join(tmpdir(),'seek-config-legacy-')),store=new Store(join(dir,'db'));
 try{
  store.db.query('INSERT INTO admin VALUES(1,?,?)').run('existing-owner',await Bun.password.hash('fixture-old-password'));
  store.db.query('INSERT INTO sessions VALUES(?,?,?)').run('old-session','old-csrf',Date.now()+60_000);
  store.db.exec('CREATE TABLE admin_reset_tokens(id INTEGER PRIMARY KEY,token_hash TEXT); INSERT INTO admin_reset_tokens VALUES(1,\'fixture-legacy-hash\')');
  store.saveRule({kind:'keyword',terms:['keep-me']});
  expect(await syncAdmin(store,{password:'fixture-new-password'})).toBe(true);
  const admin=store.db.query('SELECT * FROM admin').get() as any;
  expect(admin.username).toBe('existing-owner');
  expect(await Bun.password.verify('fixture-new-password',admin.password_hash)).toBe(true);
  expect(await Bun.password.verify('fixture-old-password',admin.password_hash)).toBe(false);
  expect(store.db.query('SELECT count(*) n FROM sessions').get()).toEqual({n:0});
  expect(store.db.query("SELECT name FROM sqlite_master WHERE name='admin_reset_tokens'").get()).toBeNull();
  expect(store.listRules()[0]!.terms).toEqual(['keep-me']);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
