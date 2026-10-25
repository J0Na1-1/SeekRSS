// Standalone Web integration fixture: real API/Store/UI, no external publisher or Telegram.
import { Store } from '../src/seekrss/store';
import { AppService } from '../src/seekrss/service';
import { createApi } from '../src/seekrss/api';
import { createWebApp } from '../src/seekrss/app';
import {readAdminConfig,syncAdmin} from '../src/seekrss/admin-config';
const store=new Store(process.env.DATABASE_PATH!);
await syncAdmin(store,readAdminConfig([],{ADMIN_PASSWORD:process.env.UI_PASSWORD,ADMIN_USERNAME:'uitest'}));
const app=createWebApp(createApi(new AppService(store),{testFeed:async id=>store.ingestEntries(id,[{item_key:'ui-fixture',title:'【测试样本】香港 VPS <img src=x onerror=alert(1)>',summary:'样本摘要 <script>alert(1)</script>',author:'测试作者',category:'测试分类',link:'javascript:alert(1)',published_at:null}])}));
Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT||3011),fetch:app.fetch});
console.log('UI fixture ready');
process.on('SIGTERM',()=>{store.close();process.exit(0);});
