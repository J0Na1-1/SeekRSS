export type RuleKind = 'keyword' | 'combo' | 'block' | 'blockcombo';
export type RuleScope = 'title' | 'summary' | 'all';
export interface Feed {
  id: number; name: string; url: string; enabled: boolean; interval_seconds: number;
  effective_interval_seconds: number; backfill: boolean; initialized: boolean;
  last_checked_at: number | null; last_success_at: number | null; next_check_at: number;
  cooldown_until: number; failure_count: number; last_error: string | null;
  etag: string | null; last_modified: string | null; last_duration_ms: number | null;
  created_at: number; updated_at: number; revision: number;
}
export interface RuleInput {
  name?: string; kind: RuleKind; terms: string[]; scope?: RuleScope;
  feed_id?: number | null; enabled?: boolean; revision?: number;
}
export interface Rule {
  id: number; name: string; kind: RuleKind; terms: string[]; scope: RuleScope;
  feed_id: number | null; enabled: boolean; created_at: number; updated_at: number; revision: number;
}
export interface TargetInput {
  name: string; chat_id: string; topic_id?: number | null; enabled?: boolean; revision?: number;
}
export interface Target {
  id: number; name: string; chat_id: string; topic_id: number | null; enabled: boolean;
  created_at: number; updated_at: number; revision: number;
}
export interface Settings {
  admin_telegram_id: string; bot_token: string; token_configured: boolean; paused: boolean;
  host_min_interval_seconds: number; template: 'compact' | 'summary'; summary_length: number;
  show_author: boolean; show_time: boolean; link_preview: boolean; revision: number;
}
export interface ParsedEntry {
  item_key: string; title: string; link: string; summary: string; author: string;
  category: string; published_at: string | null;
}
export interface Entry extends ParsedEntry {
  id: number; feed_id: number; feed_name: string; discovered_at: number;
  matched_rules: string[]; blocked_rules: string[];
}
export interface Delivery {
  id: number; entry_id: number; target_id: number;
  status: 'pending' | 'sending' | 'retry' | 'sent' | 'failed'; attempts: number;
  next_attempt_at: number; error: string | null; message_id: number | null;
  created_at: number; sent_at: number | null; entry: Entry; target: Target;
}
export type TelegramTransport = (token: string, method: string, payload: unknown, signal?: AbortSignal) => Promise<any>;
