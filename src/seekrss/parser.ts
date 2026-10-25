import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { ParsedEntry } from './types';

export function safeLink(value: string, base?: string): string {
  if (!value.trim()) return '';
  try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

export function plainText(value: unknown): string {
  const text = typeof value === 'object' && value !== null ? String((value as any)['#text'] ?? '') : String(value ?? '');
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml: string, sourceUrl: string): ParsedEntry[] {
  // Forbid declarations before invoking the XML parser: no external/custom entities.
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Unsafe or oversized XML');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid RSS/Atom XML');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: true }).parse(xml);
  const atom = Object.hasOwn(parsed, 'feed');
  const rss = parsed.rss !== null && typeof parsed.rss === 'object' && Object.hasOwn(parsed.rss, 'channel');
  if (!atom && !rss) throw new Error('Document is not RSS/Atom');
  const items = atom ? parsed.feed.entry ?? [] : parsed.rss?.channel?.item ?? [];
  const array = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];
  return array(items).map((item: any) => {
    const title = plainText(item.title);
    const atomLink = array(item.link).find((l: any) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'];
    const link = safeLink(String(atom ? atomLink ?? '' : item.link ?? ''), sourceUrl);
    const summary = plainText(item.description ?? item.summary ?? item.encoded ?? item.content);
    const date = new Date(item.pubDate ?? item.published ?? item.updated ?? '');
    const identity = [item.id, item.guid].map(value => value && typeof value === 'object' ? value['#text'] : value).find(value => typeof value === 'string' && value.trim().length > 0);
    return { item_key: identity || link || createHash('sha256').update(JSON.stringify([title, summary])).digest('hex'), title, link, summary, author: plainText(item.author?.name ?? item.author ?? item.creator), category: array(item.category).map((c: any) => plainText(c['@_term'] ?? c)).join(', '), published_at: Number.isNaN(date.getTime()) ? null : date.toISOString() };
  });
}
