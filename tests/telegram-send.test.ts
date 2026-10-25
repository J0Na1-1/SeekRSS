import {expect,test} from 'bun:test';import {Store} from '../src/seekrss/store';
import {acquireTelegramSend,completeTelegramSend,telegramSendNextAt} from '../src/seekrss/telegram-send';

test('shared Telegram gate serializes in-flight sends, isolates tokens and persists cooldown',()=>{
 const store=new Store(':memory:');const db=store.db;
 try{
  expect(acquireTelegramSend(db,'offline-a',1000)).toBe(true);
  expect(acquireTelegramSend(db,'offline-a',1001)).toBe(false);
  expect(acquireTelegramSend(db,'offline-b',1001)).toBe(true);
  completeTelegramSend(db,'offline-a',1100,{ok:false,error_code:429,parameters:{retry_after:120}});
  expect(telegramSendNextAt(db,'offline-a')).toBe(121100);
  expect(acquireTelegramSend(db,'offline-a',121099)).toBe(false);
  expect(acquireTelegramSend(db,'offline-a',121100)).toBe(true);
  completeTelegramSend(db,'offline-b',1200,{ok:true});expect(telegramSendNextAt(db,'offline-b')).toBe(2200);
  expect(JSON.stringify(db.query('SELECT key FROM meta').all())).not.toContain('offline-a');
 }finally{store.close();}
});
