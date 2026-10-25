import { describe, expect, test } from 'bun:test';

// The new management shell must reuse upstream styles and expose real controls.
describe('SeekRSS management shell', () => {
  test('renders protected bootstrap and dual-surface management controls', async () => {
    let component: any;
    try { component = (await import('../src/seekrss/ui')).SeekRSSPage; } catch { component = null; }
    expect(typeof component).toBe('function');
    if (!component) return;
    const html = String(component({}));
    expect(html).toContain('/css/home.css');
    expect(html).toContain('SeekRSS');
    expect(html).toContain('setup_key');
    expect(html).toContain('sourceForm');
    expect(html).toContain('blockcombo');
    expect(html).toContain('telegramForm');
    expect(html).toContain('/js/seekrss.js');
  });
});
