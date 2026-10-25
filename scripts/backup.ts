import { Database } from 'bun:sqlite';
import { mkdirSync, copyFileSync, existsSync, chmodSync, readFileSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = resolve(process.env.DATABASE_PATH || './data/seekrss.db');
const output = resolve(process.argv[2] || `./backups/seekrss-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
if (source === output || existsSync(output)) throw new Error('Backup target already exists or equals source');
mkdirSync(dirname(output), {recursive:true,mode:0o700});
const keys=['secret.key','setup.key'].map(file=>({from:resolve(dirname(source),file),to:resolve(dirname(output),file)})).filter(p=>existsSync(p.from));
for(const p of keys)if(p.from!==p.to&&existsSync(p.to)&&!readFileSync(p.from).equals(readFileSync(p.to)))throw new Error('Backup directory contains a different key; use a new directory');
const db = new Database(source, {readonly:true});
try { db.query('VACUUM INTO ?').run(output); chmodSync(output,0o600); }
finally { db.close(); }
for(const p of keys){if(p.from!==p.to&&!existsSync(p.to))copyFileSync(p.from,p.to,constants.COPYFILE_EXCL);chmodSync(p.to,0o600);}
const keyNote = process.env.SECRET_KEY
 ? 'SECRET_KEY environment mode: the encryption key is NOT included. Preserve the matching SECRET_KEY separately for restore.'
 : 'File-key mode: keep the matching secret.key with this database for restore.';
console.log(`Consistent SQLite backup: ${output}. ${keyNote} Never commit backups.`);
