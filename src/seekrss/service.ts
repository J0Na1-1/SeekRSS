import type { ParsedEntry, Rule } from './types';
import { z } from 'zod';
import { Store, AppError } from './store';

const revision=z.number().int().positive().optional();
const feedSchema=z.object({name:z.string().trim().min(1).max(100),url:z.string().max(2048).url().refine(value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch{return false;}},'仅支持不含登录凭据的 HTTP(S) 地址'),enabled:z.boolean().default(true),interval_seconds:z.number().int().min(1).max(86400).default(10),backfill:z.boolean().default(false),revision});
const ruleSchema=z.object({name:z.string().trim().max(100).optional(),kind:z.enum(['keyword','combo','block','blockcombo']),terms:z.array(z.string().trim().min(1).max(100)).min(1).max(20),scope:z.enum(['title','summary','all']).default('all'),feed_id:z.number().int().positive().nullable().default(null),enabled:z.boolean().default(true),revision}).refine(r=>['combo','blockcombo'].includes(r.kind)?r.terms.length>=2:r.terms.length===1,'普通规则需一个词；组合规则至少两个词');
const targetSchema=z.object({name:z.string().trim().min(1).max(100),chat_id:z.string().regex(/^-?[1-9]\d{0,15}$/),topic_id:z.number().int().positive().nullable().default(null),enabled:z.boolean().default(true),revision});
const settingsSchema=z.object({admin_telegram_id:z.string().regex(/^(?:[1-9]\d{0,15})?$/).optional(),bot_token:z.string().max(256).refine(v=>!v||/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(v),'无效 Bot Token').optional(),clear_token:z.boolean().optional(),paused:z.boolean().optional(),host_min_interval_seconds:z.number().int().min(1).max(86400).optional(),template:z.enum(['compact','summary']).optional(),summary_length:z.number().int().min(0).max(1000).optional(),show_author:z.boolean().optional(),show_time:z.boolean().optional(),link_preview:z.boolean().optional(),revision});
function valid<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw new AppError('输入无效：'+result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return result.data;}
const idValue=(id:number)=>valid(z.number().int().positive(),id);

/** Both Web and Telegram mutate only through this validated service. */
export class AppService {
  constructor(public readonly store:Store){}
  private write<T>(fn:()=>T):T{try{return fn();}catch(e:any){if(e instanceof AppError)throw e;if(String(e.code??'').includes('CONSTRAINT'))throw new AppError('此配置已存在或关联对象无效',409);throw new AppError('保存失败，请检查服务器状态',500);}}
  listFeeds(){return this.store.listFeeds();}
  getFeed(id:number){const f=this.store.getFeed(idValue(id));if(!f)throw new AppError('订阅源不存在',404);return f;}
  saveFeed(input:unknown,id?:number){const current=id===undefined?{}:this.getFeed(id);const value=valid(feedSchema,{...current,...input as object});return this.write(()=>this.store.saveFeed(value,id));}
  deleteFeed(id:number){return this.store.deleteFeed(idValue(id));}
  listRules(){return this.store.listRules();}
  saveRule(input:unknown,id?:number){const current=id===undefined?{}:this.store.listRules().find(r=>r.id===idValue(id));if(id!==undefined&&!current)throw new AppError('规则不存在',404);const value=valid(ruleSchema,{...current,...input as object});if(value.feed_id!==null)this.getFeed(value.feed_id);return this.write(()=>this.store.saveRule(value,id));}
  deleteRule(id:number){return this.store.deleteRule(idValue(id));}
  setRuleEnabled(id:number,enabled:boolean){valid(z.boolean(),enabled);return this.store.setRuleEnabled(idValue(id),enabled);}
  listTargets(){return this.store.listTargets();}
  saveTarget(input:unknown,id?:number){const current=id===undefined?{}:this.store.listTargets().find(t=>t.id===idValue(id));if(id!==undefined&&!current)throw new AppError('目标不存在',404);const value=valid(targetSchema,{...current,...input as object});return this.write(()=>this.store.saveTarget(value,id));}
  deleteTarget(id:number){return this.store.deleteTarget(idValue(id));}
  getSettings(){return this.store.getSettings();}
  saveSettings(input:unknown){return this.write(()=>this.store.saveSettings(valid(settingsSchema,input)));}
  listEntries(options?:Parameters<Store['listEntries']>[0]){return this.store.listEntries(options);}
  listDeliveries(limit?:number){return this.store.listDeliveries(limit);}
  getStatus(){return this.store.getStatus();}
  testRule(input:{text:string;feed_id?:number}){const value=valid(z.object({text:z.string().min(1).max(10000),feed_id:z.number().int().positive().optional()}),input);const e:ParsedEntry={item_key:'preview',title:value.text,summary:value.text,author:'',category:'',link:'',published_at:null};const r=evaluateEntry(e,this.listRules(),value.feed_id??0);return {...r,would_push:r.matched.length>0&&r.blocked.length===0};}
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
export function evaluateEntry(entry: ParsedEntry, rules: Rule[], feedId: number): { matched: Rule[]; blocked: Rule[] } {
  const matched: Rule[] = [], blocked: Rule[] = [];
  for (const rule of rules) {
    if (!rule.enabled || (rule.feed_id !== null && rule.feed_id !== feedId)) continue;
    const text = normalize(rule.scope === 'all' ? [entry.title, entry.summary, entry.author, entry.category].join('\n') : entry[rule.scope]);
    if (rule.terms.length && rule.terms.every(term => text.includes(normalize(term)))) {
      (rule.kind === 'block' || rule.kind === 'blockcombo' ? blocked : matched).push(rule);
    }
  }
  return { matched, blocked };
}
