import {expect,test} from 'bun:test';

test('administrator password uses the exact -pwd= value before the local environment value',async()=>{
 let read:any;try{read=(await import('../src/seekrss/admin-config')).readAdminConfig;}catch{}
 expect(typeof read).toBe('function');
 const config=read(['-pwd=fixture-$-a=b- password'],{ADMIN_PASSWORD:'fixture-environment-password',ADMIN_USERNAME:'owner'});
 expect(config).toEqual({password:'fixture-$-a=b- password',username:'owner'});
 expect(read([],{ADMIN_PASSWORD:'fixture-environment-password'})).toEqual({password:'fixture-environment-password'});
});

test('missing, ambiguous or invalid startup credentials fail closed without revealing input',async()=>{
 const {readAdminConfig}=await import('../src/seekrss/admin-config');
 for(const [args,env] of [
  [[],{}],[['-pwd='],{}],[['-pwd=short'],{}],[['-pwd='+ 'x'.repeat(129)],{}],
  [['-pwd=fixture-first-password','-pwd=fixture-second-password'],{}],
  [['--pwd=fixture-misspelled-password'],{}],[['-pwd','fixture-space-password'],{}],
  [[],{ADMIN_PASSWORD:'fixture-valid-password',ADMIN_USERNAME:'bad user'}],
  [[],{ADMIN_PASSWORD:'fixture-valid-password',ADMIN_USERNAME:''}]
 ] as [string[],Record<string,string>][]) {
  let error:unknown;try{readAdminConfig(args,env);}catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);
  for(const secret of [...args,...Object.values(env)].filter(v=>v.length>8))expect(String(error)).not.toContain(secret);
 }
});
