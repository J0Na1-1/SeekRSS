import { Hono } from 'hono';
import { SeekRSSPage } from './ui';


export function createWebApp(api: {fetch: (request:Request, ...args:any[])=>any}, options:{healthy?:()=>boolean}={}) {
  const app=new Hono();
  app.use('*',async(c,next)=>{
    c.header('X-Content-Type-Options','nosniff');
    c.header('X-Frame-Options','DENY');
    c.header('Referrer-Policy','no-referrer');
    c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    c.header('Cache-Control','no-store');
    await next();
  });
  app.get('/health',c=>c.json({ok:true,service:'SeekRSS'},options.healthy?.()===false?503:200));
  app.get('/',c=>c.html('<!doctype html>'+String(SeekRSSPage({}))));

  app.all('/api/*',c=>api.fetch(c.req.raw));
  app.get('/css/:name',async c=>{
    const name=c.req.param('name');
    if(!/^[a-z-]+\.css$/.test(name))return c.notFound();
    const file=Bun.file('./public/css/'+name);
    if(!(await file.exists()))return c.notFound();
    return new Response(file,{headers:{'Content-Type':'text/css; charset=utf-8'}});
  });
  app.get('/js/seekrss.js',()=>new Response(Bun.file('./public/js/seekrss.js'),{headers:{'Content-Type':'application/javascript; charset=utf-8'}}));

  app.get('/favicon.svg',()=>new Response(Bun.file('./public/favicon.svg'),{headers:{'Content-Type':'image/svg+xml'}}));
  app.notFound(c=>c.json({ok:false,error:'Not found'},404));
  app.onError((_error,c)=>c.json({ok:false,error:'服务发生错误，请检查服务器日志（不含机密）'},500));
  return app;
}
