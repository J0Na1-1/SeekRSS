import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/seekrss/store';

const dirs: string[] = [], stores: Store[] = [];
function open(path?: string) {
  if (!path) { const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'seekrss-core-')); dirs.push(dir); path = join(dir, 'state.sqlite'); }
  const store = new Store(path); stores.push(store); return store;
}
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test('feed configuration survives idempotent reopen and runtime writes cannot change configuration', () => {
  const store = open();
  expect(store.listFeeds()).toEqual([]);
  expect(store.db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(store.db.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  const feed = store.saveFeed({ name: 'Example', url: 'https://example.com/rss', interval_seconds: 1 });
  expect(feed).toMatchObject({ enabled: true, initialized: false, backfill: false, interval_seconds: 1, effective_interval_seconds: 10, revision: 1 });
  const version = store.getConfigVersion();
  store.updateFeedRuntime(feed.id, { last_error: 'temporary', initialized: true, url: 'https://evil.test' });
  expect(store.getFeed(feed.id)).toMatchObject({ last_error: 'temporary', initialized: true, url: feed.url, revision: 1 });
  expect(store.getConfigVersion()).toBe(version);
  const changed = store.saveFeed({ name: 'Renamed', revision: 1 }, feed.id);
  expect(changed.revision).toBe(2);
  expect(() => store.saveFeed({ name: 'stale', revision: 1 }, feed.id)).toThrow('版本冲突');
  const path = (store.db as any).filename;
  const reopened = open(path);
  expect(reopened.listFeeds()).toHaveLength(1);
  expect(reopened.getConfigVersion()).toBe(version + 1);
  reopened.deleteFeed(feed.id);
  expect(reopened.getFeed(feed.id)).toBeUndefined();
});

test('settings encrypt tokens durably and redact reads while empty updates preserve them', () => {
  const store = open();
  expect(store.getSettings()).toMatchObject({ bot_token: '', token_configured: false, host_min_interval_seconds: 10 });
  const settings = store.saveSettings({ bot_token: '123456:secret-test-token', host_min_interval_seconds: 1, admin_telegram_id: '42' });
  expect(settings).toMatchObject({ bot_token: '', token_configured: true, host_min_interval_seconds: 1, revision: 2 });
  expect(store.getSecretToken()).toBe('123456:secret-test-token');
  expect(statSync(join(store.dataDir, 'secret.key')).mode & 0o777).toBe(0o600);
  const dump = JSON.stringify(store.db.query('SELECT * FROM settings').all());
  expect(dump).not.toContain('123456:secret-test-token');
  const reopened = open((store.db as any).filename);
  expect(reopened.getSecretToken()).toBe('123456:secret-test-token');
  reopened.saveSettings({ bot_token: '' });
  expect(reopened.getSecretToken()).toBe('123456:secret-test-token');
  expect(() => store.saveSettings({ revision: 1, paused: true })).toThrow('版本冲突');
  reopened.saveSettings({ clear_token: true } as any);
  expect(store.getSecretToken()).toBe('');
  expect(store.getSettings().token_configured).toBe(false);
});
