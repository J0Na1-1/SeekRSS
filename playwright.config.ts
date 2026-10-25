import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',timeout:30000,workers:1,reporter:'list',
 outputDir:process.env.UI_DATA_DIR?process.env.UI_DATA_DIR+'/results':'test-results',
 use:{baseURL:process.env.UI_BASE_URL||'http://127.0.0.1:3011',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},
});
