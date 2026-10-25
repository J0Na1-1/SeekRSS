#!/usr/bin/env bun
import { Store } from './seekrss/store';
import { AppService } from './seekrss/service';
import { createApi } from './seekrss/api';
import { createWebApp } from './seekrss/app';
import { Engine } from './seekrss/engine';
import { BotController } from './seekrss/bot';

const port=Number(process.env.PORT||3010);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
const store=new Store(process.env.DATABASE_PATH||'./data/seekrss.db');
const service=new AppService(store);
const engine=new Engine(store);
const bot=new BotController(service,{engine});
let stopping=false;
const api=createApi(service,{testFeed:id=>engine.testFeed(id),testTelegram:()=>engine.testTelegram(),preview:()=>engine.preview(),status:()=>({engine:engine.status(),bot:bot.status()})});
const app=createWebApp(api,{healthy:()=>!stopping});
const server=Bun.serve({hostname:process.env.HOST||'127.0.0.1',port,fetch:app.fetch,idleTimeout:30});
engine.start();
void bot.start().catch(()=>console.error('Telegram controller startup failed; inspect redacted runtime status.'));
console.log(`SeekRSS listening on ${server.hostname}:${server.port}; configure the sole admin through Web. Bootstrap key: data directory setup.key (not printed).`);
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
