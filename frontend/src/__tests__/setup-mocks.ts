/**
 * Shared mocks for component render tests.
 * Import this at the top of any component test that needs store/navigation/chart mocking.
 */
import { vi } from 'vitest';

// ─── Next.js Navigation ────────────────────────────────────
export const mockPush = vi.fn();
export const mockBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(globalThis.window?.location?.search ?? ''),
  useParams: () => ({ id: 'pead' }),
}));

// ─── Lightweight Charts ────────────────────────────────────
// v5 switched from `chart.addCandlestickSeries()` to
// `chart.addSeries(CandlestickSeries, options)`. The markers
// (CandlestickSeries / LineSeries / AreaSeries / HistogramSeries) are
// exported as module-level tokens — tests need them present or imports
// crash with "No X export is defined" the moment a new file pulls any
// of them in. Keeping the old `addXxxSeries` shims too so we don't have
// to touch callers that predate the v5 migration.
const _seriesStub = () => ({
  setData: vi.fn(),
  update: vi.fn(),
  createPriceLine: vi.fn(),
  removePriceLine: vi.fn(),
  applyOptions: vi.fn(),
  priceScale: () => ({ applyOptions: vi.fn() }),
  attachPrimitive: vi.fn(),
  detachPrimitive: vi.fn(),
  priceToCoordinate: vi.fn(() => 0),
});
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => _seriesStub(),
    addCandlestickSeries: () => _seriesStub(),
    addLineSeries: () => _seriesStub(),
    addAreaSeries: () => _seriesStub(),
    addHistogramSeries: () => _seriesStub(),
    timeScale: () => ({
      fitContent: vi.fn(),
      scrollToRealTime: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      timeToCoordinate: vi.fn(() => 0),
    }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  }),
  // v5 series markers — identity sentinels is enough for a mock.
  CandlestickSeries: 'CandlestickSeries',
  LineSeries: 'LineSeries',
  AreaSeries: 'AreaSeries',
  HistogramSeries: 'HistogramSeries',
  BaselineSeries: 'BaselineSeries',
  BarSeries: 'BarSeries',
  ColorType: { Solid: 'Solid', VerticalGradient: 'VerticalGradient' },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  CrosshairMode: { Normal: 0, Magnet: 1 },
  // createSeriesMarkers — used by TradingChart for event/order pins.
  createSeriesMarkers: vi.fn(() => ({
    setMarkers: vi.fn(),
    detach: vi.fn(),
  })),
}));

// ─── WebSocket Provider ────────────────────────────────────
vi.mock('@/lib/providers', () => ({
  useWs: () => ({ isConnected: true, subscribe: vi.fn(), unsubscribe: vi.fn() }),
  Providers: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── API Functions ─────────────────────────────────────────
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getPositions: vi.fn().mockResolvedValue([]),
    getPipelinePositions: vi.fn().mockResolvedValue({ positions: [], performance: {} }),
    getPortfolioSummary: vi.fn().mockResolvedValue({ equity: 100000, cash: 95000, buying_power: 200000, total_market_value: 5000, unrealized_pnl: 0, unrealized_pnl_pct: 0, realized_pnl_today: 0, positions_count: 0 }),
    getQuote: vi.fn().mockResolvedValue({ symbol: 'SPY', last: 679, bid: 678.9, ask: 679.1, volume: 1000000, high: 680, low: 678, open: 679, close: 679, change: 0, changePct: 0, timestamp: Date.now() }),
    getBars: vi.fn().mockResolvedValue([]),
    getMarketRegime: vi.fn().mockResolvedValue({ regime: { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16.5, description: 'test' } }),
    getMarketIndices: vi.fn().mockResolvedValue({ indices: [] }),
    getMarketSectors: vi.fn().mockResolvedValue({ sectors: [] }),
    getMarketNews: vi.fn().mockResolvedValue([]),
    getStrategies: vi.fn().mockResolvedValue([]),
    getStrategyCatalog: vi.fn().mockResolvedValue([]),
    getStrategyPerformance: vi.fn().mockResolvedValue({ name: 'Test', description: '', status: 'active', invested_amount: 0, current_value: 0, total_return_pct: 0, annualized_return_pct: 0, return_dollars: 0, win_rate: -1, sharpe_ratio: 0, max_drawdown: 0, active_positions_count: 0, equity_curve: [], last_trade_date: '' }),
    getStrategyTrades: vi.fn().mockResolvedValue([]),
    getStrategyAnalytics: vi.fn().mockResolvedValue(null),
    toggleStrategy: vi.fn().mockResolvedValue({ strategy_id: 'pead', new_status: 'paused' }),
    getPipelineStatus: vi.fn().mockResolvedValue({ running: false, lastRun: null, lastResult: null }),
    getPipelineHistory: vi.fn().mockResolvedValue([]),
    getPnlCalendar: vi.fn().mockResolvedValue({ days: [], monthTotal: 0, month: 4, year: 2026, tradingDays: 0, winningDays: 0, losingDays: 0, bestDay: null, worstDay: null }),
    getOptionsChain: vi.fn().mockResolvedValue({ symbol: 'SPY', expirations: [], calls: [], puts: [] }),
    getIVData: vi.fn().mockResolvedValue({ ivRank: 50, ivPctl: 55, currentIV: 0.2, hvRatio: 1 }),
    analyzeSymbol: vi.fn().mockResolvedValue({ symbol: 'SPY', technicalScore: 50, fundamentalScore: 50, sentimentScore: 0, composite: 50, summary: 'Test', signals: [] }),
    getAnalysis: vi.fn().mockResolvedValue(null),
    screenStocks: vi.fn().mockResolvedValue([]),
    searchSymbols: vi.fn().mockResolvedValue([]),
    chatWithAgent: vi.fn().mockResolvedValue({ message: 'Test response', actions_taken: [], suggestions: [], conversation_id: '1', timestamp: '' }),
    placeOrder: vi.fn().mockResolvedValue({ id: '1', symbol: 'SPY', side: 'buy', type: 'market', quantity: 10, status: 'filled', createdAt: '' }),
    getOrders: vi.fn().mockResolvedValue([]),
    cancelOrder: vi.fn().mockResolvedValue({ success: true }),
    getEarningsCalendar: vi.fn().mockResolvedValue({
      earnings: [],
      generatedAt: new Date().toISOString(),
      partial: false,
      // Round-4: window-honesty fields. Safely defaulted so any test
      // that reads `calendar.windowLabel` gets a stable string instead
      // of undefined.
      windowStart: "2026-04-20",
      windowEnd: "2026-04-24",
      windowLabel: "Apr 20 – Apr 24, 2026",
      meta: { reason: "ok" as const },
    }),
    getEarningsDetail: vi.fn().mockResolvedValue({
      symbol: "NVDA", company: "Nvidia", sector: "Semis",
      reportDate: "2026-04-23", reportTime: "AMC",
      quote: null, metrics: null, strikeLadder: null,
      claudeStructured: null, claudeFullResearch: null,
      ivTermStructure: null, skew: null,
      news: [], partial: false,
      // Round-4: degraded-path codes. Empty array on the happy path.
      errorCodes: [],
      generatedAt: new Date().toISOString(),
    }),
    postEarningsFullResearch: vi.fn().mockResolvedValue({
      thesisParagraph: "mock research",
      comparableSetups: [],
      postEarningsDriftPlaybook: "",
      sectorBackdrop: "",
      analystConsensusDelta: "",
      whatWouldChangeMyMind: "",
      confidence: 0.5,
      model: "claude-opus-4-7",
      generatedAt: new Date().toISOString(),
    }),
    postEarningsBacktest: vi.fn().mockResolvedValue({
      trades: [],
      skipped: [],
      metrics: {
        events: 0,
        winRate: 0,
        avgTradeReturnPct: 0,
        totalReturnPct: 0,
        maxDrawdownPct: 0,
        profitFactor: null,
      },
    }),
  };
});

// ─── Toast Hook ────────────────────────────────────────────
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

// ─── ResizeObserver (not in jsdom) ─────────────────────────
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
