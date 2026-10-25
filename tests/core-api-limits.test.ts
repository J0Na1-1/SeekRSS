import {expect,test} from 'bun:test';
import {tmpdir} from 'node:os';
import {Store} from '../src/seekrss/store';import {AppService} from '../src/seekrss/service';import {createApi} from '../src/seekrss/api';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';
test('API rejects oversized bodies and enforces a bounded login attempt budget',async()=>{
 const dir=mkdtempSync(join((process.env.TMPDIR||tmpdir()),'seek-limit-'));const s=new Store(join(dir,'db'));
 try{const api=createApi(new AppService(s));const req=(data:unknown)=>api.fetch(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
 expect((await req({username:'a'.repeat(70000),password:'password-of-test'})).status).toBe(413);
 for(let i=0;i<10;i++)expect((await req({username:'admin',password:'offline-test-password'})).status).toBe(401);
 expect((await req({username:'admin',password:'offline-test-password'})).status).toBe(429);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
