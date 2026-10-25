import { expect, test } from 'bun:test';
import { evaluateEntry } from '../src/seekrss/service';
import type { ParsedEntry, Rule } from '../src/seekrss/types';

const entry: ParsedEntry = { item_key: '1', title: 'ＡＬＰＨＡ release', summary: 'Fast Linux', author: 'Ada', category: 'Tools', link: 'https://example.com/1', published_at: null };
const rule = (id: number, kind: Rule['kind'], terms: string[], extra: Partial<Rule> = {}): Rule => ({ id, kind, terms, name: `r${id}`, scope: 'all', feed_id: null, enabled: true, revision: 1, created_at: 0, updated_at: 0, ...extra });

test('matching uses NFKC case folding, grouped AND, feed/scope filtering and block precedence', () => {
  const rules = [rule(1, 'keyword', ['alpha']), rule(2, 'combo', ['LINUX', 'ada']), rule(3, 'blockcombo', ['fast', 'linux']), rule(4, 'keyword', ['missing']), rule(5, 'block', ['alpha'], { feed_id: 2 }), rule(6, 'keyword', ['ada'], { scope: 'title' }), rule(7, 'keyword', ['alpha'], { enabled: false })];
  const result = evaluateEntry(entry, rules, 1);
  expect(result.matched.map(r => r.id)).toEqual([1, 2]);
  expect(result.blocked.map(r => r.id)).toEqual([3]);
  expect(evaluateEntry(entry, [], 1)).toEqual({ matched: [], blocked: [] });
});
