import type { ParsedEntry, Settings } from './types';
import { safeLink } from './parser';

export function escapeHTML(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function highlight(text: string, terms: string[]): string {
  const escaped = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return escapeHTML(text);
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(pattern).map((part, i) => i % 2 ? `<b>${escapeHTML(part)}</b>` : escapeHTML(part)).join('');
}
export function renderMessage(entry: ParsedEntry & { feed_name?: string }, matchedRules: string[] = [], settings: Partial<Settings> = {}, maxLength = 4096): { text: string; parse_mode: 'HTML'; reply_markup?: object; link_preview_options: object } {
  const lines = [highlight(entry.title, matchedRules)];
  if (entry.feed_name) lines.push(escapeHTML(entry.feed_name));
  if (settings.template !== 'compact' && entry.summary) lines.push(highlight(entry.summary.slice(0, settings.summary_length ?? 300), matchedRules));
  if (settings.show_author && entry.author) lines.push(escapeHTML(entry.author));
  if (settings.show_time && entry.published_at) lines.push(escapeHTML(entry.published_at));
  const link = safeLink(entry.link);
  // Work on Unicode characters and regenerate markup; never slice escaped HTML.
  let text = lines.join('\n');
  if (text.length > maxLength) {
    const chars = Array.from(entry.title);
    let low = 0, high = chars.length;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (highlight(chars.slice(0, mid).join('') + '…', matchedRules).length <= maxLength) low = mid; else high = mid - 1; }
    text = highlight(chars.slice(0, low).join('') + '…', matchedRules);
  }
  return { text, parse_mode: 'HTML', ...(link ? { reply_markup: { inline_keyboard: [[{ text: '阅读原文', url: link }]] } } : {}), link_preview_options: { is_disabled: !settings.link_preview } };
}
