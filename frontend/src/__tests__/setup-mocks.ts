/**
 * Shared mocks for component render tests.
 * Import this at the top of any component test that needs store/navigation/chart mocking.
 */
import { vi } from 'vitest';

// ─── Next.js Navigation ────────────────────────────────────
export const mockPush = vi.fn();
export const mockBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: vi.fn() }),
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
      subscribeVisibleLogicalRangeChange: vi.fn(),
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
    // R6-5 follow-up: getSnapshot powers the multi-leg leg-readiness gate
    // on /trade. Default to a permissive happy-path that resolves every
    // requested OCC to a synthetic quote so existing tests that exercise
    // the submit path don't trip the new "leg quote missing" blocker.
    // Tests that want to simulate a leg outage can override per-test.
    getSnapshot: vi.fn().mockImplementation(async (symbols: string[]) => {
      const out: Record<string, unknown> = {};
      for (const s of symbols) {
        out[s] = {
          symbol: s,
          last: 1.45,
          bid: 1.4,
          ask: 1.5,
          volume: 100,
          high: 1.5,
          low: 1.4,
          open: 1.45,
          close: 1.45,
          change: 0,
          changePct: 0,
          timestamp: Date.now(),
        };
      }
      return out;
    }),
    // P1-19 BL-1.1: /trade now calls the batched getSnapshots helper for
    // option leg quotes (one upstream request per page-load instead of N
    // per-OCC). Mirror getSnapshot's permissive happy-path so the same
    // submit flow tests pass without per-test fixtures.
    getSnapshots: vi.fn().mockImplementation(async (symbols: string[]) => {
      const out: Record<string, unknown> = {};
      for (const s of symbols) {
        out[s] = {
          symbol: s,
          last: 1.45,
          bid: 1.4,
          ask: 1.5,
          volume: 100,
          high: 1.5,
          low: 1.4,
          open: 1.45,
          close: 1.45,
          change: 0,
          changePct: 0,
          timestamp: Date.now(),
        };
      }
      return out;
    }),
    getMarketDepth: vi.fn().mockResolvedValue({ symbol: 'SPY', kind: 'top_of_book', provider: 'test', bids: [{ price: 678.9, size: 100 }], asks: [{ price: 679.1, size: 100 }], timestamp: Date.now(), isL2: false, isDemo: false, notes: [] }),
    getMarketDepthCapabilities: vi.fn().mockResolvedValue({ activeKind: 'top_of_book', trueL2Available: false, providers: [], notes: [] }),
    getBars: vi.fn().mockResolvedValue([]),
    getMarketRegime: vi.fn().mockResolvedValue({ regime: { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16.5, description: 'test' } }),
    getMarketIndices: vi.fn().mockResolvedValue({ indices: [] }),
    getMarketSectors: vi.fn().mockResolvedValue({ sectors: [] }),
    // Holiday-aware market status (audit edge-cases-r3 §A P1). The default
    // mock matches "regular session, market open" — the dominant happy
    // path. Tests that need to exercise the holiday branch override this
    // per-test.
    getMarketStatus: vi.fn().mockResolvedValue({
      isOpen: true,
      market: 'open',
      exchanges: { nyse: 'open', nasdaq: 'open' },
      serverTime: new Date().toISOString(),
      isDemo: false,
    }),
    getMarketNews: vi.fn().mockResolvedValue([]),
    getMorningBrief: vi.fn().mockResolvedValue(null),
    getNotifications: vi.fn().mockResolvedValue([]),
    // Iter 22: mark-as-read mutations. AlertsPage calls these from
    // the per-row "Mark read" button and the header "Mark all read"
    // button. Backend returns 204 (void) on success.
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
    // Iter 24: AlertsPage now reads /api/v1/user/me to branch the empty
    // state on `is_demo_seed`. Default to a real-operator profile so the
    // pre-existing alerts/notifications tests don't accidentally hit the
    // demo-seed branch. Tests that need the demo-seed branch override
    // via vi.mocked(getCurrentUser).mockResolvedValue or pre-seed the
    // React Query cache directly.
    getCurrentUser: vi.fn().mockResolvedValue({
      username: 'operator',
      role: 'user',
      is_demo_seed: false,
    }),
    getTickerFundamentals: vi.fn().mockResolvedValue({
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      sector: 'ETF',
      industry: 'Exchange Traded Fund',
      marketCap: null,
      peRatio: null,
      avgVolume30d: 1000000,
    }),
    getTickerContext: vi.fn().mockResolvedValue({
      symbols: {
        SPY: {
          symbol: 'SPY',
          quote: {
            value: {
              symbol: 'SPY',
              last: 679,
              bid: 678.9,
              ask: 679.1,
              volume: 1000000,
              changePct: 0,
              timestamp: Date.now(),
            },
          },
          optionsSummary: { value: null },
        },
      },
    }),
    getUserWatchlist: vi.fn().mockResolvedValue({ symbols: [] }),
    getWatchlistsV2: vi.fn().mockResolvedValue([]),
    getEnrichedWatchlist: vi.fn().mockResolvedValue({ items: [] }),
    getPriceAlerts: vi.fn().mockResolvedValue([]),
    getStrategies: vi.fn().mockResolvedValue([]),
    getStrategyCatalog: vi.fn().mockResolvedValue([]),
    getStrategyPerformance: vi.fn().mockResolvedValue({ name: 'Test', description: '', status: 'active', invested_amount: 0, current_value: 0, total_return_pct: 0, annualized_return_pct: 0, return_dollars: 0, win_rate: -1, sharpe_ratio: 0, max_drawdown: 0, active_positions_count: 0, equity_curve: [], last_trade_date: '' }),
    getStrategyAnalytics: vi.fn().mockResolvedValue(null),
    getStrategyPositions: vi.fn().mockResolvedValue([]),
    getRiskDashboard: vi.fn().mockResolvedValue(null),
    getRiskVar: vi.fn().mockResolvedValue(null),
    getRiskCorrelation: vi.fn().mockResolvedValue(null),
    getRiskDrawdown: vi.fn().mockResolvedValue(null),
    getRiskExposure: vi.fn().mockResolvedValue(null),
    getRiskCrowding: vi.fn().mockResolvedValue(null),
    getAdminBackendKeys: vi.fn().mockResolvedValue([]),
    getLayoutConfig: vi.fn().mockResolvedValue(null),
    getLastDeploy: vi.fn().mockResolvedValue(null),
    addWatchlistItem: vi.fn().mockResolvedValue({ ok: true }),
    createWatchlistV2: vi.fn().mockResolvedValue({ id: 'watchlist-test' }),
    getStrategyTrades: vi.fn().mockResolvedValue([]),
    startTradingAgentsRun: vi.fn().mockResolvedValue({
      run_id: 'abc123abc123abc123abc123',
      symbol: 'AAPL',
      trade_date: '2026-05-01',
      status: 'queued',
      provider: 'openai',
      deep_model: 'gpt-5.4',
      quick_model: 'gpt-5.4-mini',
      analysts: ['market', 'news'],
      research_depth: 1,
      progress_message: 'Queued for TradingAgents research.',
      timeout_s: 600,
      summary_lines: [],
      decision_text: null,
      artifact_files: [],
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      advisory_disclaimer: 'research only',
    }),
    getTradingAgentsRuntimeStatus: vi.fn().mockResolvedValue({
      enabled: true,
      ready: true,
      script_path: '/app/tools/tradingagents/scripts/run_tradingagents.sh',
      script_exists: true,
      script_runnable: true,
      skill_home: '/app/data/tradingagents-skill',
      runtime_python_exists: true,
      upstream_checkout_exists: true,
      installed_ref: 'v0.2.3',
      bootstrap_required: false,
      provider: 'anthropic',
      provider_env: 'ANTHROPIC_API_KEY',
      provider_key_configured: true,
      deep_model: 'claude-sonnet-4-6',
      quick_model: 'claude-haiku-4-5',
      supported_analysts: ['market', 'social', 'news', 'fundamentals'],
      output_language: 'English',
      timeout_s: 600,
      runs_per_hour: 12,
      history_limit: 20,
      warnings: [],
    }),
    getTradingAgentsRuns: vi.fn().mockResolvedValue([]),
    getTradingAgentsRun: vi.fn().mockResolvedValue(null),
    getUserTradingMode: vi.fn().mockResolvedValue({ mode: "paper" }),
    commitUserTradingMode: vi.fn().mockImplementation(async (body: { mode: "paper" | "live" }) => ({ mode: body.mode })),
    toggleStrategy: vi.fn().mockResolvedValue({ strategy_id: 'pead', new_status: 'paused' }),
    getPipelineStatus: vi.fn().mockResolvedValue({ running: false, lastRun: null, lastResult: null }),
    getPipelineHistory: vi.fn().mockResolvedValue([]),
    getPnlCalendar: vi.fn().mockResolvedValue({ days: [], monthTotal: 0, month: 4, year: 2026, tradingDays: 0, winningDays: 0, losingDays: 0, bestDay: null, worstDay: null }),
    getOptionsChain: vi.fn().mockResolvedValue({ symbol: 'SPY', spotPrice: 679, expirations: [], calls: [], puts: [] }),
    getIVData: vi.fn().mockResolvedValue({ ivRank: 50, ivPctl: 55, currentIV: 0.2, hvRatio: 1 }),
    analyzeSymbol: vi.fn().mockResolvedValue({ symbol: 'SPY', technicalScore: 50, fundamentalScore: 50, sentimentScore: 0, composite: 50, summary: 'Test', signals: [] }),
    getAnalysis: vi.fn().mockResolvedValue(null),
    screenStocks: vi.fn().mockResolvedValue([]),
    searchSymbols: vi.fn().mockResolvedValue([]),
    chatWithAgent: vi.fn().mockResolvedValue({ message: 'Test response', actions_taken: [], suggestions: [], conversation_id: '1', timestamp: '' }),
    previewOrder: vi.fn().mockResolvedValue({
      review_id: 'review-test-token',
      can_submit: true,
      expires_at: new Date(Date.now() + 90_000).toISOString(),
      checks: [],
    }),
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
