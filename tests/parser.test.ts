import { describe, test, expect } from 'bun:test';
import { parseFeed } from '../src/seekrss/parser';

describe('RSS parsing', () => {
  test('valid empty RSS and Atom documents return no entries instead of failing', () => {
    for (const xml of ['<rss><channel/></rss>', '<feed xmlns="http://www.w3.org/2005/Atom"/>']) expect(parseFeed(xml, 'https://example.com/rss')).toEqual([]);
  });
  test('rejects DTD, custom entities, malformed XML and non-feed documents', () => {
    for (const xml of ['<!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>', '<rss><channel><item></rss>', '<html><body>not feed</body></html>']) {
      expect(() => parseFeed(xml, 'https://example.com')).toThrow();
    }
    expect(parseFeed('<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>', 'https://example.com')[0].link).toBe('');
  });
  test('parses namespaced Atom text, HTML summaries and alternate links', () => {
    const [entry] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>tag:1</id><title>Atom</title><link rel="self" href="/api/1"/><link rel="alternate" href="/post/1"/><summary type="html">&lt;p&gt;Body&lt;/p&gt;</summary><author><name>Ann</name></author><category term="tech"/><updated>2026-10-20T00:00:00Z</updated></entry></feed>`, 'https://example.com/feed');
    expect(entry).toEqual({ item_key: 'tag:1', title: 'Atom', link: 'https://example.com/post/1', summary: 'Body', author: 'Ann', category: 'tech', published_at: '2026-10-20T00:00:00.000Z' });
  });
  test('missing and empty item links use distinct stable content hashes instead of the feed URL', () => {
    const xml='<rss><channel><item><title>First</title></item><item><title>Second</title><link> </link></item></channel></rss>';
    const entries=parseFeed(xml,'https://example.com/rss');
    expect(entries.map(e=>e.link)).toEqual(['','']);
    expect(new Set(entries.map(e=>e.item_key)).size).toBe(2);
    expect(parseFeed(xml,'https://example.com/rss').map(e=>e.item_key)).toEqual(entries.map(e=>e.item_key));
  });
  test('empty RSS guid and Atom id fall through to a non-empty stable identity', () => {
    for (const xml of [
      '<rss><channel><item><guid/><title>First</title></item><item><guid isPermaLink="false"> </guid><title>Second</title></item><item><guid> </guid><link>/third</link><title>Third</title></item></channel></rss>',
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id/><title>First</title></entry><entry><id> </id><title>Second</title></entry><entry><id/><link href="/third"/><title>Third</title></entry></feed>',
    ]) {
      const entries = parseFeed(xml, 'https://example.com/rss');
      expect(entries.every(entry => entry.item_key.trim().length > 0)).toBe(true);
      expect(new Set(entries.map(entry => entry.item_key)).size).toBe(3);
      expect(entries[2]!.item_key).toBe('https://example.com/third');
      expect(parseFeed(xml, 'https://example.com/rss').map(entry => entry.item_key)).toEqual(entries.map(entry => entry.item_key));
    }
  });
  test('namespaced encoded content supplies summary and stable fallback identity', () => {
    const entries=parseFeed('<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Same</title><content:encoded><![CDATA[<p>GPU news</p>]]></content:encoded></item><item><title>Same</title><content:encoded><![CDATA[CPU news]]></content:encoded></item></channel></rss>','https://example.com/rss');
    expect(entries.map(e=>e.summary)).toEqual(['GPU news','CPU news']);
    expect(entries[0]!.item_key).not.toBe(entries[1]!.item_key);
  });
  test('parses a real RSS item and resolves safe article links', () => {
    const entries = parseFeed(`<rss version="2.0"><channel><title>Test</title><item><guid>abc</guid><title>A &amp; B</title><link>/post/1</link><description><![CDATA[<p>hello <b>world</b></p>]]></description><author>writer</author><category>news</category><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`, 'https://publisher.example/rss');
    expect(entries).toEqual([{ item_key: 'abc', title: 'A & B', link: 'https://publisher.example/post/1', summary: 'hello world', author: 'writer', category: 'news', published_at: '2026-10-20T12:00:00.000Z' }]);
  });
});
