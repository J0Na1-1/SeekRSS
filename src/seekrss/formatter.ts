import type { ParsedEntry, Settings } from './types';
import { safeLink } from './parser';

export function escapeHTML(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function highlight(text: string, terms: string[]): string {
  const escaped = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return escapeHTML(text);
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(pattern).map((part, i) => i % 2 ? `<b>${escapeHTML(part)}</b>` : escapeHTML(part)).join('');
}
function publicationTime(value: string | null): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Etc/GMT-8', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} UTC+8`;
}
function fitText(text: string, budget: number, render: (value: string) => string = escapeHTML): string {
  if (render(text).length <= budget) return render(text);
  if (render('…').length > budget) return '';
  const chars = Array.from(text);
  let low = 0, high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (render(chars.slice(0, mid).join('') + '…').length <= budget) low = mid;
    else high = mid - 1;
  }
  return render(chars.slice(0, low).join('') + '…');
}
export function renderMessage(entry: ParsedEntry & { feed_name?: string }, matchedRules: string[] = [], settings: Partial<Settings> = {}, maxLength = 4096): { text: string; parse_mode: 'HTML'; reply_markup?: object; link_preview_options: object } {
  const limit = Number.isFinite(maxLength) ? Math.min(4096, Math.max(0, Math.floor(maxLength))) : 4096;
  const link = safeLink(entry.link);
  const footer = [];
  if (settings.show_time !== false) footer.push('发布时间：' + publicationTime(entry.published_at));
  if (link) footer.push('原文链接：' + escapeHTML(link));
  const showSummary = settings.template !== 'compact' && settings.summary_length !== 0;
  const mark = (value: string) => highlight(value, matchedRules);
  const ruleNames = matchedRules.filter(Boolean).join('、') || '无';
  const rulePrefix = '命中规则：';
  const summaryChars = Array.from(entry.summary || '暂无简述');
  const summaryLimit = Math.max(0, settings.summary_length ?? 300);
  const summary = summaryChars.length > summaryLimit ? summaryChars.slice(0, Math.max(0, summaryLimit - 1)).join('') + '…' : summaryChars.join('');
  const fullTitle = mark(entry.title || '无标题');
  const fullBrief = showSummary ? mark(summary) : '';
  let tail = footer.length ? '\n' + footer.join('\n') : '';
  const compose = (title: string, ruleLine: string, brief: string) => title + '\n' + ruleLine + (showSummary ? '\n\n' + brief + '\n' : '') + tail;
  let text = compose(fullTitle, rulePrefix + escapeHTML(ruleNames), fullBrief);
  if (text.length > limit) {
    // Keep URLs intact; unusually long URLs remain available through the original button.
    if (footer.join('\n').length + 40 > limit && link) footer[footer.length - 1] = '原文链接：见下方按钮';
    tail = footer.length ? '\n' + footer.join('\n') : '';
    // Reserve all body separators and minimal title/brief space before fitting metadata.
    const remaining = limit - tail.length - (showSummary ? 4 : 1);
    const minimumContent = showSummary ? 2 : 1;
    const ruleLine = rulePrefix + fitText(ruleNames, Math.max(1, remaining - rulePrefix.length - minimumContent));
    const contentBudget = remaining - ruleLine.length;
    if (contentBudget < minimumContent) text = fitText(entry.title, limit, mark);
    else {
      const titleBudget = showSummary ? Math.max(Math.floor(contentBudget / 2), contentBudget - fullBrief.length) : contentBudget;
      const title = fitText(entry.title || '无标题', titleBudget, mark);
      const brief = showSummary ? fitText(summary, contentBudget - title.length, mark) : '';
      text = compose(title, ruleLine, brief);
    }
  }
  return { text, parse_mode: 'HTML', ...(link ? { reply_markup: { inline_keyboard: [[{ text: '阅读原文', url: link }]] } } : {}), link_preview_options: { is_disabled: !settings.link_preview } };
}
