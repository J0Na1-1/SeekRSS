import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,cpSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
test('production build removes a legacy recovery executable instead of retaining obsolete artifacts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'seek-clean-build-'));
 try{
  for(const file of ['package.json','tsconfig.json','tsconfig.seekrss.json','src'])cpSync(join(root,file),join(dir,file),{recursive:true});
  symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist','admin-reset.js'),'throw new Error("obsolete fixture");');
  const child=Bun.spawn([process.execPath,'run','build'],{cwd:dir,stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(exit,stdout+stderr).toBe(0);
  expect(existsSync(join(dir,'dist','server.js'))).toBe(true);
  expect(existsSync(join(dir,'dist','admin-reset.js'))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
