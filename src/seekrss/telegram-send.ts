import {createHash} from 'node:crypto';
import type {Database} from 'bun:sqlite';

function key(token:string){return 'telegram_send_'+createHash('sha256').update(token).digest('hex');}
function value(db:Database,name:string):number{return Number((db.query('SELECT value FROM meta WHERE key=?').get(name) as any)?.value??0);}
export function telegramSendNextAt(db:Database,token:string):number{return Math.max(value(db,key(token)),value(db,key(token)+'_lease'));}
export function deferTelegramSend(db:Database,token:string,until:number):void{db.query('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)').run(key(token),until);}
/** A bounded durable lease also serializes the Bot replies and outbox. */
export function acquireTelegramSend(db:Database,token:string,now:number):boolean{return db.transaction(()=>{
 if(telegramSendNextAt(db,token)>now)return false;
 db.query('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(token)+'_lease',now+40_000);
 return true;
}).immediate();}
export function completeTelegramSend(db:Database,token:string,now:number,response?:any):void{
 db.transaction(()=>{
  const retry=Number(response?.parameters?.retry_after);
  const wait=response?.error_code===429?Math.max(1000,(Number.isFinite(retry)&&retry>0?retry:30)*1000):1000;
  deferTelegramSend(db,token,now+wait);
  db.query('DELETE FROM meta WHERE key=?').run(key(token)+'_lease');
 }).immediate();
}
