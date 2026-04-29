/**
 * API layer tests — mocks global.fetch so every exported function's
 * internal mapping logic is exercised without a real network.
 *
 * apiFetch uses:
 *   - document.cookie  →  set in beforeEach
 *   - window.location  →  stubbed to avoid 401 redirect throws
 *   - env.API_URL      →  empty string in test env, so URL becomes the path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStrategies,
  getStrategyPerformance,
  getStrategyTrades,
  toggleStrategy,
  getStrategyAnalytics,
  getMarketIndices,
  searchSymbols,
  getQuote,
  getBars,
  getSnapshot,
  screenStocks,
  getScreenerPresets,
  analyzeSymbol,
  getAnalysis,
  getOptionsChain,
  getIVData,
  placeOrder,
  cancelOrder,
  getOrders,
  getPositions,
  getPortfolioSummary,
  getPortfolioGreeks,
  getPnlCalendar,
  getMarketRegime,
  getMarketSectors,
  getMarketNews,
  chatWithAgent,
  getPipelineStatus,
  triggerPipeline,
  getPipelineHistory,
  getPipelineRun,
  getPipelinePositions,
  getEarningsCalendar,
  mapPipelineRun,
  mapEarningsDetail,
} from '@/lib/api';

// ─── Mock setup ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);

  // Provide an auth cookie so apiFetch adds an Authorization header
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => 'access_token=test-token',
    set: () => {},
  });

  // Prevent 401 handler from crashing on window.location mutation
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/test', href: '' },
      writable: true,
    });
  }
});

// Helper: build a successful fetch response
function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// ─── mapPipelineRun (pure mapper, no fetch) ──────────────────────────────────

describe('mapPipelineRun', () => {
  it('maps empty raw object to safe defaults', () => {
    const result = mapPipelineRun({});
    expect(result.date).toBe('');
    expect(result.timestamp).toBe('');
    expect(result.screened).toEqual([]);
    expect(result.analyzed).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.ordersPlaced).toEqual([]);
    expect(result.ordersClosed).toEqual([]);
    expect(result.portfolioSnapshot).toEqual({ equity: 0, cash: 0, positions: 0 });
    expect(result.errors).toEqual([]);
  });

  it('maps top-level date and timestamp', () => {
    const result = mapPipelineRun({ date: '2026-04-10', timestamp: '2026-04-10T18:00:00Z' });
    expect(result.date).toBe('2026-04-10');
    expect(result.timestamp).toBe('2026-04-10T18:00:00Z');
  });

  it('maps screened stocks: snake_case composite_score and change_pct', () => {
    const raw = {
      screened: [
        { symbol: 'AAPL', name: 'Apple', price: 175, composite_score: 0.9, sector: 'Tech', change_pct: 1.5 },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.screened).toHaveLength(1);
    expect(result.screened[0].symbol).toBe('AAPL');
    expect(result.screened[0].compositeScore).toBe(0.9);
    expect(result.screened[0].changePct).toBe(1.5);
    expect(result.screened[0].sector).toBe('Tech');
  });

  it('maps screened stocks: camelCase fallback compositeScore and changePct', () => {
    const raw = {
      screened: [
        { symbol: 'MSFT', name: 'Microsoft', price: 380, compositeScore: 0.8, sector: 'Tech', changePct: 2.0 },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.screened[0].compositeScore).toBe(0.8);
    expect(result.screened[0].changePct).toBe(2.0);
  });

  it('maps analyzed: snake_case entry_price, stop_loss, take_profit', () => {
    const raw = {
      analyzed: [
        { symbol: 'NVDA', signal: 'buy', conviction: 0.85, entry_price: 800, stop_loss: 760, take_profit: 900, rationale: 'Breakout' },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.analyzed[0].entryPrice).toBe(800);
    expect(result.analyzed[0].stopLoss).toBe(760);
    expect(result.analyzed[0].takeProfit).toBe(900);
    expect(result.analyzed[0].signal).toBe('buy');
    expect(result.analyzed[0].conviction).toBe(0.85);
  });

  it('maps analyzed: camelCase fallback entryPrice, stopLoss, takeProfit', () => {
    const raw = {
      analyzed: [
        { symbol: 'TSLA', signal: 'hold', conviction: 0.5, entryPrice: null, stopLoss: null, takeProfit: null, rationale: '' },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.analyzed[0].entryPrice).toBeNull();
    expect(result.analyzed[0].stopLoss).toBeNull();
    expect(result.analyzed[0].takeProfit).toBeNull();
  });

  it('maps analyzed: missing signal defaults to "hold"', () => {
    const raw = { analyzed: [{ symbol: 'X', conviction: 0 }] };
    const result = mapPipelineRun(raw);
    expect(result.analyzed[0].signal).toBe('hold');
  });

  it('maps orders_placed (snake_case key)', () => {
    const raw = {
      orders_placed: [
        { symbol: 'SPY', side: 'buy', qty: 10, price: 500, order_id: 'ord-1', status: 'filled', timestamp: '2026-04-10T09:30:00Z' },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.ordersPlaced).toHaveLength(1);
    expect(result.ordersPlaced[0].orderId).toBe('ord-1');
    expect(result.ordersPlaced[0].qty).toBe(10);
    expect(result.ordersPlaced[0].side).toBe('buy');
  });

  it('maps ordersPlaced (camelCase key fallback)', () => {
    const raw = {
      ordersPlaced: [
        { symbol: 'QQQ', side: 'sell', qty: 5, price: 440, orderId: 'ord-2', status: 'filled', timestamp: '2026-04-10T10:00:00Z' },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.ordersPlaced[0].orderId).toBe('ord-2');
  });

  it('maps orders_closed (snake_case key)', () => {
    const raw = {
      orders_closed: [
        { symbol: 'AAPL', side: 'sell', qty: 3, price: 180, order_id: 'ord-3', status: 'closed', timestamp: '2026-04-10T15:00:00Z' },
      ],
    };
    const result = mapPipelineRun(raw);
    expect(result.ordersClosed[0].orderId).toBe('ord-3');
    expect(result.ordersClosed[0].symbol).toBe('AAPL');
  });

  it('maps portfolioSnapshot from snake_case portfolio_snapshot', () => {
    const raw = {
      portfolio_snapshot: { equity: 120000, cash: 80000, positions: 4 },
    };
    const result = mapPipelineRun(raw);
    expect(result.portfolioSnapshot.equity).toBe(120000);
    expect(result.portfolioSnapshot.cash).toBe(80000);
    expect(result.portfolioSnapshot.positions).toBe(4);
  });

  it('maps portfolioSnapshot from camelCase portfolioSnapshot fallback', () => {
    const raw = {
      portfolioSnapshot: { equity: 99000, cash: 50000, positions: 2 },
    };
    const result = mapPipelineRun(raw);
    expect(result.portfolioSnapshot.equity).toBe(99000);
  });

  it('passes signals array through as-is', () => {
    const raw = { signals: [{ type: 'buy', symbol: 'GOOG' }] };
    const result = mapPipelineRun(raw);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].type).toBe('buy');
  });

  it('maps errors array', () => {
    const raw = { errors: ['fetch failed', 'order rejected'] };
    const result = mapPipelineRun(raw);
    expect(result.errors).toEqual(['fetch failed', 'order rejected']);
  });
});

// ─── mapEarningsDetail (Round-5 NEW-Y9 / E-15: client-side sort) ───────────────
//
// `mapEarningsDetail` only inspects `error_codes` materially — the rest of
// the payload is shallow-copied through. Round-5 sorts codes alphabetically
// and silently drops non-string entries so the partial-data banner stays
// stable across race-affected backend responses.

describe('mapEarningsDetail', () => {
  // Bare-minimum stub for the rest of the EarningsDetail wire shape — the
  // mapper only touches `error_codes`, so the rest can be vacuous.
  const baseRaw = {
    symbol: 'NVDA', company: 'Nvidia', sector: 'Semis',
    report_date: '2026-04-23', report_time: 'AMC' as const,
    quote: null, metrics: null, strike_ladder: null,
    claude_structured: null, claude_full_research: null,
    iv_term_structure: null, skew: null,
    news: [], partial: false,
    generated_at: '2026-04-23T15:00:00Z',
  };

  it('defaults missing error_codes to an empty array', () => {
    const out = mapEarningsDetail({ ...baseRaw });
    expect(out.errorCodes).toEqual([]);
  });

  it('sorts error_codes alphabetically for stable banner rendering', () => {
    const out = mapEarningsDetail({
      ...baseRaw,
      error_codes: ['news_unavailable', 'claude_unavailable', 'iv_term_partial'],
    });
    expect(out.errorCodes).toEqual([
      'claude_unavailable',
      'iv_term_partial',
      'news_unavailable',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = ['c', 'a', 'b'];
    mapEarningsDetail({ ...baseRaw, error_codes: input });
    expect(input).toEqual(['c', 'a', 'b']);
  });

  it('drops non-string entries silently from a wonky backend payload', () => {
    const out = mapEarningsDetail({
      ...baseRaw,
      // simulate weird shapes — number, null, plain object
      error_codes: ['news_unavailable', 42, null, { code: 'x' }, 'a_code'] as unknown as string[],
    });
    expect(out.errorCodes).toEqual(['a_code', 'news_unavailable']);
  });

  it('passes unknown-but-string codes through (UI renders them raw)', () => {
    const out = mapEarningsDetail({
      ...baseRaw,
      error_codes: ['some_brand_new_code', 'iv_unavailable'] as unknown as string[],
    });
    expect(out.errorCodes).toEqual(['iv_unavailable', 'some_brand_new_code']);
  });
});

describe('getEarningsCalendar', () => {
  it('threads an explicit normalized watchlist query when watchlist-only is active', async () => {
    mockFetch.mockResolvedValueOnce(ok({
      earnings: [],
      generated_at: '2026-04-29T13:00:00Z',
      partial: false,
    }));

    await getEarningsCalendar({
      watchlistOnly: true,
      watchlistSymbols: [' nvda ', 'NVDA', 'brk.b', 'bad/script'],
    });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(String(url), 'http://alphadesk.local');
    expect(parsed.pathname).toBe('/api/v1/earnings/calendar');
    expect(parsed.searchParams.get('watchlist_only')).toBe('true');
    expect(parsed.searchParams.get('watchlist')).toBe('NVDA,BRK.B');
  });

  it('sends an empty explicit watchlist instead of falling back to server defaults', async () => {
    mockFetch.mockResolvedValueOnce(ok({
      earnings: [],
      generated_at: '2026-04-29T13:00:00Z',
      partial: false,
    }));

    await getEarningsCalendar({ watchlistOnly: true, watchlistSymbols: [] });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(String(url), 'http://alphadesk.local');
    expect(parsed.searchParams.get('watchlist')).toBe('');
  });
});

// ─── getStrategies ────────────────────────────────────────────────────────────

describe('getStrategies', () => {
  it('returns the strategy list directly', async () => {
    const payload = [
      { id: 'pead', name: 'PEAD', status: 'active', invested_amount: 5000, total_return_pct: 6.6, win_rate: 55, active_positions_count: 2 },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getStrategies();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pead');
    expect(result[0].name).toBe('PEAD');
    expect(result[0].status).toBe('active');
    expect(result[0].invested_amount).toBe(5000);
    expect(result[0].win_rate).toBe(55);
    expect(result[0].active_positions_count).toBe(2);
  });
});

// ─── getStrategyPerformance ───────────────────────────────────────────────────

describe('getStrategyPerformance', () => {
  it('returns StrategyPerformance data unchanged', async () => {
    const payload = {
      name: 'Momentum Quality',
      description: 'desc',
      status: 'active',
      invested_amount: 50000,
      current_value: 53000,
      total_return_pct: 6.0,
      annualized_return_pct: 18.0,
      return_dollars: 3000,
      win_rate: 65.0,
      sharpe_ratio: 1.42,
      max_drawdown: -8.5,
      active_positions_count: 5,
      equity_curve: [{ date: '2026-01-01', value: 50000 }],
      last_trade_date: '2026-04-09',
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getStrategyPerformance('momentum-quality');
    expect(result.name).toBe('Momentum Quality');
    expect(result.sharpe_ratio).toBe(1.42);
    expect(result.equity_curve).toHaveLength(1);
  });
});

// ─── getStrategyTrades ────────────────────────────────────────────────────────

describe('getStrategyTrades', () => {
  it('returns trade list', async () => {
    const payload = [
      { id: 1, symbol: 'AAPL', strategy: 'pead', side: 'buy', quantity: 10, entry_price: 150, exit_price: 165, pnl: 150, pnl_pct: 10, entry_time: '2026-03-01T09:30:00Z', exit_time: '2026-03-15T15:00:00Z', status: 'closed', notes: null },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getStrategyTrades('pead');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
    expect(result[0].pnl).toBe(150);
  });

  it('uses default limit=100 in URL', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getStrategyTrades('momentum');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=100');
    expect(calledUrl).toContain('strategy=momentum');
  });

  it('accepts custom limit', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getStrategyTrades('vcp', 25);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=25');
  });
});

// ─── toggleStrategy ───────────────────────────────────────────────────────────

describe('toggleStrategy', () => {
  it('returns strategy id and new status', async () => {
    mockFetch.mockReturnValueOnce(
      ok({ id: 'pead', name: 'PEAD', previous_status: 'active', new_status: 'inactive' }),
    );
    const result = await toggleStrategy('pead');
    expect(result.id).toBe('pead');
    expect(result.new_status).toBe('inactive');
    expect(result.previous_status).toBe('active');
  });

  it('calls POST method', async () => {
    mockFetch.mockReturnValueOnce(
      ok({ id: 'vcp', name: 'VCP', previous_status: 'inactive', new_status: 'active' }),
    );
    await toggleStrategy('vcp');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
  });
});

// ─── getStrategyAnalytics ─────────────────────────────────────────────────────

describe('getStrategyAnalytics', () => {
  it('returns analytics data unchanged', async () => {
    const payload = {
      strategy_id: 'momentum',
      sector_exposure: { current: { Technology: 0.4 } },
      monthly_returns: [{ year: 2026, month: 3, return_pct: 4.2 }],
      streaks: { current: { type: 'win', count: 3 }, best_win: 7, worst_loss: 4 },
      conviction_distribution: [{ bucket: 'high', wins: 10, losses: 3 }],
      hold_time_stats: { avg_win_days: 12, avg_loss_days: 6, median_hold_days: 10 },
      correlations: { SPY: 0.65 },
      rolling_beta: [{ date: '2026-04-01', beta: 1.1 }],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getStrategyAnalytics('momentum');
    expect(result.strategy_id).toBe('momentum');
    expect(result.streaks.current.type).toBe('win');
    expect(result.monthly_returns[0].return_pct).toBe(4.2);
  });
});

// ─── getMarketIndices ─────────────────────────────────────────────────────────

describe('getMarketIndices', () => {
  it('returns indices object unchanged', async () => {
    const payload = {
      indices: [
        { symbol: 'SPY', name: 'S&P 500', price: 500, change: 2, change_pct: 0.4 },
        { symbol: 'QQQ', name: 'NASDAQ 100', price: 440, change: -1, change_pct: -0.22 },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getMarketIndices();
    expect(result.indices).toHaveLength(2);
    expect(result.indices[0].symbol).toBe('SPY');
    expect(result.indices[1].change_pct).toBe(-0.22);
  });
});

// ─── searchSymbols ────────────────────────────────────────────────────────────

describe('searchSymbols', () => {
  it('returns only the results array (unwraps wrapper)', async () => {
    const payload = {
      count: 2,
      results: [
        { symbol: 'AAPL', name: 'Apple Inc.', type: 'equity', exchange: 'NASDAQ', sector: 'Technology' },
        { symbol: 'AAPLW', name: 'Apple Warrant', type: 'warrant', exchange: 'NASDAQ', sector: '' },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await searchSymbols('AAPL');
    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('AAPL');
    expect(result[1].type).toBe('warrant');
  });

  it('encodes query in URL', async () => {
    mockFetch.mockReturnValueOnce(ok({ count: 0, results: [] }));
    await searchSymbols('S&P 500');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('q=S%26P%20500');
  });

  it('uses default limit=10', async () => {
    mockFetch.mockReturnValueOnce(ok({ count: 0, results: [] }));
    await searchSymbols('TSLA');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=10');
  });

  it('accepts custom limit', async () => {
    mockFetch.mockReturnValueOnce(ok({ count: 0, results: [] }));
    await searchSymbols('TSLA', 5);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=5');
  });
});

// ─── getQuote ─────────────────────────────────────────────────────────────────

describe('getQuote', () => {
  it('returns quote data unchanged', async () => {
    const payload = { symbol: 'AAPL', price: 175, bid: 174.9, ask: 175.1, volume: 80000000, change: 2, changePct: 1.15 };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getQuote('AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.price).toBe(175);
  });
});

// ─── getBars ─────────────────────────────────────────────────────────────────

describe('getBars', () => {
  it('maps backend bars to OHLCVBar with Unix timestamps', async () => {
    const ts = '2026-04-10T14:30:00Z';
    const expectedUnix = Math.floor(new Date(ts).getTime() / 1000);
    const payload = [
      { timestamp: ts, open: 174, high: 176, low: 173, close: 175, volume: 1000000 },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getBars('AAPL');
    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(expectedUnix);
    expect(result[0].open).toBe(174);
    expect(result[0].high).toBe(176);
    expect(result[0].low).toBe(173);
    expect(result[0].close).toBe(175);
    expect(result[0].volume).toBe(1000000);
  });

  it('strips vwap field (not part of OHLCVBar)', async () => {
    const payload = [
      { timestamp: '2026-04-10T09:30:00Z', open: 100, high: 105, low: 99, close: 103, volume: 500000, vwap: 102 },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getBars('SPY', 'D');
    expect((result[0] as any).vwap).toBeUndefined();
  });

  it('maps timeframes correctly: D→1d, W→1w, M→1mo', async () => {
    for (const [tf, expected] of [['D', '1d'], ['W', '1w'], ['M', '1mo']] as const) {
      mockFetch.mockReturnValueOnce(ok([]));
      await getBars('SPY', tf as any);
      const calledUrl: string = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(calledUrl).toContain(`timeframe=${expected}`);
    }
  });

  it('maps intraday timeframes: 1m→1min, 5m→5min, 1H→1h, 4H→4h', async () => {
    for (const [tf, expected] of [['1m', '1min'], ['5m', '5min'], ['15m', '15min'], ['1H', '1h'], ['4H', '4h']] as const) {
      mockFetch.mockReturnValueOnce(ok([]));
      await getBars('QQQ', tf as any);
      const calledUrl: string = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(calledUrl).toContain(`timeframe=${expected}`);
    }
  });

  it('unknown timeframe falls back to 1d', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getBars('TSLA', 'X' as any);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('timeframe=1d');
  });

  it('passes limit param', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getBars('NVDA', 'D', 200);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=200');
  });

  it('maps multiple bars in order', async () => {
    const payload = [
      { timestamp: '2026-04-08T09:30:00Z', open: 100, high: 102, low: 99, close: 101, volume: 100 },
      { timestamp: '2026-04-09T09:30:00Z', open: 101, high: 104, low: 100, close: 103, volume: 200 },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getBars('MSFT', 'D');
    expect(result).toHaveLength(2);
    expect(result[0].close).toBe(101);
    expect(result[1].close).toBe(103);
  });
});

// ─── getSnapshot ─────────────────────────────────────────────────────────────

describe('getSnapshot', () => {
  it('returns a map of symbol to quote', async () => {
    const aaplQuote = { symbol: 'AAPL', price: 175, bid: 174.9, ask: 175.1, volume: 80000000, change: 2, changePct: 1.15 };
    const msftQuote = { symbol: 'MSFT', price: 380, bid: 379.5, ask: 380.5, volume: 30000000, change: 1, changePct: 0.26 };
    mockFetch.mockReturnValueOnce(ok(aaplQuote));
    mockFetch.mockReturnValueOnce(ok(msftQuote));

    const result = await getSnapshot(['AAPL', 'MSFT']);
    expect(result['AAPL'].price).toBe(175);
    expect(result['MSFT'].price).toBe(380);
  });

  it('skips failed symbols silently', async () => {
    mockFetch.mockReturnValueOnce(ok({ symbol: 'AAPL', price: 175, bid: 174.9, ask: 175.1, volume: 80000000, change: 2, changePct: 1.15 }));
    mockFetch.mockReturnValueOnce(Promise.reject(new Error('symbol not found')));

    const result = await getSnapshot(['AAPL', 'INVALID']);
    expect(result['AAPL']).toBeDefined();
    expect(result['INVALID']).toBeUndefined();
  });

  it('returns empty object for empty symbol list', async () => {
    const result = await getSnapshot([]);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── screenStocks ─────────────────────────────────────────────────────────────

describe('screenStocks', () => {
  it('maps backend results to ScreenerResult shape', async () => {
    const payload = {
      count: 1,
      screened_at: '2026-04-10T12:00:00Z',
      results: [
        {
          symbol: 'NVDA',
          name: 'NVIDIA',
          sector: 'Technology',
          price: 820,
          change_pct: 3.5,
          composite_score: 0.92,
          metrics: { rs_score: 95, f_score: 7, iv_rank: 40, iv_percentile: 55, ml_score: 0.88 },
        },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await screenStocks('momentum');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('NVDA');
    expect(result[0].price).toBe(820);
    expect(result[0].changePct).toBe(3.5);
    expect(result[0].rsScore).toBe(95);
    expect(result[0].fScore).toBe(7);
    expect(result[0].ivRank).toBe(40);
    expect(result[0].ivPctl).toBe(55);
    expect(result[0].mlScore).toBe(0.88);
    expect(result[0].composite).toBe(0.92);
    expect(result[0].sector).toBe('Technology');
    // Round-11 / Y-4: ``change`` field removed from ScreenerResult — backend
    // only emits ``change_pct``; the old hard-coded 0 was a placebo.
  });

  it('handles null price and change_pct with 0 defaults', async () => {
    const payload = {
      count: 1,
      screened_at: '2026-04-10T12:00:00Z',
      results: [
        { symbol: 'XYZ', name: 'Unknown', sector: null, price: null, change_pct: null, composite_score: 0.5, metrics: {} },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await screenStocks();
    expect(result[0].price).toBe(0);
    expect(result[0].changePct).toBe(0);
    expect(result[0].sector).toBe('Unknown');
    expect(result[0].rsScore).toBe(0);
  });

  it('calls POST method with strategy body', async () => {
    mockFetch.mockReturnValueOnce(ok({ count: 0, results: [], screened_at: '' }));
    await screenStocks('vcp', { minPrice: 10 });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.strategy).toBe('vcp');
    expect(body.minPrice).toBe(10);
  });
});

// ─── getScreenerPresets ───────────────────────────────────────────────────────

describe('getScreenerPresets', () => {
  it('returns presets list unchanged', async () => {
    const payload = [
      { name: 'vcp', description: 'Volatility Contraction Pattern' },
      { name: 'pead', description: 'Post-Earnings Announcement Drift' },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getScreenerPresets();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('vcp');
  });
});

// ─── analyzeSymbol ────────────────────────────────────────────────────────────

describe('analyzeSymbol', () => {
  it('maps agent_results to frontend Analysis shape', async () => {
    const payload = {
      symbol: 'AAPL',
      composite_score: 72,
      recommendation: 'Buy',
      agent_results: [
        { agent: 'technical', score: 80, summary: 'Strong uptrend', details: {} },
        { agent: 'fundamental', score: 70, summary: 'Good earnings', details: {} },
        { agent: 'sentiment', score: 65, summary: 'Positive news', details: {} },
        { agent: 'options', score: 60, summary: 'Low IV', details: {} },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await analyzeSymbol('AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.technicalScore).toBe(80);
    expect(result.fundamentalScore).toBe(70);
    expect(result.sentimentScore).toBe(65);
    expect(result.composite).toBe(72);
    expect(result.summary).toBe('Strong uptrend');
    expect(result.signals).toEqual([]);
  });

  it('defaults scores to 0 when agents are missing', async () => {
    const payload = {
      symbol: 'XYZ',
      composite_score: 0,
      recommendation: 'Hold',
      agent_results: [],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await analyzeSymbol('XYZ');
    expect(result.technicalScore).toBe(0);
    expect(result.fundamentalScore).toBe(0);
    expect(result.sentimentScore).toBe(0);
    expect(result.summary).toBe('Hold'); // falls back to recommendation
  });

  it('calls POST with correct agents array', async () => {
    mockFetch.mockReturnValueOnce(ok({ symbol: 'SPY', composite_score: 50, recommendation: '', agent_results: [] }));
    await analyzeSymbol('SPY');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.agents).toEqual(['technical', 'fundamental', 'sentiment', 'options']);
  });
});

// ─── getOptionsChain ─────────────────────────────────────────────────────────

describe('getOptionsChain', () => {
  it('splits contracts into calls and puts', async () => {
    const payload = {
      underlying: 'AAPL',
      expirations: ['2026-04-17', '2026-04-24'],
      contracts: [
        { symbol: 'AAPL260417C00175000', option_type: 'call', expiry: '2026-04-17', strike: 175, bid: 2.5, ask: 2.7, last: 2.6, volume: 5000, open_interest: 10000, iv: 0.25, delta: 0.5, gamma: 0.02, theta: -0.05, vega: 0.15 },
        { symbol: 'AAPL260417P00175000', option_type: 'put', expiry: '2026-04-17', strike: 175, bid: 2.3, ask: 2.5, last: 2.4, volume: 4000, open_interest: 8000, iv: 0.27, delta: -0.5, gamma: 0.02, theta: -0.04, vega: 0.14 },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getOptionsChain('AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.expirations).toEqual(['2026-04-17', '2026-04-24']);
    expect(result.calls).toHaveLength(1);
    expect(result.puts).toHaveLength(1);
    expect(result.calls[0].type).toBe('call');
    expect(result.puts[0].type).toBe('put');
    expect(result.calls[0].strike).toBe(175);
    expect(result.puts[0].oi).toBe(8000);
    expect(result.calls[0].delta).toBe(0.5);
    expect(result.puts[0].delta).toBe(-0.5);
  });

  it('falls back to passed symbol when underlying is missing', async () => {
    const payload = { contracts: [], expirations: [] };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getOptionsChain('MSFT');
    expect(result.symbol).toBe('MSFT');
  });

  it('handles empty contracts list', async () => {
    const payload = { underlying: 'TSLA', contracts: [], expirations: [] };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getOptionsChain('TSLA');
    expect(result.calls).toHaveLength(0);
    expect(result.puts).toHaveLength(0);
  });

  it('appends expiration query param when provided', async () => {
    mockFetch.mockReturnValueOnce(ok({ contracts: [], expirations: [] }));
    await getOptionsChain('AAPL', '2026-04-17');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('expiry=2026-04-17');
  });

  it('does not append query param when expiration is omitted', async () => {
    mockFetch.mockReturnValueOnce(ok({ contracts: [], expirations: [] }));
    await getOptionsChain('AAPL');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).not.toContain('expiry=');
  });
});

// ─── getIVData ────────────────────────────────────────────────────────────────

describe('getIVData', () => {
  it('maps snake_case fields and computes hvRatio', async () => {
    const payload = { iv_rank: 45, iv_percentile: 60, current_iv: 0.30, hv_20: 0.20 };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getIVData('AAPL');
    expect(result.ivRank).toBe(45);
    expect(result.ivPctl).toBe(60);
    expect(result.currentIV).toBe(0.30);
    expect(result.hvRatio).toBeCloseTo(0.30 / 0.20, 5);
  });

  it('defaults missing fields to 0', async () => {
    mockFetch.mockReturnValueOnce(ok({}));

    const result = await getIVData('XYZ');
    expect(result.ivRank).toBe(0);
    expect(result.ivPctl).toBe(0);
    expect(result.currentIV).toBe(0);
    // hvRatio: 0 / max(0, 0.01) = 0
    expect(result.hvRatio).toBe(0);
  });

  it('guards against zero hv_20 to avoid division by zero', async () => {
    const payload = { iv_rank: 50, iv_percentile: 65, current_iv: 0.25, hv_20: 0 };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getIVData('TSLA');
    // max(0, 0.01) = 0.01 so ratio = 0.25/0.01 = 25
    expect(result.hvRatio).toBe(25);
  });
});

// ─── placeOrder ───────────────────────────────────────────────────────────────

describe('placeOrder', () => {
  it('sends correct body for a market order (no legs)', async () => {
    const order = { id: 'ord-1', symbol: 'SPY', side: 'buy' as const, type: 'market' as const, quantity: 10, status: 'pending' as const, createdAt: '2026-04-10T09:30:00Z', legs: [] };
    mockFetch.mockReturnValueOnce(ok(order));

    await placeOrder({ symbol: 'SPY', side: 'buy', type: 'market', quantity: 10 });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0].symbol).toBe('SPY');
    expect(body.legs[0].side).toBe('buy');
    expect(body.legs[0].qty).toBe(10);
    expect(body.legs[0].order_type).toBe('market');
    expect(body.legs[0].limit_price).toBeNull();
    expect(body.time_in_force).toBe('day');
  });

  it('sends limit_price for limit orders', async () => {
    const order = { id: 'ord-2', symbol: 'AAPL', side: 'buy' as const, type: 'limit' as const, quantity: 5, price: 175, status: 'pending' as const, createdAt: '2026-04-10T09:30:00Z', legs: [] };
    mockFetch.mockReturnValueOnce(ok(order));

    await placeOrder({ symbol: 'AAPL', side: 'buy', type: 'limit', quantity: 5, price: 175 });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.legs[0].limit_price).toBe(175);
    expect(body.legs[0].stop_price).toBeNull();
  });

  it('sends stop_price for stop orders', async () => {
    const order = { id: 'ord-3', symbol: 'TSLA', side: 'sell' as const, type: 'stop' as const, quantity: 2, status: 'pending' as const, createdAt: '2026-04-10T09:30:00Z', legs: [] };
    mockFetch.mockReturnValueOnce(ok(order));

    await placeOrder({ symbol: 'TSLA', side: 'sell', type: 'stop', quantity: 2, price: 200 });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.legs[0].stop_price).toBe(200);
    expect(body.legs[0].limit_price).toBeNull();
  });

  it('uses provided legs when specified', async () => {
    const order = { id: 'ord-4', symbol: 'SPY', side: 'buy' as const, type: 'limit' as const, quantity: 10, status: 'pending' as const, createdAt: '2026-04-10T09:30:00Z', legs: [] };
    mockFetch.mockReturnValueOnce(ok(order));

    await placeOrder({
      symbol: 'SPY',
      side: 'buy',
      type: 'limit',
      quantity: 10,
      legs: [
        { symbol: 'SPY', side: 'buy', quantity: 10, price: 500 },
      ],
    });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0].qty).toBe(10);
  });
});

// ─── cancelOrder ─────────────────────────────────────────────────────────────

describe('cancelOrder', () => {
  it('sends DELETE and resolves on 204', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve(
        new Response(null, {
          status: 204,
          headers: { 'content-length': '0' },
        }),
      ),
    );

    await expect(cancelOrder('ord-123')).resolves.toBeUndefined();
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('ord-123');
    expect(init.method).toBe('DELETE');
  });
});

// ─── getOrders ────────────────────────────────────────────────────────────────

describe('getOrders', () => {
  it('maps order with legs correctly', async () => {
    const payload = [
      {
        id: 'ord-1',
        status: 'filled',
        filled_at: '2026-04-10T09:35:00Z',
        submitted_at: '2026-04-10T09:30:00Z',
        legs: [
          { symbol: 'AAPL', side: 'buy', qty: 10, order_type: 'market', limit_price: null },
        ],
      },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getOrders();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ord-1');
    expect(result[0].symbol).toBe('AAPL');
    expect(result[0].side).toBe('buy');
    expect(result[0].quantity).toBe(10);
    expect(result[0].type).toBe('market');
    expect(result[0].status).toBe('filled');
    expect(result[0].filledAt).toBe('2026-04-10T09:35:00Z');
    expect(result[0].legs).toHaveLength(1);
  });

  it('maps order without legs using top-level fields', async () => {
    const payload = [
      {
        id: 'ord-2',
        symbol: 'SPY',
        side: 'sell',
        type: 'limit',
        quantity: 5,
        price: 500,
        status: 'pending',
        submitted_at: '2026-04-10T10:00:00Z',
        legs: [],
      },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getOrders('pending');
    expect(result[0].symbol).toBe('SPY');
    expect(result[0].side).toBe('sell');
    expect(result[0].quantity).toBe(5);
  });

  it('appends status filter to URL', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getOrders('open');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('status=open');
  });

  it('omits status param when not provided', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getOrders();
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).not.toContain('status=');
  });
});

// ─── getPositions ─────────────────────────────────────────────────────────────

describe('getPositions', () => {
  it('maps snake_case fields to camelCase Position', async () => {
    const payload = [
      { symbol: 'AAPL', quantity: 10, avg_cost: 150, current_price: 175, unrealized_pnl: 250, market_value: 1750, side: 'long' },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPositions();
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
    expect(result[0].quantity).toBe(10);
    expect(result[0].avgCost).toBe(150);
    expect(result[0].currentPrice).toBe(175);
    expect(result[0].unrealizedPnl).toBe(250);
    expect(result[0].marketValue).toBe(1750);
    expect(result[0].side).toBe('long');
  });

  it('falls back to qty when quantity is missing', async () => {
    const payload = [
      { symbol: 'MSFT', qty: 5, avg_cost: 380, current_price: 390, unrealized_pnl: 50, market_value: 1950, side: 'long' },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPositions();
    expect(result[0].quantity).toBe(5);
  });

  it('falls back to camelCase avgCost when avg_cost is missing', async () => {
    const payload = [
      { symbol: 'NVDA', quantity: 2, avgCost: 800, currentPrice: 850, unrealizedPnl: 100, marketValue: 1700 },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPositions();
    expect(result[0].avgCost).toBe(800);
    expect(result[0].currentPrice).toBe(850);
    expect(result[0].unrealizedPnl).toBe(100);
  });

  it('defaults missing numeric fields to 0', async () => {
    const payload = [{ symbol: 'XYZ' }];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPositions();
    expect(result[0].quantity).toBe(0);
    expect(result[0].avgCost).toBe(0);
    expect(result[0].currentPrice).toBe(0);
    expect(result[0].unrealizedPnl).toBe(0);
    expect(result[0].marketValue).toBe(0);
  });
});

// ─── getPortfolioSummary ──────────────────────────────────────────────────────

describe('getPortfolioSummary', () => {
  it('maps snake_case to camelCase and computes dayPnl/dayPnlPct', async () => {
    const payload = {
      equity: 100000,
      cash: 95000,
      buying_power: 200000,
      total_market_value: 5000,
      unrealized_pnl: 100,
      unrealized_pnl_pct: 2,
      realized_pnl_today: -50,
      positions_count: 1,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPortfolioSummary();
    expect(result.equity).toBe(100000);
    expect(result.cash).toBe(95000);
    expect(result.buyingPower).toBe(200000);
    expect(result.totalMarketValue).toBe(5000);
    expect(result.unrealizedPnl).toBe(100);
    expect(result.unrealizedPnlPct).toBe(2);
    expect(result.realizedPnlToday).toBe(-50);
    expect(result.positionsCount).toBe(1);
    expect(result.dayPnl).toBe(-50); // realized_pnl_today only (no day_pnl/profit_loss in response)
    // lastEquity = 100000 - (-50) = 100050; dayPnlPct = -50/100050*100
    expect(result.dayPnlPct).toBeCloseTo(-0.04998, 3);
  });

  it('computes dayPnl as 0 when both pnl fields are 0', async () => {
    const payload = {
      equity: 100000, cash: 100000, buying_power: 200000,
      total_market_value: 0, unrealized_pnl: 0, unrealized_pnl_pct: 0,
      realized_pnl_today: 0, positions_count: 0,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPortfolioSummary();
    expect(result.dayPnl).toBe(0);
    expect(result.dayPnlPct).toBe(0);
  });

  it('handles zero equity without dividing by zero', async () => {
    const payload = {
      equity: 0, cash: 0, buying_power: 0,
      total_market_value: 0, unrealized_pnl: 0, unrealized_pnl_pct: 0,
      realized_pnl_today: 0, positions_count: 0,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPortfolioSummary();
    expect(result.dayPnlPct).toBe(0);
  });

  it('sums positive unrealized with negative realized correctly', async () => {
    const payload = {
      equity: 50000, cash: 45000, buying_power: 90000,
      total_market_value: 5000, unrealized_pnl: 500, unrealized_pnl_pct: 10,
      realized_pnl_today: -200, positions_count: 2,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPortfolioSummary();
    expect(result.dayPnl).toBe(-200); // realized_pnl_today only (no day_pnl/profit_loss in response)
  });
});

// ─── getPortfolioGreeks ───────────────────────────────────────────────────────

describe('getPortfolioGreeks', () => {
  it('maps snake_case Greeks to camelCase', async () => {
    const payload = {
      net_delta: 0.5,
      net_gamma: 0.02,
      net_theta: -0.05,
      net_vega: 0.15,
      beta_weighted_delta: 1.2,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPortfolioGreeks();
    expect(result.netDelta).toBe(0.5);
    expect(result.netGamma).toBe(0.02);
    expect(result.netTheta).toBe(-0.05);
    expect(result.netVega).toBe(0.15);
    expect(result.betaWeightedDelta).toBe(1.2);
  });

  it('defaults missing fields to 0', async () => {
    mockFetch.mockReturnValueOnce(ok({}));

    const result = await getPortfolioGreeks();
    expect(result.netDelta).toBe(0);
    expect(result.netGamma).toBe(0);
    expect(result.netTheta).toBe(0);
    expect(result.netVega).toBe(0);
    expect(result.betaWeightedDelta).toBe(0);
  });
});

// ─── getPnlCalendar ───────────────────────────────────────────────────────────

describe('getPnlCalendar', () => {
  it('maps calendar response including days with win_rate→winRate', async () => {
    const payload = {
      month: 4,
      year: 2026,
      days: [
        { date: '2026-04-01', pnl: 200, trades: 4, win_rate: 75 },
        { date: '2026-04-02', pnl: -100, trades: 2, win_rate: 50 },
      ],
      month_total: 100,
      trading_days: 2,
      winning_days: 1,
      losing_days: 1,
      best_day: { date: '2026-04-01', pnl: 200 },
      worst_day: { date: '2026-04-02', pnl: -100 },
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPnlCalendar(2026, 4);
    expect(result.month).toBe(4);
    expect(result.year).toBe(2026);
    expect(result.days).toHaveLength(2);
    expect(result.days[0].winRate).toBe(75);
    expect(result.days[1].pnl).toBe(-100);
    expect(result.monthTotal).toBe(100);
    expect(result.tradingDays).toBe(2);
    expect(result.winningDays).toBe(1);
    expect(result.losingDays).toBe(1);
    expect(result.bestDay).toEqual({ date: '2026-04-01', pnl: 200 });
    expect(result.worstDay).toEqual({ date: '2026-04-02', pnl: -100 });
  });

  it('handles null best_day and worst_day', async () => {
    const payload = {
      month: 4, year: 2026, days: [],
      month_total: 0, trading_days: 0, winning_days: 0, losing_days: 0,
      best_day: null, worst_day: null,
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPnlCalendar(2026, 4);
    expect(result.bestDay).toBeNull();
    expect(result.worstDay).toBeNull();
    expect(result.days).toHaveLength(0);
  });

  it('uses current year and month when not specified', async () => {
    mockFetch.mockReturnValueOnce(ok({ month: 4, year: 2026, days: [], month_total: 0, trading_days: 0, winning_days: 0, losing_days: 0, best_day: null, worst_day: null }));
    await getPnlCalendar();
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('year=');
    expect(calledUrl).toContain('month=');
  });
});

// ─── getMarketRegime ──────────────────────────────────────────────────────────

describe('getMarketRegime', () => {
  it('returns regime data unchanged', async () => {
    const payload = {
      regime: {
        regime: 'bull',
        label: 'Bullish',
        confidence: 0.85,
        vix_level: 15.2,
        description: 'Strong uptrend',
        indicators: { rsi: 65 },
      },
      as_of: '2026-04-10T12:00:00Z',
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getMarketRegime();
    expect(result.regime.regime).toBe('bull');
    expect(result.regime.confidence).toBe(0.85);
    expect(result.as_of).toBe('2026-04-10T12:00:00Z');
  });
});

// ─── getMarketSectors ─────────────────────────────────────────────────────────

describe('getMarketSectors', () => {
  it('returns sectors data unchanged', async () => {
    const payload = {
      sectors: [
        { sector: 'Technology', change_pct: 1.5, ytd_pct: 12.3, leader: 'NVDA', leader_change_pct: 3.5 },
      ],
      as_of: '2026-04-10T12:00:00Z',
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getMarketSectors();
    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].sector).toBe('Technology');
    expect(result.as_of).toBe('2026-04-10T12:00:00Z');
  });
});

// ─── getMarketNews ────────────────────────────────────────────────────────────

describe('getMarketNews', () => {
  it('unwraps articles from response', async () => {
    const payload = {
      articles: [
        { title: 'Fed holds rates', source: 'Reuters', published_at: '2026-04-10T10:00:00Z', url: 'https://reuters.com/1' },
        { title: 'NVDA beats earnings', source: 'Bloomberg', published_at: '2026-04-10T09:00:00Z', url: 'https://bloomberg.com/2' },
      ],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getMarketNews();
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Fed holds rates');
    expect(result[1].source).toBe('Bloomberg');
  });
});

// ─── chatWithAgent ────────────────────────────────────────────────────────────

describe('chatWithAgent', () => {
  it('sends POST with message and context', async () => {
    const payload = {
      conversation_id: 'conv-1',
      message: 'AAPL is bullish.',
      actions_taken: [],
      suggestions: ['Review technicals'],
      timestamp: '2026-04-10T10:00:00Z',
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await chatWithAgent('What about AAPL?', 'AAPL', 'dashboard');
    expect(result.conversation_id).toBe('conv-1');
    expect(result.suggestions).toHaveLength(1);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.message).toBe('What about AAPL?');
    expect(body.context.symbol).toBe('AAPL');
    expect(body.context.extra).toBe('dashboard');
  });

  it('sends without symbol/context when omitted', async () => {
    mockFetch.mockReturnValueOnce(ok({ conversation_id: 'conv-2', message: 'OK', actions_taken: [], suggestions: [], timestamp: '' }));
    await chatWithAgent('Hello');
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.context.symbol).toBeUndefined();
    expect(body.context.extra).toBeUndefined();
  });
});

// ─── getPipelineStatus ────────────────────────────────────────────────────────

describe('getPipelineStatus', () => {
  it('returns pipeline status directly', async () => {
    const payload = { running: false, last_run: '2026-04-10T18:00:00Z', last_result: 'success' };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelineStatus();
    expect(result.running).toBe(false);
    expect(result.last_run).toBe('2026-04-10T18:00:00Z');
  });
});

// ─── getPipelineRun ───────────────────────────────────────────────────────────

describe('getPipelineRun', () => {
  it('fetches and maps a pipeline run by date', async () => {
    const payload = {
      date: '2026-04-10',
      timestamp: '2026-04-10T18:00:00Z',
      screened: [{ symbol: 'NVDA', name: 'NVIDIA', price: 820, composite_score: 0.9, sector: 'Tech', change_pct: 2 }],
      analyzed: [],
      signals: [],
      orders_placed: [],
      orders_closed: [],
      portfolio_snapshot: { equity: 110000, cash: 90000, positions: 2 },
      errors: [],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelineRun('2026-04-10');
    expect(result.date).toBe('2026-04-10');
    expect(result.screened[0].symbol).toBe('NVDA');
    expect(result.portfolioSnapshot.equity).toBe(110000);
  });

  it('includes the date in the request URL', async () => {
    mockFetch.mockReturnValueOnce(ok({ date: '2026-04-09', timestamp: '', screened: [], analyzed: [], signals: [], orders_placed: [], orders_closed: [], portfolio_snapshot: { equity: 0, cash: 0, positions: 0 }, errors: [] }));
    await getPipelineRun('2026-04-09');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('2026-04-09');
  });
});

// ─── getPipelinePositions ─────────────────────────────────────────────────────

describe('getPipelinePositions', () => {
  it('maps open_positions and performance', async () => {
    const payload = {
      open_positions: [
        {
          symbol: 'NVDA', shares: 5, entry_price: 800, current_price: 850,
          pnl: 250, pnl_pct: 6.25, stop_loss: 760, take_profit: 950,
          entry_time: '2026-04-01T09:30:00Z', signal: 'buy', rationale: 'Breakout',
        },
      ],
      performance: {
        total_trades: 20, open_positions: 1, total_pnl: 1500, win_rate: 65,
        avg_pnl_pct: 3.2,
        best_trade: { symbol: 'NVDA', pnl: 500 },
        worst_trade: { symbol: 'TSLA', pnl: -200 },
      },
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelinePositions();
    expect(result.positions).toHaveLength(1);
    const pos = result.positions[0];
    expect(pos.symbol).toBe('NVDA');
    expect(pos.shares).toBe(5);
    expect(pos.entryPrice).toBe(800);
    expect(pos.currentPrice).toBe(850);
    expect(pos.pnl).toBe(250);
    expect(pos.pnlPct).toBe(6.25);
    expect(pos.stopLoss).toBe(760);
    expect(pos.takeProfit).toBe(950);
    expect(pos.entryDate).toBe('2026-04-01T09:30:00Z');
    expect(pos.signal).toBe('buy');
    expect(pos.rationale).toBe('Breakout');

    const perf = result.performance;
    expect(perf.totalTrades).toBe(20);
    expect(perf.openPositions).toBe(1);
    expect(perf.totalPnl).toBe(1500);
    expect(perf.winRate).toBe(65);
    expect(perf.avgPnlPct).toBe(3.2);
    expect(perf.bestTrade).toEqual({ symbol: 'NVDA', pnl: 500 });
    expect(perf.worstTrade).toEqual({ symbol: 'TSLA', pnl: -200 });
  });

  it('falls back to qty when shares is missing', async () => {
    const payload = {
      open_positions: [{ symbol: 'AAPL', qty: 3, entry_price: 170, current_price: 175, pnl: 15, pnl_pct: 2.9, entry_time: '2026-04-02', signal: 'buy', rationale: '' }],
      performance: {},
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelinePositions();
    expect(result.positions[0].shares).toBe(3);
  });

  it('handles null best_trade and worst_trade', async () => {
    const payload = {
      open_positions: [],
      performance: { total_trades: 0, open_positions: 0, total_pnl: 0, win_rate: 0, avg_pnl_pct: 0, best_trade: null, worst_trade: null },
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelinePositions();
    expect(result.performance.bestTrade).toBeNull();
    expect(result.performance.worstTrade).toBeNull();
  });

  it('handles missing performance fields with 0 defaults', async () => {
    const payload = { open_positions: [], performance: {} };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelinePositions();
    expect(result.performance.totalTrades).toBe(0);
    expect(result.performance.winRate).toBe(0);
    expect(result.performance.bestTrade).toBeNull();
  });
});

// ─── getAnalysis ─────────────────────────────────────────────────────────────

describe('getAnalysis', () => {
  it('returns analysis data unchanged for a symbol', async () => {
    const payload = {
      symbol: 'AAPL',
      technicalScore: 78,
      fundamentalScore: 65,
      sentimentScore: 70,
      composite: 71,
      summary: 'Mildly bullish',
      signals: [],
    };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getAnalysis('AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.composite).toBe(71);
  });

  it('includes symbol in the request URL', async () => {
    mockFetch.mockReturnValueOnce(ok({ symbol: 'MSFT', technicalScore: 0, fundamentalScore: 0, sentimentScore: 0, composite: 0, summary: '', signals: [] }));
    await getAnalysis('MSFT');
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/analysis/MSFT');
  });
});

// ─── triggerPipeline ─────────────────────────────────────────────────────────

describe('triggerPipeline', () => {
  it('calls POST and returns the async run acknowledgement', async () => {
    // Persona-7 #2 P0: POST /pipeline/run is 202 Accepted with
    // ``{run_id, status}`` — the old synchronous ``{ok, result}`` shape
    // was removed from the backend.
    const payload = { run_id: 'run-2026-04-10-xyz', status: 'started' as const };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await triggerPipeline();
    expect(result.run_id).toBe('run-2026-04-10-xyz');
    expect(result.status).toBe('started');

    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/pipeline/run');
    expect(init.method).toBe('POST');
  });
});

// ─── getPipelineHistory ───────────────────────────────────────────────────────

describe('getPipelineHistory', () => {
  it('returns history array unchanged', async () => {
    const payload = [
      { date: '2026-04-09', run_id: 'run-1', status: 'success' },
      { date: '2026-04-08', run_id: 'run-2', status: 'success' },
    ];
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await getPipelineHistory();
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-04-09');
    expect(result[1].run_id).toBe('run-2');
  });

  it('calls the correct endpoint', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getPipelineHistory();
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/pipeline/history');
  });
});

// ─── apiFetch error handling ──────────────────────────────────────────────────

describe('apiFetch error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Something went wrong',
    }));

    await expect(getStrategies()).rejects.toThrow('API 500');
  });

  it('throws on 401 with "Session expired" when not on /login', async () => {
    // First call: the actual API request → 401
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '',
      json: async () => ({}),
    }));
    // Second call: the fire-and-forget logout POST that apiFetch triggers
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: true, status: 200, json: async () => ({}), text: async () => '',
    }));

    await expect(getStrategies()).rejects.toThrow('Session expired');
  });

  it('does not attach an Authorization header (HttpOnly cookie rides via credentials: include)', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getStrategies();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('includes Content-Type: application/json header', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getStrategies();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('uses credentials: include', async () => {
    mockFetch.mockReturnValueOnce(ok([]));
    await getStrategies();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.credentials).toBe('include');
  });
});
