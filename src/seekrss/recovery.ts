import type {Database} from 'bun:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {AppError} from './store';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const invalid=()=>new AppError('重设链接无效、已过期或已使用，请联系服务器管理员重新生成',403);

/** Tokens are operator-issued, never returned by a public API or stored in plaintext. */
export class AdminRecovery {
 constructor(private db:Database){
  db.exec('CREATE TABLE IF NOT EXISTS admin_reset_tokens (id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL,admin_fingerprint TEXT NOT NULL,expires_at INTEGER NOT NULL)');
 }
 private admin(){return this.db.query('SELECT username,password_hash FROM admin WHERE id=1').get() as {username:string;password_hash:string}|null;}
 private fingerprint(admin:{username:string;password_hash:string}){return sha(JSON.stringify(admin));}
 private record(token:unknown){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid();
  const row=this.db.query('SELECT * FROM admin_reset_tokens WHERE id=1 AND token_hash=? AND expires_at>?').get(sha(token),Date.now()) as {admin_fingerprint:string;expires_at:number}|null;
  const admin=this.admin();
  if(!row||!admin||row.admin_fingerprint!==this.fingerprint(admin))throw invalid();
  return {...row,username:admin.username};
 }
 issue(lifetimeMs=30*60_000){
  if(!Number.isSafeInteger(lifetimeMs)||lifetimeMs<1||lifetimeMs>60*60_000)throw new AppError('重设链接有效期必须在一小时以内');
  const token=randomBytes(32).toString('base64url'),expires_at=Date.now()+lifetimeMs;
  this.db.transaction(()=>{
   const admin=this.admin();if(!admin)throw new AppError('管理员尚未初始化',409);
   this.db.query('INSERT OR REPLACE INTO admin_reset_tokens(id,token_hash,admin_fingerprint,expires_at) VALUES(1,?,?,?)').run(sha(token),this.fingerprint(admin),expires_at);
  }).immediate();
  return {token,expires_at};
 }
 check(token:unknown){const record=this.record(token);return {username:record.username,expires_at:record.expires_at};}
 async reset(token:unknown,password:unknown,confirmation:unknown){
  this.record(token);
  if(typeof password!=='string'||password.length<12||password.length>128)throw new AppError('密码长度必须为 12–128 位');
  if(password!==confirmation)throw new AppError('两次输入的密码不一致');
  const passwordHash=await Bun.password.hash(password,{algorithm:'argon2id',memoryCost:19456,timeCost:2});
  this.db.transaction(()=>{
   this.record(token); // Revalidate after the async hash to prevent concurrent consumption or expiry races.
   this.db.query('UPDATE admin SET password_hash=? WHERE id=1').run(passwordHash);
   this.db.query('DELETE FROM sessions').run();
   this.db.query('DELETE FROM admin_reset_tokens').run();
  }).immediate();
 }
}
