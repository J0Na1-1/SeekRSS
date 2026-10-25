import { expect, test } from 'bun:test';

test('HTTP shell applies security headers and exposes health without source data',async()=>{
  let factory:any;
  try { factory=(await import('../src/seekrss/app')).createWebApp; }catch { factory=null; }
  expect(typeof factory).toBe('function');
  if(!factory)return;
  const fakeApi = { fetch: async()=>new Response('{}') };
  const app=factory(fakeApi,{healthy:()=>true});
  const health=await app.request('/health');
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ok:true,service:'SeekRSS'});
  expect(health.headers.get('x-content-type-options')).toBe('nosniff');
  expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
  const html=await app.request('/');
  expect(await html.text()).toContain('SeekRSS');
  expect((await app.request('/.env')).status).toBe(404);
  expect((await app.request('/js/home.js')).status).toBe(404);
});
