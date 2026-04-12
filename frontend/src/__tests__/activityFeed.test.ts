import { describe, it, expect } from 'vitest';
import { buildFeedItems } from '@/components/dashboard/ActivityFeed';

describe('buildFeedItems', () => {
  it('returns empty array with no inputs', () => {
    const items = buildFeedItems(null, null, null, []);
    expect(items).toEqual([]);
  });

  it('creates regime event from regime data', () => {
    const items = buildFeedItems(
      null,
      null,
      { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16.5, description: 'Uptrend' },
      [],
    );
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('regime');
    expect(items[0].title).toContain('Bull');
  });

  it('sets severity to success for bull regime', () => {
    const items = buildFeedItems(
      null,
      null,
      { regime: 'Bull Market', label: 'bull', confidence: 0.9, vix_level: 14, description: 'Strong uptrend' },
      [],
    );
    expect(items[0].severity).toBe('success');
  });

  it('sets severity to danger for bear regime', () => {
    const items = buildFeedItems(
      null,
      null,
      { regime: 'Bear Market', label: 'bear', confidence: 0.85, vix_level: 30, description: 'Downtrend' },
      [],
    );
    expect(items[0].severity).toBe('danger');
  });

  it('creates pipeline events from pipeline log', () => {
    const log = {
      timestamp: new Date().toISOString(),
      strategies_run: {
        pead: { screened: 5, analyzed: 3, trades_requested: 1, trades_approved: 1 },
      },
      orders_placed: [
        { symbol: 'AAPL', side: 'buy', qty: 10, price: 150, timestamp: new Date().toISOString() },
      ],
      orders_closed: [],
      errors: [],
      master_agent: { rejections: [] },
    };
    const items = buildFeedItems(null, log, null, []);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.type === 'pipeline')).toBe(true);
  });

  it('includes trade events for orders_placed', () => {
    const log = {
      timestamp: new Date().toISOString(),
      strategies_run: {},
      orders_placed: [
        { symbol: 'TSLA', side: 'buy', qty: 5, price: 250.75, timestamp: new Date().toISOString() },
      ],
      orders_closed: [],
      errors: [],
      master_agent: { rejections: [] },
    };
    const items = buildFeedItems(null, log, null, []);
    const tradeItem = items.find(i => i.type === 'trade');
    expect(tradeItem).toBeDefined();
    expect(tradeItem!.title).toContain('TSLA');
    expect(tradeItem!.title).toContain('250.75');
  });

  it('marks pipeline as warning when errors present', () => {
    const log = {
      timestamp: new Date().toISOString(),
      strategies_run: {},
      orders_placed: [],
      orders_closed: [],
      errors: ['Connection timeout'],
      master_agent: { rejections: [] },
    };
    const items = buildFeedItems(null, log, null, []);
    const pipelineSummary = items.find(i => i.type === 'pipeline');
    expect(pipelineSummary!.severity).toBe('warning');
  });

  it('creates alert items for each pipeline error', () => {
    const log = {
      timestamp: new Date().toISOString(),
      strategies_run: {},
      orders_placed: [],
      orders_closed: [],
      errors: ['Error A', 'Error B'],
      master_agent: { rejections: [] },
    };
    const items = buildFeedItems(null, log, null, []);
    const alerts = items.filter(i => i.type === 'alert');
    expect(alerts.length).toBe(2);
  });

  it('creates news events', () => {
    const news = [
      { title: 'Market Update', source: 'Reuters', published_at: new Date().toISOString(), url: 'https://example.com' },
    ];
    const items = buildFeedItems(null, null, null, news);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('news');
  });

  it('news item carries source as detail', () => {
    const news = [
      { title: 'Fed Holds Rates', source: 'Bloomberg', published_at: new Date().toISOString(), url: 'https://bloomberg.com' },
    ];
    const items = buildFeedItems(null, null, null, news);
    expect(items[0].detail).toBe('Bloomberg');
  });

  it('sorts items by time descending', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60000);
    const news = [
      { title: 'Old', source: 'A', published_at: earlier.toISOString(), url: '' },
      { title: 'New', source: 'B', published_at: now.toISOString(), url: '' },
    ];
    const items = buildFeedItems(null, null, null, news);
    expect(items[0].title).toBe('New');
  });

  it('limits news to 3 items', () => {
    const news = Array.from({ length: 10 }, (_, i) => ({
      title: `News ${i}`,
      source: 'S',
      published_at: new Date().toISOString(),
      url: '',
    }));
    const items = buildFeedItems(null, null, null, news);
    const newsItems = items.filter(i => i.type === 'news');
    expect(newsItems.length).toBeLessThanOrEqual(3);
  });

  it('combines all source types together', () => {
    const log = {
      timestamp: new Date().toISOString(),
      strategies_run: {},
      orders_placed: [],
      orders_closed: [],
      errors: [],
      master_agent: { rejections: [] },
    };
    const regime = { regime: 'Neutral', label: 'neutral', confidence: 0.5, vix_level: 20, description: '' };
    const news = [{ title: 'Headline', source: 'AP', published_at: new Date().toISOString(), url: '' }];
    const items = buildFeedItems(null, log, regime, news);
    expect(items.some(i => i.type === 'pipeline')).toBe(true);
    expect(items.some(i => i.type === 'regime')).toBe(true);
    expect(items.some(i => i.type === 'news')).toBe(true);
  });
});
