import { describe, expect, test } from 'bun:test';

// The new management shell must reuse upstream styles and expose real controls.
describe('SeekRSS management shell', () => {
  test('renders configured administrator login and dual-surface management controls', async () => {
    let component: any;
    try { component = (await import('../src/seekrss/ui')).SeekRSSPage; } catch { component = null; }
    expect(typeof component).toBe('function');
    if (!component) return;
    const html = String(component({}));
    expect(html).toContain('/css/home.css');
    expect(html).toContain('SeekRSS');
    expect(html).not.toContain('setup_key');
    expect(html).toContain('sourceForm');
    expect(html).toContain('blockcombo');
    expect(html).toContain('telegramForm');
    expect(html).toContain('/js/seekrss.js');
    expect(html).toContain('标题 → 命中规则 → 简述 → 发布时间 → 原文链接');
    expect(html).toContain('UTC+8');
    expect(html).not.toContain('显示作者');
  });
});
