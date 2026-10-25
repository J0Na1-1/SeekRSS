import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Feed, Settings, Rule, RuleInput, Target, TargetInput, ParsedEntry, Entry, Delivery } from './types';
import { evaluateEntry } from './service';

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export class Store {
  public db: Database;
  readonly dataDir: string;
  constructor(path: string) {
    this.dataDir = dirname(path);
    if (path !== ':memory:') mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('config_version', 0);
      CREATE TABLE IF NOT EXISTS feeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1, interval_seconds INTEGER NOT NULL DEFAULT 10,
        effective_interval_seconds INTEGER NOT NULL DEFAULT 10, backfill INTEGER NOT NULL DEFAULT 0,
        initialized INTEGER NOT NULL DEFAULT 0, last_checked_at INTEGER, last_success_at INTEGER,
        next_check_at INTEGER NOT NULL DEFAULT 0, cooldown_until INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, etag TEXT, last_modified TEXT,
        last_duration_ms INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, encrypted_token TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,kind TEXT NOT NULL,terms TEXT NOT NULL,scope TEXT NOT NULL DEFAULT 'all',feed_id INTEGER REFERENCES feeds(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS targets (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,chat_id TEXT NOT NULL,topic_id INTEGER,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
      CREATE UNIQUE INDEX IF NOT EXISTS target_identity ON targets(chat_id,COALESCE(topic_id,0));
      CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT,feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,item_key TEXT NOT NULL,title TEXT NOT NULL,link TEXT NOT NULL,summary TEXT NOT NULL,author TEXT NOT NULL,category TEXT NOT NULL,published_at TEXT,discovered_at INTEGER NOT NULL,matched_rules TEXT NOT NULL,blocked_rules TEXT NOT NULL,UNIQUE(feed_id,item_key));
      CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT,entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,error TEXT,message_id INTEGER,created_at INTEGER NOT NULL,sent_at INTEGER,UNIQUE(entry_id,target_id));
      CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status,next_attempt_at);
      CREATE TABLE IF NOT EXISTS host_budgets (host TEXT PRIMARY KEY,next_at INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    this.db.query('INSERT OR IGNORE INTO settings(id,value) VALUES (1,?)').run(JSON.stringify({ admin_telegram_id: '', paused: false, host_min_interval_seconds: 10, template: 'compact', summary_length: 300, show_author: true, show_time: true, link_preview: false, revision: 1 }));
  }
  private encryptionKey(): Buffer {
    if (process.env.SECRET_KEY) return createHash('sha256').update(process.env.SECRET_KEY).digest();
    const path = join(this.dataDir, 'secret.key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    chmodSync(path, 0o600);
    const key = readFileSync(path);
    if (key.length !== 32) throw new AppError('密钥文件损坏', 500);
    return key;
  }
  private encrypt(token: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64')).join('.');
  }
  getSettings(): Settings {
    const row = this.db.query('SELECT * FROM settings WHERE id=1').get() as any;
    return { ...JSON.parse(row.value), bot_token: '', token_configured: !!row.encrypted_token };
  }
  getSecretToken(): string {
    const row = this.db.query('SELECT encrypted_token FROM settings WHERE id=1').get() as any;
    if (!row.encrypted_token) return '';
    try {
      const [iv, tag, encrypted] = row.encrypted_token.split('.').map((v: string) => Buffer.from(v, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
      cipher.setAuthTag(tag); return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
    } catch { throw new AppError('无法解密 Telegram 凭据，请检查密钥文件', 500); }
  }
  saveSettings(input: Partial<Settings> & { bot_token?: string; clear_token?: boolean }): Settings {
    return this.db.transaction(() => {
      const current = this.getSettings();
      if (input.revision !== undefined && input.revision !== current.revision) throw new AppError('版本冲突，请刷新后重试', 409);
      const keys = ['admin_telegram_id', 'paused', 'host_min_interval_seconds', 'template', 'summary_length', 'show_author', 'show_time', 'link_preview'] as const;
      const next: any = { ...current, revision: current.revision + 1 };
      delete next.bot_token; delete next.token_configured;
      for (const key of keys) if (input[key] !== undefined) next[key] = input[key];
      let token = (this.db.query('SELECT encrypted_token FROM settings WHERE id=1').get() as any).encrypted_token;
      if (input.clear_token) token = ''; else if (input.bot_token) token = this.encrypt(input.bot_token);
      this.db.query('UPDATE settings SET value=?,encrypted_token=? WHERE id=1').run(JSON.stringify(next), token);
      this.db.query('UPDATE feeds SET effective_interval_seconds=MAX(interval_seconds,?)').run(next.host_min_interval_seconds);
      this.bump(); return this.getSettings();
    }).immediate();
  }
  close() { this.db.close(); }
  getConfigVersion(): number { return (this.db.query("SELECT value FROM meta WHERE key='config_version'").get() as any).value; }
  private bump() { this.db.query("UPDATE meta SET value=value+1 WHERE key='config_version'").run(); }
  private feed(row: any): Feed | undefined {
    return row ? { ...row, enabled: !!row.enabled, backfill: !!row.backfill, initialized: !!row.initialized } : undefined;
  }
  listFeeds(): Feed[] { return this.db.query('SELECT * FROM feeds ORDER BY id').all().map(row => this.feed(row)!); }
  getFeed(id: number): Feed | undefined { return this.feed(this.db.query('SELECT * FROM feeds WHERE id=?').get(id)); }
  saveFeed(input: Partial<Feed> & { name?: string; url?: string }, id?: number): Feed {
    return this.db.transaction(() => {
      const current = id === undefined ? undefined : this.getFeed(id);
      if (id !== undefined && !current) throw new AppError('订阅源不存在', 404);
      if (current && input.revision !== undefined && input.revision !== current.revision) throw new AppError('版本冲突，请刷新后重试', 409);
      const now = Date.now();
      const values = { name: '', url: '', enabled: true, interval_seconds: 10, backfill: false, ...current, ...input };
      const effective = Math.max(values.interval_seconds, this.getSettings().host_min_interval_seconds);
      if (current) {
        this.db.query('UPDATE feeds SET name=?,url=?,enabled=?,interval_seconds=?,effective_interval_seconds=?,backfill=?,updated_at=?,revision=revision+1 WHERE id=?').run(values.name, values.url, +values.enabled, values.interval_seconds, effective, +values.backfill, now, id!);
        if(values.url!==current.url)this.db.query('UPDATE feeds SET initialized=0,etag=NULL,last_modified=NULL,last_checked_at=NULL,last_success_at=NULL,next_check_at=0,cooldown_until=0,failure_count=0,last_error=NULL WHERE id=?').run(id!);
      } else {
        id = Number(this.db.query('INSERT INTO feeds(name,url,enabled,interval_seconds,effective_interval_seconds,backfill,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(values.name, values.url, +values.enabled, values.interval_seconds, effective, +values.backfill, now, now).lastInsertRowid);
      }
      this.bump(); return this.getFeed(id!)!;
    }).immediate();
  }
  deleteFeed(id: number): void {
    this.db.transaction(() => { if (!this.db.query('DELETE FROM feeds WHERE id=?').run(id).changes) throw new AppError('订阅源不存在', 404); this.bump(); }).immediate();
  }
  updateFeedRuntime(id: number, patch: Partial<Feed>): void {
    const allowed = ['effective_interval_seconds', 'initialized', 'last_checked_at', 'last_success_at', 'next_check_at', 'cooldown_until', 'failure_count', 'last_error', 'etag', 'last_modified', 'last_duration_ms'] as const;
    const keys = allowed.filter(key => patch[key] !== undefined);
    if (keys.length) this.db.query(`UPDATE feeds SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...keys.map(key => typeof patch[key] === 'boolean' ? +patch[key]! : patch[key] as any), id);
  }
  listRules(): Rule[] { return (this.db.query('SELECT * FROM rules ORDER BY id').all() as any[]).map(r=>({...r,terms:JSON.parse(r.terms),enabled:!!r.enabled})); }
  saveRule(input: RuleInput,id?:number):Rule {
    return this.db.transaction(()=>{
      const current=id===undefined?undefined:this.listRules().find(r=>r.id===id);
      if(id!==undefined&&!current)throw new AppError('规则不存在',404);
      if(current&&input.revision!==undefined&&current.revision!==input.revision)throw new AppError('版本冲突，请刷新',409);
      const v={scope:'all',feed_id:null,enabled:true,...current,...input};const now=Date.now();const name=v.name?.trim()||v.terms.join(' + ');
      if(current)this.db.query('UPDATE rules SET name=?,kind=?,terms=?,scope=?,feed_id=?,enabled=?,updated_at=?,revision=revision+1 WHERE id=?').run(name,v.kind,JSON.stringify(v.terms),v.scope,v.feed_id,+v.enabled,now,id!);
      else id=Number(this.db.query('INSERT INTO rules(name,kind,terms,scope,feed_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(name,v.kind,JSON.stringify(v.terms),v.scope,v.feed_id,+v.enabled,now,now).lastInsertRowid);
      this.bump();return this.listRules().find(r=>r.id===id)!;
    }).immediate();
  }
  deleteRule(id:number){if(!this.db.query('DELETE FROM rules WHERE id=?').run(id).changes)throw new AppError('规则不存在',404);this.bump();}
  setRuleEnabled(id:number,enabled:boolean){const r=this.listRules().find(r=>r.id===id);if(!r)throw new AppError('规则不存在',404);return this.saveRule({...r,enabled},id);}
  listTargets():Target[]{return (this.db.query('SELECT * FROM targets ORDER BY id').all() as any[]).map(t=>({...t,enabled:!!t.enabled}));}
  saveTarget(input:TargetInput,id?:number):Target{return this.db.transaction(()=>{
    const current=id===undefined?undefined:this.listTargets().find(t=>t.id===id);if(id!==undefined&&!current)throw new AppError('目标不存在',404);
    if(current&&input.revision!==undefined&&current.revision!==input.revision)throw new AppError('版本冲突，请刷新',409);
    const v={topic_id:null,enabled:true,...current,...input};const now=Date.now();
    if(current)this.db.query('UPDATE targets SET name=?,chat_id=?,topic_id=?,enabled=?,updated_at=?,revision=revision+1 WHERE id=?').run(v.name,v.chat_id,v.topic_id,+v.enabled,now,id!);
    else id=Number(this.db.query('INSERT INTO targets(name,chat_id,topic_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(v.name,v.chat_id,v.topic_id,+v.enabled,now,now).lastInsertRowid);
    this.bump();return this.listTargets().find(t=>t.id===id)!;
  }).immediate();}
  deleteTarget(id:number){if(!this.db.query('DELETE FROM targets WHERE id=?').run(id).changes)throw new AppError('目标不存在',404);this.bump();}
  ingestEntries(feedId:number,entries:ParsedEntry[]):{inserted:number;queued:number}{return this.db.transaction(()=>{
    const feed=this.getFeed(feedId);if(!feed)throw new AppError('源不存在',404);const baseline=!feed.initialized&&!feed.backfill;const settings=this.getSettings();const rules=this.listRules();const targets=this.listTargets().filter(t=>t.enabled);let inserted=0,queued=0;
    for(const e of entries){const result=evaluateEntry(e,rules,feedId);const now=Date.now();const r=this.db.query('INSERT OR IGNORE INTO entries(feed_id,item_key,title,link,summary,author,category,published_at,discovered_at,matched_rules,blocked_rules) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(feedId,e.item_key,e.title,e.link,e.summary,e.author,e.category,e.published_at,now,JSON.stringify(result.matched.map(r=>r.name)),JSON.stringify(result.blocked.map(r=>r.name)));if(!r.changes)continue;inserted++;
      if(!baseline&&!settings.paused&&result.matched.length&&!result.blocked.length)for(const t of targets){queued+=this.db.query('INSERT OR IGNORE INTO deliveries(entry_id,target_id,created_at) VALUES(?,?,?)').run(r.lastInsertRowid,t.id,now).changes;}
    }this.updateFeedRuntime(feedId,{initialized:true});return {inserted,queued};
  }).immediate();}
  private entry(row:any):Entry{return {...row,matched_rules:JSON.parse(row.matched_rules),blocked_rules:JSON.parse(row.blocked_rules)};}
  listEntries(options:{search?:string;feed_id?:number;matched?:boolean;limit?:number;offset?:number}={}):{items:Entry[];total:number}{
    const where:string[]=[];const args:any[]=[];if(options.feed_id){where.push('e.feed_id=?');args.push(options.feed_id);}if(options.search){where.push('(e.title LIKE ? OR e.summary LIKE ?)');args.push('%'+options.search+'%','%'+options.search+'%');}if(options.matched)where.push("e.matched_rules!='[]' AND e.blocked_rules='[]'");const clause=where.length?' WHERE '+where.join(' AND '):'';
    const total=(this.db.query('SELECT COUNT(*) AS n FROM entries e'+clause).get(...args) as any).n;
    const rows=this.db.query('SELECT e.*,f.name AS feed_name FROM entries e JOIN feeds f ON f.id=e.feed_id'+clause+' ORDER BY e.discovered_at DESC,e.id DESC LIMIT ? OFFSET ?').all(...args,Math.min(200,Math.max(1,options.limit??20)),Math.max(0,options.offset??0)) as any[];return {items:rows.map(r=>this.entry(r)),total};
  }
  private delivery(row:any):Delivery {const e=this.db.query('SELECT e.*,f.name AS feed_name FROM entries e JOIN feeds f ON f.id=e.feed_id WHERE e.id=?').get(row.entry_id);const target=this.listTargets().find(t=>t.id===row.target_id)!;return {...row,entry:this.entry(e),target};}
  listDeliveries(limit=50):Delivery[]{return (this.db.query('SELECT * FROM deliveries ORDER BY id DESC LIMIT ?').all(Math.min(200,limit)) as any[]).map(r=>this.delivery(r));}
  recoverDeliveries(){this.db.query("UPDATE deliveries SET status='retry' WHERE status='sending'").run();}
  claimDelivery(now=Date.now()):Delivery|undefined{return this.db.transaction(()=>{const row=this.db.query("SELECT d.* FROM deliveries d JOIN targets t ON t.id=d.target_id WHERE d.status IN ('pending','retry') AND d.next_attempt_at<=? AND t.enabled=1 ORDER BY d.id LIMIT 1").get(now) as any;if(!row)return;this.db.query("UPDATE deliveries SET status='sending',attempts=attempts+1 WHERE id=?").run(row.id);return this.delivery({...row,status:'sending',attempts:row.attempts+1});}).immediate();}
  finishDelivery(id:number,patch:{status:'sent'|'retry'|'failed';error?:string;next_attempt_at?:number;message_id?:number;sent_at?:number}){this.db.query('UPDATE deliveries SET status=?,error=?,next_attempt_at=?,message_id=?,sent_at=? WHERE id=?').run(patch.status,patch.error??null,patch.next_attempt_at??0,patch.message_id??null,patch.sent_at??(patch.status==='sent'?Date.now():null),id);}
  getStatus(){return {config_version:this.getConfigVersion(),feeds:this.listFeeds().length,rules:this.listRules().length,targets:this.listTargets().length,entries:(this.db.query('SELECT COUNT(*) n FROM entries').get() as any).n,deliveries:this.db.query('SELECT status,COUNT(*) count FROM deliveries GROUP BY status').all(),paused:this.getSettings().paused};}
}
