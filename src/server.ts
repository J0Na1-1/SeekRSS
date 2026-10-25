#!/usr/bin/env bun
import { Store } from './seekrss/store';
import { AppService } from './seekrss/service';
import { createApi } from './seekrss/api';
import { createWebApp } from './seekrss/app';
import { Engine } from './seekrss/engine';
import { BotController } from './seekrss/bot';
import { readAdminConfig, syncAdmin } from './seekrss/admin-config';

const port=Number(process.env.PORT||3010);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
let adminConfig;
try{adminConfig=readAdminConfig(Bun.argv.slice(2),process.env);}catch{console.error('Configure a valid local administrator password using -pwd= or ADMIN_PASSWORD (12–128 characters); optional ADMIN_USERNAME must be valid.');process.exit(1);}
const store=new Store(process.env.DATABASE_PATH||'./data/seekrss.db');
try{await syncAdmin(store,adminConfig);}catch{store.close();console.error('Administrator configuration could not be applied; service was not started.');process.exit(1);}
const service=new AppService(store);
const engine=new Engine(store);
const bot=new BotController(service,{engine});
let stopping=false;
const api=createApi(service,{testFeed:id=>engine.testFeed(id),testTelegram:()=>engine.testTelegram(),preview:()=>engine.preview(),status:()=>({engine:engine.status(),bot:bot.status()})});
const app=createWebApp(api,{healthy:()=>!stopping});
const server=Bun.serve({hostname:process.env.HOST||'127.0.0.1',port,fetch:app.fetch,idleTimeout:30});
engine.start();
void bot.start().catch(()=>console.error('Telegram controller startup failed; inspect redacted runtime status.'));
console.log(`SeekRSS listening on ${server.hostname}:${server.port}; administrator credentials are managed by local configuration.`);
async function shutdown(){
 if(stopping)return;stopping=true;
 await server.stop(true);
 await bot.stop();
 await engine.stop();
 store.close();
 process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());
