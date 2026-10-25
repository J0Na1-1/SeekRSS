import { test, expect } from '@playwright/test';


test('desktop and mobile Web CRUD uses the real local API and preserves publisher text safely',async({browser,request})=>{
 const password=process.env.UI_PASSWORD!;
 const setup=await request.post('/api/auth/login',{data:{username:'uitest',password}});expect(setup.ok()).toBeTruthy();
 const cookies=await request.storageState();
 const context=await browser.newContext({storageState:cookies});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#appPanel')).toBeVisible();
 await page.locator('#settingsBtn').click();await expect(page.locator('#managementDrawer')).toBeVisible();
 await page.locator('#sourceForm [name=name]').fill('UI Test Source');await page.locator('#sourceForm [name=url]').fill('https://example.com/rss');await page.locator('#sourceForm [type=submit]').click();await expect(page.locator('#sourcesList')).toContainText('UI Test Source');
 await page.locator('#sourcesList').getByText('测试',{exact:true}).click();await expect(page.locator('#toast')).toContainText('inserted');
 await page.locator('[data-tab=rules]').click();await page.locator('#ruleForm [name=terms]').fill('香港,VPS');await page.locator('#ruleForm [type=submit]').click();await expect(page.locator('#rulesList .config-item')).toHaveCount(2);
 await page.locator('#ruleForm [name=kind]').selectOption('blockcombo');await page.locator('#ruleForm [name=terms]').fill('求购,香港');await page.locator('#ruleForm [type=submit]').click();await expect(page.locator('#rulesList .config-item')).toHaveCount(3);
 await page.locator('#ruleTestForm [name=text]').fill('求购香港 VPS');await page.locator('#ruleTestForm [type=submit]').click();await expect(page.locator('#ruleTestResult')).toContainText('不推送');
 await page.locator('[data-tab=targets]').click();await page.locator('#targetForm [name=name]').fill('Test target');await page.locator('#targetForm [name=chat_id]').fill('42');await page.locator('#targetForm [type=submit]').click();await expect(page.locator('#targetsList')).toContainText('Test target');
 await page.locator('[data-tab=telegram]').click();await page.locator('#runtimeForm [name=host_min_interval_seconds]').fill('1');await page.locator('#runtimeForm [name=paused]').check();await page.locator('#runtimeForm [type=submit]').click();await expect(page.locator('#runBadge')).toContainText('暂停');
 await page.locator('#closeDrawer').click();await page.reload();await expect(page.locator('#runBadge')).toContainText('暂停');
 await expect(page.locator('#postsList')).toContainText('<img src=x onerror=alert(1)>');expect(await page.locator('#postsList img,#postsList script').count()).toBe(0);expect(await page.locator('#postsList a').count()).toBe(0);
 await page.screenshot({path:process.env.UI_DATA_DIR+'/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('#settingsBtn').click();await page.locator('[data-tab=rules]').click();await expect(page.locator('#ruleForm [name=terms]')).toBeVisible();
 await page.locator('[data-tab=sources]').click(); await page.locator('#sourceForm [type=submit]').scrollIntoViewIfNeeded(); await expect(page.locator('#sourceForm [type=submit]')).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#closeDrawer').click();await page.locator('#themeBtn').click();await page.screenshot({path:process.env.UI_DATA_DIR+'/mobile.png',fullPage:true});
 await page.locator('#settingsBtn').click();await page.locator('[data-tab=sources]').click();await page.screenshot({path:process.env.UI_DATA_DIR+'/mobile-drawer.png',fullPage:true});await page.locator('#closeDrawer').click();
 await page.locator('#settingsBtn').click();await page.locator('[data-tab=targets]').click();page.once('dialog',d=>d.accept());await page.locator('#targetsList').getByText('删除',{exact:true}).click();await expect(page.locator('#targetsList .config-item')).toHaveCount(0);
 await page.locator('#closeDrawer').click();await page.locator('#logoutBtn').click();await expect(page.locator('#authPanel')).toBeVisible();expect(errors).toEqual([]);await context.close();
});
