import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from './service';
import { AppError } from './store';
import { AdminRecovery } from './recovery';

interface Hooks { testFeed?:(id:number)=>Promise<unknown>;testTelegram?:()=>Promise<unknown>;preview?:()=>unknown;status?:()=>unknown }
interface Session {hash:string;csrf:string;expires_at:number}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};

export function createApi(service:AppService,hooks:Hooks={}){
 const app=new Hono();const db=service.store.db;const keyPath=join(service.store.dataDir,'setup.key');
 const publicOrigin=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:undefined;
 const recovery=new AdminRecovery(db);
 let resetCount=0,resetWindow=Date.now(),resetKey='';
 if(!process.env.SETUP_KEY){try{writeFileSync(keyPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e:any){if(e.code!=='EEXIST')throw e;}chmodSync(keyPath,0o600);}
 const initialized=()=>!!db.query('SELECT id FROM admin WHERE id=1').get();
 const session=(c:any):Session|undefined=>{const cookie=getCookie(c,'seekrss_session');if(!cookie)return;return db.query('SELECT * FROM sessions WHERE hash=? AND expires_at>?').get(hash(cookie),Date.now()) as Session|undefined;};
 const ok=(c:any,data:unknown)=>c.json({ok:true,data});
 const setSession=(c:any)=>{db.query('DELETE FROM sessions WHERE expires_at<?').run(Date.now());const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');db.query('INSERT INTO sessions(hash,csrf,expires_at) VALUES(?,?,?)').run(hash(token),csrf,Date.now()+7*86400_000);setCookie(c,'seekrss_session',token,{httpOnly:true,sameSite:'Strict',secure:process.env.COOKIE_SECURE==='true'||new URL(c.req.url).protocol==='https:',path:'/',maxAge:7*86400});return csrf;};
 let authCount=0,authWindow=Date.now();
 app.use('*',bodyLimit({maxSize:65536,onError:c=>c.json({ok:false,error:'请求超过 64 KiB'},413)}));
 app.use('*',async(c,next)=>{
   c.header('Cache-Control','no-store');
   if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
     const origin=c.req.header('Origin');if(origin&&origin!==(publicOrigin??new URL(c.req.url).origin))throw new AppError('跨站请求已拒绝',403);
     if(!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))throw new AppError('仅支持 JSON 请求',415);
   }
   const path=new URL(c.req.url).pathname;
   if(['/api/auth/reset','/api/auth/reset/check'].includes(path)){
     if(c.req.method==='POST'){
       const data=await json(c);recovery.check(data.token);
       const key=hash(data.token);
       if(key!==resetKey||Date.now()-resetWindow>60_000){resetKey=key;resetWindow=Date.now();resetCount=0;}
       if(++resetCount>10)throw new AppError('重设尝试过多，请一分钟后重试',429);
     }
     return next();
   }
   if(['/api/auth/status','/api/auth/login','/api/auth/setup'].includes(path)){
     if(c.req.method==='POST'){if(Date.now()-authWindow>60_000){authWindow=Date.now();authCount=0;}if(++authCount>10)throw new AppError('登录尝试过多，请一分钟后重试',429);}
     return next();
   }
   const s=session(c);if(!s)throw new AppError('请先登录',401);
   if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&!equal(c.req.header('X-CSRF-Token')??'',s.csrf))throw new AppError('CSRF 校验失败，请重新登录',403);
   await next();
 });
 const json=async(c:any)=>{try{const data=await c.req.json();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw new AppError('无效 JSON');}};
 const credentials=(data:any)=>{if(typeof data.username!=='string'||!/^[\p{L}\p{N}_.@-]{1,64}$/u.test(data.username)||typeof data.password!=='string'||data.password.length<12||data.password.length>128)throw new AppError('用户名无效或密码长度不在 12–128 位');return {username:data.username,password:data.password};};
 app.get('/api/auth/status',c=>{const s=session(c);return ok(c,{initialized:initialized(),authenticated:!!s,...(s?{csrf:s.csrf}:{})});});
 app.post('/api/auth/setup',async c=>{
   if(initialized())throw new AppError('管理员已存在',409);const data=await json(c);const v=credentials(data);const setup=process.env.SETUP_KEY||readFileSync(keyPath,'utf8').trim();if(!setup||typeof data.setup_key!=='string'||!data.setup_key||!equal(data.setup_key,setup))throw new AppError('初始化密钥不正确',403);
   const password=await Bun.password.hash(v.password,{algorithm:'argon2id',memoryCost:19456,timeCost:2});
   db.transaction(()=>{if(initialized())throw new AppError('管理员已存在',409);db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run(v.username,password);}).immediate();
   return ok(c,{csrf:setSession(c)});
 });
 app.post('/api/auth/login',async c=>{
   const data=credentials(await json(c));
   const admin=db.query('SELECT username,password_hash FROM admin WHERE id=1').get() as {username:string;password_hash:string}|null;
   const valid=admin&&equal(data.username,admin.username)&&await Bun.password.verify(data.password,admin.password_hash);
   if(!valid||!admin)throw new AppError('用户名或密码错误',401);
   const csrf=db.transaction(()=>{
     const current=db.query('SELECT username,password_hash FROM admin WHERE id=1').get() as typeof admin;
     if(!current||!equal(current.username,admin.username)||!equal(current.password_hash,admin.password_hash))throw new AppError('凭据已更新，请使用新密码重新登录',401);
     return setSession(c);
   }).immediate();
   return ok(c,{csrf});
 });
 app.post('/api/auth/reset/check',async c=>ok(c,recovery.check((await json(c)).token)));
 app.post('/api/auth/reset',async c=>{const data=await json(c);await recovery.reset(data.token,data.password,data.confirm_password);return ok(c,{});});
 app.post('/api/auth/logout',c=>{const s=session(c);if(s)db.query('DELETE FROM sessions WHERE hash=?').run(s.hash);deleteCookie(c,'seekrss_session',{path:'/'});return ok(c,{});});
 app.get('/api/feeds',c=>ok(c,service.listFeeds()));
 app.post('/api/feeds',async c=>ok(c,service.saveFeed(await json(c))));
 app.put('/api/feeds/:id',async c=>ok(c,service.saveFeed(await json(c),Number(c.req.param('id')))));
 app.delete('/api/feeds/:id',c=>{service.deleteFeed(Number(c.req.param('id')));return ok(c,{});});
 app.post('/api/feeds/:id/test',async c=>{if(!hooks.testFeed)throw new AppError('采集器尚未连接',503);return ok(c,await hooks.testFeed(Number(c.req.param('id'))));});
 app.get('/api/rules',c=>ok(c,service.listRules()));
 app.post('/api/rules',async c=>ok(c,service.saveRule(await json(c))));
 app.post('/api/rules/test',async c=>ok(c,service.testRule(await json(c))));
 app.put('/api/rules/:id',async c=>ok(c,service.saveRule(await json(c),Number(c.req.param('id')))));
 app.delete('/api/rules/:id',c=>{service.deleteRule(Number(c.req.param('id')));return ok(c,{});});
 app.get('/api/targets',c=>ok(c,service.listTargets()));
 app.post('/api/targets',async c=>ok(c,service.saveTarget(await json(c))));
 app.put('/api/targets/:id',async c=>ok(c,service.saveTarget(await json(c),Number(c.req.param('id')))));
 app.delete('/api/targets/:id',c=>{service.deleteTarget(Number(c.req.param('id')));return ok(c,{});});
 app.get('/api/settings',c=>ok(c,service.getSettings()));
 app.put('/api/settings',async c=>ok(c,service.saveSettings(await json(c))));
 app.get('/api/entries',c=>{const q=c.req.query();const number=(key:string,max:number)=>{if(q[key]===undefined)return;const v=Number(q[key]);if(!Number.isSafeInteger(v)||v<0||v>max)throw new AppError('无效分页参数');return v;};return ok(c,service.listEntries({search:q.search?.slice(0,200),feed_id:number('feed_id',Number.MAX_SAFE_INTEGER),matched:q.matched==='true',limit:number('limit',200),offset:number('offset',1_000_000)}));});
 app.get('/api/deliveries',c=>ok(c,service.listDeliveries()));
 app.get('/api/status',c=>ok(c,{...service.getStatus(),runtime:hooks.status?.()??null}));
 app.post('/api/telegram/test',async c=>{if(!hooks.testTelegram)throw new AppError('Telegram 发送器尚未连接',503);return ok(c,await hooks.testTelegram());});
 app.get('/api/preview',c=>{if(!hooks.preview)throw new AppError('预览尚未连接',503);return ok(c,hooks.preview());});
 app.notFound(c=>c.json({ok:false,error:'接口不存在'},404));
 app.onError((error,c)=>{const e=error instanceof AppError?error:new AppError('请求失败，请检查服务器状态',500);return c.json({ok:false,error:e.message},e.status as any);});
 return app;
}
