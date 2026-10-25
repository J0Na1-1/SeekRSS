import {expect,test} from 'bun:test';
import {createWebApp} from '../src/seekrss/app';

test('password reset page uses same-origin assets, no query secrets and a protected two-password form',async()=>{
 const app=createWebApp({fetch:async()=>new Response('{}')});
 const response=await app.request('/reset');
 expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toContain('no-store');
 expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
 const html=await response.text();
 expect(html).toContain('autocomplete="new-password"');
 expect(html).toContain('name="confirm_password"');
 expect(html).toContain('/js/reset.js');
 const script=await app.request('/js/reset.js');expect(script.status).toBe(200);
 expect(await script.text()).toContain('history.replaceState');
});
