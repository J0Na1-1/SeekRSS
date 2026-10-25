import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
test('production entrypoint wires only SeekRSS service, API, engine and bot; no old routes',()=>{
 const entry=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
 expect(entry).toContain("'./seekrss/admin-config'");expect(entry.indexOf('await syncAdmin(')).toBeGreaterThan(0);expect(entry.indexOf('await syncAdmin(')).toBeLessThan(entry.indexOf('Bun.serve('));expect(entry.indexOf('readAdminConfig(')).toBeLessThan(entry.indexOf('new Store('));
 expect(entry).toContain("'./seekrss/api'");expect(entry).toContain("'./seekrss/engine'");expect(entry).toContain('engine.start()');expect(entry).toContain('bot.start()');expect(entry).toContain('await bot.stop()');expect(entry).not.toContain("'./index'");
});
