import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarketStore } from '@/stores/market';
import { usePortfolioStore } from '@/stores/portfolio';
import { useAlertsStore } from '@/stores/alerts';

// Track subscribe calls and capture onMessage callbacks for simulation
const mockSubscribe = vi.fn();
const mockOnMessageCallbacks = new Map<string, Set<(msg: { channel: string; event: string; data: unknown }) => void>>();

const mockOnMessage = vi.fn((channel: string, callback: (msg: { channel: string; event: string; data: unknown }) => void) => {
  if (!mockOnMessageCallbacks.has(channel)) {
    mockOnMessageCallbacks.set(channel, new Set());
  }
  mockOnMessageCallbacks.get(channel)!.add(callback);
  return () => {
    mockOnMessageCallbacks.get(channel)?.delete(callback);
  };
});

// Simulate sending a WS message to registered callbacks
function simulateMessage(channel: string, event: string, data: unknown) {
  const callbacks = mockOnMessageCallbacks.get(channel);
  if (callbacks) {
    callbacks.forEach(cb => cb({ channel, event, data }));
  }
}

vi.mock('@/lib/providers', () => ({
  useWs: () => ({
    isConnected: true,
    // K-2 (round-6): useDataPipeline now reads `wsStatus` to decide
    // whether to fire a 60 s fallback poll. "open" means the WS is up,
    // so the fallback is dormant in tests.
    wsStatus: 'open',
    subscribe: mockSubscribe,
    unsubscribe: vi.fn(),
    lastMessage: null,
    onMessage: mockOnMessage,
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
    mockOnMessage.mockClear();
    mockOnMessageCallbacks.clear();
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
    expect(mockSubscribe).toHaveBeenCalledWith('bars');
  });

  it('subscribes to exactly 5 channels', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    // quotes, portfolio, alerts, agents, bars — bars was added when the chart
    // moved to live intraday streams.
    expect(mockSubscribe).toHaveBeenCalledTimes(5);
  });

  it('routes quote WS messages to market store', async () => {
    const quote = {
      symbol: 'AAPL', last: 260, bid: 259, ask: 261, change: 1.5,
      changePct: 0.58, volume: 500000, high: 262, low: 258,
      open: 259, close: 260, timestamp: Date.now(),
    };

    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    act(() => {
      simulateMessage('quotes', 'update', quote);
    });

    const stored = useMarketStore.getState().quotes['AAPL'];
    expect(stored).toBeDefined();
    expect(stored?.last).toBe(260);
  });

  it('routes alert WS messages to alerts store', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    act(() => {
      simulateMessage('alerts', 'new', {
        id: 'alert-1', type: 'system', message: 'Test alert', time: Date.now(), acknowledged: false,
      });
    });

    const alerts = useAlertsStore.getState().alerts;
    expect(alerts.some((a) => a.id === 'alert-1')).toBe(true);
  });

  it('routes portfolio positions WS messages to portfolio store', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    act(() => {
      simulateMessage('portfolio', 'update', {
        positions: [
          { symbol: 'TSLA', quantity: 5, avg_cost: 200, current_price: 210, unrealized_pnl: 50, market_value: 1050 },
        ],
      });
    });

    const positions = usePortfolioStore.getState().positions;
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('TSLA');
  });

  it('ignores quote messages without a symbol', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    act(() => {
      simulateMessage('quotes', 'update', { last: 100 });
    });

    expect(Object.keys(useMarketStore.getState().quotes).length).toBe(0);
  });

  it('ignores alert messages without an id', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    renderHook(() => useDataPipeline());

    act(() => {
      simulateMessage('alerts', 'new', { type: 'system', message: 'No id alert' });
    });

    expect(useAlertsStore.getState().alerts.length).toBe(0);
  });

  it('handles no messages gracefully', async () => {
    const { useDataPipeline } = await import('@/hooks/useDataPipeline');
    expect(() => renderHook(() => useDataPipeline())).not.toThrow();
  });
});
