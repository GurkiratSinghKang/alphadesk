import { describe, it, expect } from 'vitest';
import { buildFeedItems } from '@/components/dashboard/ActivityFeed';

describe('buildFeedItems', () => {
  it('returns empty array with no inputs', () => {
    const items = buildFeedItems(null, null, null);
    expect(items).toEqual([]);
  });

  it('creates regime event from regime data', () => {
    const items = buildFeedItems(
      null,
      null,
      { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16.5, description: 'Uptrend' },
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
    );
    expect(items[0].severity).toBe('success');
  });

  it('sets severity to danger for bear regime', () => {
    const items = buildFeedItems(
      null,
      null,
      { regime: 'Bear Market', label: 'bear', confidence: 0.85, vix_level: 30, description: 'Downtrend' },
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
    const items = buildFeedItems(null, log, null);
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
    const items = buildFeedItems(null, log, null);
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
    const items = buildFeedItems(null, log, null);
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
    const items = buildFeedItems(null, log, null);
    const alerts = items.filter(i => i.type === 'alert');
    expect(alerts.length).toBe(2);
  });

  it('sorts items by time descending', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60000);
    const log = {
      timestamp: earlier.toISOString(),
      strategies_run: {},
      orders_placed: [],
      orders_closed: [],
      errors: ['Earlier error'],
      master_agent: { rejections: [] },
    };
    const regime = { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16, description: 'Up' };
    const items = buildFeedItems(null, log, regime);
    // Regime uses "now" internally, pipeline log uses the earlier timestamp
    // Items should be sorted by time descending
    expect(items.length).toBeGreaterThan(1);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].time.getTime()).toBeGreaterThanOrEqual(items[i].time.getTime());
    }
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
    const items = buildFeedItems(null, log, regime);
    expect(items.some(i => i.type === 'pipeline')).toBe(true);
    expect(items.some(i => i.type === 'regime')).toBe(true);
  });
});
