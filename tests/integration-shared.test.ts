import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';import {AppService} from '../src/seekrss/service';import {createApi} from '../src/seekrss/api';import {BotController} from '../src/seekrss/bot';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {syncAdmin} from '../src/seekrss/admin-config';
test('Web-created rules are visible to Telegram and Telegram-created rules are visible through Web API',async()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-shared-'));const store=new Store(join(dir,'db'));
 try{const service=new AppService(store);service.saveSettings({admin_telegram_id:'42'});const api=createApi(service);const replies:string[]=[];const bot=new BotController(service,{transport:async(_token,method,payload:any)=>{if(method==='sendMessage')replies.push(payload.text);return {ok:true,result:{message_id:1}};}});
 const command=(text:string)=>bot.handleUpdate({update_id:1,message:{from:{id:42},chat:{id:42,type:'private'},text}});
 await syncAdmin(store,{username:'test',password:'offline-test-password'});
 const setup=await api.fetch(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'offline-test-password'})}));const setupData=await setup.json() as any;expect(setup.status).toBe(200);const headers={'Content-Type':'application/json',Cookie:setup.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':setupData.data.csrf};
 const created=await api.fetch(new Request('http://localhost/api/rules',{method:'POST',headers,body:JSON.stringify({kind:'keyword',terms:['web-created']})}));expect(created.status).toBe(200);await command('/list');expect(replies.at(-1)).toContain('web-created');
 await command('/add bot-created');expect(service.listRules().some(r=>r.terms.includes('bot-created'))).toBe(true);
 const response=await api.fetch(new Request('http://localhost/api/rules',{headers}));const data=await response.json() as any;expect(data.data.some((r:any)=>r.terms.includes('bot-created'))).toBe(true);
 const status=store.db.query('SELECT value FROM meta WHERE key=?').get('config_version') as any;expect(status.value).toBeGreaterThan(1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
