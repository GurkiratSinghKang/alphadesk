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
  useParams: () => ({ id: 'pead' }),
}));

// ─── Lightweight Charts ────────────────────────────────────
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addCandlestickSeries: () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), removePriceLine: vi.fn() }),
    addLineSeries: () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), removePriceLine: vi.fn() }),
    addAreaSeries: () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), removePriceLine: vi.fn() }),
    addHistogramSeries: () => ({ setData: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn(), scrollToRealTime: vi.fn(), subscribeVisibleTimeRangeChange: vi.fn() }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  }),
  ColorType: { Solid: 'Solid', VerticalGradient: 'VerticalGradient' },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  CrosshairMode: { Normal: 0, Magnet: 1 },
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
