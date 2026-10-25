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
test('renders escaped publisher text with safe highlights and original button', () => {
  const message = renderMessage(entry, ['GPU'], { template: 'summary', show_author: true });
  expect(message.parse_mode).toBe('HTML');
  expect(message.text).toContain('&lt;b&gt;sale&lt;/b&gt;');
  expect(message.text).toContain('<b>GPU</b>');
  expect(message.text).toContain('A &lt; B');
  expect(message.reply_markup).toEqual({ inline_keyboard: [[{ text: '阅读原文', url: entry.link }]] });
});
