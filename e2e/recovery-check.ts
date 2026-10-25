import {chromium,expect} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/seekrss/store';
import {AdminRecovery} from '../src/seekrss/recovery';
import {createApi} from '../src/seekrss/api';
import {AppService} from '../src/seekrss/service';
import {createWebApp} from '../src/seekrss/app';
const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'seek-reset-browser-')),store=new Store(join(dir,'db'));
const password=randomBytes(24).toString('hex');
store.db.query('INSERT INTO admin(id,username,password_hash) VALUES(1,?,?)').run('acceptance',await Bun.password.hash(randomBytes(24).toString('hex')));
const app=createWebApp(createApi(new AppService(store))),server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});
const base='http://127.0.0.1:'+server.port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
try{
 for(const mobile of [false,true]){
  const issued=new AdminRecovery(store.db).issue(),context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800}}),page=await context.newPage();
  const errors:string[]=[],urls:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>urls.push(r.url()));
  await page.goto(base+'/reset#token='+issued.token);
  await expect(page.locator('#resetForm')).toBeVisible();
  expect(await page.evaluate(()=>location.hash)).toBe('');
  expect(urls.some(url=>url.includes(issued.token))).toBe(false);
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirm_password]').fill(password+'x');await page.locator('[type=submit]').click();
  await expect(page.locator('#resetStatus')).toContainText('不一致');
  await page.locator('[name=confirm_password]').fill(password);await page.locator('[type=submit]').click();
  await expect(page.locator('#resetStatus')).toContainText('密码已更新');
  expect(store.db.query('SELECT count(*) AS n FROM admin_reset_tokens').get()).toEqual({n:0});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#resetLogin').click();await expect(page.locator('#authTitle')).toHaveText('管理员登录');
  await page.locator('#authForm [name=username]').fill('acceptance');await page.locator('#authForm [name=password]').fill(password);await page.locator('#authForm [type=submit]').click();
  await expect(page.locator('#appPanel')).toBeVisible();
  await page.goto(base+'/reset#token='+issued.token);await expect(page.locator('#resetStatus')).toContainText('已使用');
  expect(errors).toEqual([]);await context.close();
 }
 console.log(JSON.stringify({reset_browser:'passed',desktop:true,mobile:true,fragment_removed:true,confirmation:true,new_password_login:true,replay_rejected:true,no_page_errors:true,fixture_only:true}));
}finally{await browser.close();await server.stop(true);store.close();rmSync(dir,{recursive:true,force:true});}
