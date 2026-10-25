import type {Store} from './store';

export interface AdminConfig {password:string;username?:string}

/** Synchronize trusted local credentials before binding any listener or starting collectors. */
export async function syncAdmin(store:Store,config:AdminConfig):Promise<boolean> {
 readAdminConfig([],{ADMIN_PASSWORD:config.password,ADMIN_USERNAME:config.username});
 const current=store.db.query('SELECT username,password_hash FROM admin WHERE id=1').get() as {username:string;password_hash:string}|null;
 const username=config.username??current?.username??'admin';
 if(current&&current.username===username&&await Bun.password.verify(config.password,current.password_hash)){
  store.db.exec('DROP TABLE IF EXISTS admin_reset_tokens');
  return false;
 }
 const passwordHash=await Bun.password.hash(config.password,{algorithm:'argon2id',memoryCost:19456,timeCost:2});
 store.db.transaction(()=>{
  store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash').run(username,passwordHash);
  store.db.query('DELETE FROM sessions').run();
  store.db.exec('DROP TABLE IF EXISTS admin_reset_tokens');
 }).immediate();
 return true;
}

/** Trusted local configuration only. Never interpolate these values into errors or logs. */
export function readAdminConfig(args:readonly string[],env:Record<string,string|undefined>):AdminConfig {
 if(args.length>1||(args.length===1&&!args[0]!.startsWith('-pwd=')))throw new Error('Only one -pwd=<password> argument is supported.');
 const password=args.length?args[0]!.slice(5):env.ADMIN_PASSWORD;
 if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Configure a 12–128 character password with -pwd= or ADMIN_PASSWORD.');
 const username=env.ADMIN_USERNAME;
 if(username!==undefined&&!/^[\p{L}\p{N}_.@-]{1,64}$/u.test(username))throw new Error('ADMIN_USERNAME is invalid.');
 return {password,...(username===undefined?{}:{username})};
}
