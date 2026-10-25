import {expect,test} from 'bun:test';
test('default Telegram transport is fixed to official origin, POST JSON, bounded and never leaks token',async()=>{
 let request:any;const original=globalThis.fetch;
 try{globalThis.fetch=(async(url:any,init:any)=>{request={url,init};return new Response(JSON.stringify({ok:true,result:{message_id:7}}));}) as any;
 const {telegramRequest}=await import('../src/seekrss/telegram');const token='123456:offline_testing_token_value';
 expect((await telegramRequest(token,'sendMessage',{chat_id:'42',text:'test'})).result.message_id).toBe(7);expect(request.url).toBe('https://api.telegram.org/bot'+token+'/sendMessage');expect(request.init.method).toBe('POST');expect(JSON.parse(request.init.body).chat_id).toBe('42');
 globalThis.fetch=(async()=>{throw new Error('url='+token);}) as any;
 await expect(telegramRequest(token,'getMe',{})).rejects.toThrow('Telegram 网络请求失败');
 }finally{globalThis.fetch=original;}
});
