import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarketStore } from '@/stores/market';
import { usePortfolioStore } from '@/stores/portfolio';
import { useAlertsStore } from '@/stores/alerts';

// Track the subscribe calls and lastMessage via a controllable mock
const mockSubscribe = vi.fn();
let mockLastMessage: { channel: string; event: string; data: unknown } | null = null;

vi.mock('@/lib/providers', () => ({
  useWs: () => ({
    isConnected: true,
    subscribe: mockSubscribe,
    unsubscribe: vi.fn(),
    lastMessage: mockLastMessage,
  }),
}));

vi.mock('@/lib/api', () => ({
  getSnapshot: vi.fn().mockResolvedValue({}),
  getPositions: vi.fn().mockResolvedValue([]),
  getOrders: vi.fn().mockResolvedValue([]),
  getPortfolioSummary: vi.fn().mockResolvedValue({
    equity: 100000, cash: 95000, buyingPower: 200000, totalMarketValue: 5000,
    unrealizedPnl: 0, unrealizedPnlPct: 0, realizedPnlToday: 0, positionsCount: 0,
    dayPnl: 0, dayPnlPct: 0,
  }),
  getPortfolioGreeks: vi.fn().mockResolvedValue({
    netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, betaWeightedDelta: 0,
  }),
}));

describe('useDataPipeline', () => {
  beforeEach(() => {
    mockSubscribe.mockClear();
    mockLastMessage = null;
    useMarketStore.setState({
      watchlist: ['SPY', 'AAPL'],
      selectedSymbol: 'SPY',
      quotes: {},
    });
    usePortfolioStore.setState({
      positions: [],
      orders: [],
      summary: { equity: 0, cash: 0, buyingPower: 0, totalMarketValue: 0, unrealizedPnl: 0, unrealizedPnlPct: 0, realizedPnlToday: 0, positionsCount: 0, dayPnl: 0, dayPnlPct: 0 },
      greeks: { netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, betaWeightedDelta: 0 },
    });
    useAlertsStore.setState({ alerts: [] });
  });

  it('subscribes to quotes, portfolio, alerts, and agents channels on mount', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    expect(mockSubscribe).toHaveBeenCalledWith('quotes');
    expect(mockSubscribe).toHaveBeenCalledWith('portfolio');
    expect(mockSubscribe).toHaveBeenCalledWith('alerts');
    expect(mockSubscribe).toHaveBeenCalledWith('agents');
  });

  it('subscribes to exactly 4 channels', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    expect(mockSubscribe).toHaveBeenCalledTimes(4);
  });

  it('routes quote WS messages to market store', async () => {
    const quote = {
      symbol: 'AAPL', last: 260, bid: 259, ask: 261, change: 1.5,
      changePct: 0.58, volume: 500000, high: 262, low: 258,
      open: 259, close: 260, timestamp: Date.now(),
    };
    mockLastMessage = { channel: 'quotes', event: 'update', data: quote };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    // The hook processes lastMessage in useEffect, which runs synchronously in test
    const stored = useMarketStore.getState().quotes['AAPL'];
    expect(stored).toBeDefined();
    expect(stored?.last).toBe(260);
  });

  it('routes alert WS messages to alerts store', async () => {
    mockLastMessage = {
      channel: 'alerts',
      event: 'new',
      data: { id: 'alert-1', type: 'system', message: 'Test alert', time: Date.now(), acknowledged: false },
    };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    const alerts = useAlertsStore.getState().alerts;
    expect(alerts.some((a) => a.id === 'alert-1')).toBe(true);
  });

  it('routes portfolio positions WS messages to portfolio store', async () => {
    mockLastMessage = {
      channel: 'portfolio',
      event: 'update',
      data: {
        positions: [
          { symbol: 'TSLA', quantity: 5, avg_cost: 200, current_price: 210, unrealized_pnl: 50, market_value: 1050 },
        ],
      },
    };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    const positions = usePortfolioStore.getState().positions;
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('TSLA');
  });

  it('ignores quote messages without a symbol', async () => {
    mockLastMessage = { channel: 'quotes', event: 'update', data: { last: 100 } };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    expect(Object.keys(useMarketStore.getState().quotes).length).toBe(0);
  });

  it('ignores alert messages without an id', async () => {
    mockLastMessage = {
      channel: 'alerts',
      event: 'new',
      data: { type: 'system', message: 'No id alert' },
    };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    expect(useAlertsStore.getState().alerts.length).toBe(0);
  });

  it('handles null lastMessage gracefully', async () => {
    mockLastMessage = null;

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    expect(() => renderHook(() => useDataPipeline())).not.toThrow();
  });
});
