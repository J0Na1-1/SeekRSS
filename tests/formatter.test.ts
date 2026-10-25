import { test, expect } from 'bun:test';
import { renderMessage } from '../src/seekrss/formatter';
const entry = { item_key: 'a', title: 'hello <b>sale</b> & GPU', summary: 'GPU & sale', author: 'A < B', category: '', link: 'https://example.com/post', published_at: null, feed_name: 'Feed <x>' };
test('bounds HTML length without cutting entities/tags and omits unsafe links in compact mode', () => {
  const message = renderMessage({ ...entry, title: '<&😀'.repeat(3000), summary: 'summary', link: 'javascript:alert(1)' }, ['&'], { template: 'compact' });
  expect(message.text.length).toBeLessThanOrEqual(4096);
  expect(message.text).not.toContain('summary');
  expect(message.reply_markup).toBeUndefined();
  expect(message.text.match(/<b>/g)?.length).toBe(message.text.match(/<\/b>/g)?.length);
  expect(message.text).not.toMatch(/&(?:a|am|amp|l|lt|q|quo|quot)?$/);
});
test('renders the requested five-part alert with matched rule names and UTC+8 time', () => {
  const message = renderMessage({ ...entry, title: 'Riven JP 出租', summary: '年付 $499，支持季付。', published_at: '2026-10-24T07:58:36Z' }, ['妙妙屋', 'JP'], { template: 'summary', show_time: true, show_author: true });
  expect(message.text).toBe('Riven <b>JP</b> 出租\n命中规则：妙妙屋、JP\n\n年付 $499，支持季付。\n\n发布时间：2026-10-24 15:58:36 UTC+8\n原文链接：https://example.com/post');
  expect(message.text).not.toContain('Feed');
  expect(message.text).not.toContain('A &lt; B');
});

for (const [kind, character] of [['ASCII', 'x'], ['emoji', '😀']]) {
  for (const summary_length of [1, 2, 300, undefined]) {
    const limit = summary_length ?? 300;
    test.each([limit - 1, limit, limit + 1])(`${kind} summary of %i code points respects the ${summary_length ?? 'default 300'} limit including ellipsis`, length => {
      const summary = character.repeat(length);
      const message = renderMessage({ ...entry, title: 'title', summary }, [], summary_length === undefined ? {} : { summary_length });
      const brief = message.text.split('\n\n')[1];
      const expected = length === 0 ? '…' : length > limit ? character.repeat(limit - 1) + '…' : summary;
      expect(Array.from(brief).length).toBeLessThanOrEqual(limit);
      expect(brief).toBe(expected);
      expect(message.text).toBe(`title\n命中规则：无\n\n${expected}\n\n发布时间：未知\n原文链接：https://example.com/post`);
      expect(message.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    });
  }
}

test.each([
  { template: 'summary' as const, summary_length: 0 },
  { template: 'compact' as const },
  { template: 'compact' as const, summary_length: 0 },
  { template: 'compact' as const, summary_length: 1 },
  { template: 'compact' as const, summary_length: 2 },
  { template: 'compact' as const, summary_length: 300 },
])('summary opt-out keeps the brief and its separators absent: %j', settings => {
  const message = renderMessage({ ...entry, title: 'title', summary: '😀'.repeat(301) }, [], settings);
  expect(message.text).toBe('title\n命中规则：无\n发布时间：未知\n原文链接：https://example.com/post');
});

test('oversized alerts retain ordered metadata and the full safe original link', () => {
  const message = renderMessage({ ...entry, title: '<&😀'.repeat(3000), summary: '简述'.repeat(2000), published_at: '2026-10-24T16:00:00Z' }, ['<&'], { template: 'summary', summary_length: 1000 }, 500);
  expect(message.text.length).toBeLessThanOrEqual(500);
  expect(message.text).toContain('命中规则：&lt;&amp;');
  expect(message.text).toContain('发布时间：2026-10-25 00:00:00 UTC+8');
  expect(message.text).toEndWith('原文链接：https://example.com/post');
  expect(message.text.indexOf('命中规则：')).toBeLessThan(message.text.indexOf('发布时间：'));
  expect(message.text.match(/<b>/g)?.length ?? 0).toBe(message.text.match(/<\/b>/g)?.length ?? 0);
  expect(message.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});

test('uses fixed UTC+8 rather than historical Hong Kong daylight saving time', () => {
  const message = renderMessage({ ...entry, published_at: '1979-07-01T00:00:00Z' });
  expect(message.text).toContain('发布时间：1979-07-01 08:00:00 UTC+8');
});

test('missing and invalid publication times are explicit without inventing a date', () => {
  for (const published_at of [null, 'not-a-date', '<b>fake time</b>']) {
    const message = renderMessage({ ...entry, summary: '', published_at, link: '' });
    expect(message.text).toContain('命中规则：无');
    expect(message.text).toContain('暂无简述');
    expect(message.text).toContain('发布时间：未知');
    expect(message.text).not.toContain('原文链接：');
    expect(message.reply_markup).toBeUndefined();
  }
});

test('rule names and visible URLs are escaped, and tiny budgets never break HTML', () => {
  const source = { ...entry, link: 'https://example.com/post?a=1&b=2', published_at: '2026-10-24T23:58:36-04:00' };
  const message = renderMessage(source, ['<tag>&"'], { template: 'summary' });
  expect(message.text).toContain('命中规则：&lt;tag&gt;&amp;&quot;');
  expect(message.text).toContain('原文链接：https://example.com/post?a=1&amp;b=2');
  expect(message.text).toContain('发布时间：2026-10-25 11:58:36 UTC+8');
  for (const budget of [0, 1, 2, 7, 20, 50, 80, 150, 300, 4000, 4096]) {
    const limited = renderMessage({ ...source, title: '😀<&'.repeat(5000) }, ['<'], {}, budget);
    expect(limited.text.length).toBeLessThanOrEqual(budget);
    expect(limited.text.match(/<b>/g)?.length ?? 0).toBe(limited.text.match(/<\/b>/g)?.length ?? 0);
    expect(limited.text).not.toMatch(/&(?:a|am|amp|l|lt|q|quo|quot)?$/);
  }
});

test('keeps complete escaped rule metadata when the full alert fits', () => {
  const rules = ['A' + '&'.repeat(99), 'B' + '&'.repeat(99), 'C' + '&'.repeat(99)];
  const expectedRules = '命中规则：' + rules.map(rule => rule.replace(/&/g, '&amp;')).join('、');
  const expected = `short title\n${expectedRules}\n\nbrief\n\n发布时间：未知\n原文链接：https://example.com/post`;
  expect(expectedRules.length).toBe(1495);
  expect(expected.length).toBeLessThan(4096);
  expect(renderMessage({ ...entry, title: 'short title', summary: 'brief' }, rules).text).toBe(expected);
});

test('uses unused brief space for a complete long title when the full alert fits', () => {
  const title = 'x'.repeat(2500);
  const expected = `${title}\n命中规则：无\n\nbrief\n\n发布时间：未知\n原文链接：https://example.com/post`;
  expect(expected.length).toBeLessThan(4096);
  expect(renderMessage({ ...entry, title, summary: 'brief' }).text).toBe(expected);
});

test('preserves full rule metadata before shortening an oversized title or brief', () => {
  const rules = ['A' + '&'.repeat(99), 'B' + '&'.repeat(99), 'C' + '&'.repeat(99)];
  const message = renderMessage({ ...entry, title: 'x'.repeat(5000), summary: 'y'.repeat(1000) }, rules, { summary_length: 1000 });
  expect(message.text).toContain('命中规则：' + rules.map(rule => rule.replace(/&/g, '&amp;')).join('、'));
  expect(message.text.length).toBeLessThanOrEqual(4096);
});

test.each([30, 31, 32])('reserves every separator within a %i-character summary budget', budget => {
  const message = renderMessage({ ...entry, title: 'x'.repeat(100), summary: 'brief', published_at: null, link: 'https://example.com/' }, [], {}, budget);
  expect(message.text.length).toBeLessThanOrEqual(budget);
});

test('bounded budgets preserve complete HTML across summary, compact, and time opt-outs', () => {
  const source = { ...entry, title: '😀<&"'.repeat(80), summary: 'brief 😀<&"'.repeat(80), link: 'https://example.com/?a=1&b=2' };
  const budgets = [...Array.from({ length: 97 }, (_, i) => i), 4095, 4096, 4097];
  for (const settings of [{}, { template: 'compact' as const }, { summary_length: 0 }, { show_time: false }, { template: 'compact' as const, show_time: false }]) {
    for (const budget of budgets) {
      const { text } = renderMessage(source, ['<', '&'], settings, budget);
      expect(text.length).toBeLessThanOrEqual(Math.min(budget, 4096));
      expect(text.match(/<b>/g)?.length ?? 0).toBe(text.match(/<\/b>/g)?.length ?? 0);
      expect(text.replace(/<\/?b>|&(?:amp|lt|gt|quot);/g, '')).not.toMatch(/[<>&"]/);
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    }
  }
});

test('long URLs remain intact in the original button and explicit opt-outs still work', () => {
  const longLink = 'https://example.com/' + 'x'.repeat(3000);
  const message = renderMessage({ ...entry, link: longLink }, ['GPU'], { template: 'summary', show_time: false }, 500);
  expect(message.text.length).toBeLessThanOrEqual(500);
  expect(message.text).toContain('原文链接：见下方按钮');
  expect(message.reply_markup).toEqual({ inline_keyboard: [[{ text: '阅读原文', url: longLink }]] });
  expect(message.text).not.toContain('发布时间：');
  expect(renderMessage(entry, [], { summary_length: 0 }).text).not.toContain('GPU &amp; sale');
});

test('renders escaped publisher text with safe highlights and original button', () => {
  const message = renderMessage(entry, ['GPU'], { template: 'summary', show_author: true });
  expect(message.parse_mode).toBe('HTML');
  expect(message.text).toContain('&lt;b&gt;sale&lt;/b&gt;');
  expect(message.text).toContain('<b>GPU</b>');
  expect(message.text).not.toContain('A &lt; B');
  expect(message.text).toContain('命中规则：GPU');
  expect(message.reply_markup).toEqual({ inline_keyboard: [[{ text: '阅读原文', url: entry.link }]] });
});
