// ─── Market Data ──────────────────────────────────────────────

export interface Quote {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
  timestamp: number;
}

export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Portfolio ────────────────────────────────────────────────

export interface PositionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  marketValue: number;
  side?: "long" | "short";
  sector?: string;
  greeks?: PositionGreeks;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
// Backend emits the full enum from ``backend/api/routes/trades.py:OrderStatus``:
// ``pending | submitted | open | filled | partial_fill | cancelled | rejected``.
// "submitted" / "partial_fill" were missing from the FE union, so any
// widget narrowing on ``status`` (notification toasts, orders table chip)
// crashed the exhaustive-check branch and rendered the raw string.
export type OrderStatus =
  | "pending"
  | "submitted"
  | "open"
  | "filled"
  | "partial"
  | "partial_fill"
  | "cancelled"
  | "rejected";

export interface OrderLeg {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price?: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  status: OrderStatus;
  legs?: OrderLeg[];
  filledAt?: string;
  createdAt: string;
}

export interface PortfolioSummary {
  equity: number;
  cash: number;
  buyingPower: number;
  totalMarketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnlToday: number;
  positionsCount: number;
  dayPnl: number;
  dayPnlPct: number;
  is_demo?: boolean;
}

export interface PortfolioGreeks {
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  betaWeightedDelta: number;
}

// ─── Options ──────────────────────────────────────────────────

export interface OptionsContract {
  symbol: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  bid: number;
  ask: number;
  last: number;
  volume: number;
  oi: number;
  iv: number;
  delta: number;
  /**
   * Greeks from the live chain. Nullable — when the data provider does not
   * emit a greek for a contract we carry `null` through. Callers must render
   * an em-dash rather than a hardcoded constant (audit P0-5).
   */
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface OptionsChain {
  symbol: string;
  expirations: string[];
  calls: OptionsContract[];
  puts: OptionsContract[];
}

// ─── Analysis ─────────────────────────────────────────────────

export type SignalType = "bullish" | "bearish" | "neutral";

export interface Signal {
  name: string;
  type: SignalType;
  description: string;
  strength: number;
}

/**
 * Live technical indicators returned by the backend analysis pipeline
 * (`backend/api/routes/analysis.py::_compute_technicals`). Any field may be
 * missing when the symbol has insufficient bar history — callers must render
 * an em-dash rather than substituting a derivation.
 */
export interface AnalysisTechnicals {
  rsi_14?: number | null;
  ema_20?: number | null;
  ema_50?: number | null;
  atr_14?: number | null;
  support?: number | null;
  resistance?: number | null;
  trend?: "bullish" | "bearish" | "neutral" | null;
  macd_signal?: "bullish" | "bearish" | "neutral" | null;
  volume_ratio?: number | null;
  volume_trend?: "above_average" | "below_average" | "average" | null;
}

export interface Analysis {
  symbol: string;
  technicalScore: number;
  fundamentalScore: number;
  sentimentScore: number;
  composite: number;
  summary: string;
  signals: Signal[];
  /** Live technicals from `_compute_technicals`. Optional — may be absent. */
  technicals?: AnalysisTechnicals;
}

// ─── Screener ─────────────────────────────────────────────────

export interface ScreenerResult {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  rsScore: number;
  fScore: number;
  ivRank: number;
  ivPctl: number;
  mlScore: number;
  composite: number;
  sector: string;
}

// ─── Agent / Chat ─────────────────────────────────────────────

export type AgentType = "technical" | "fundamental" | "sentiment" | "risk" | "orchestrator";

export interface AgentMessage {
  agent: AgentType;
  type: "analysis" | "alert" | "chat" | "status";
  content: string;
  timestamp: number;
}

// ─── Alerts ───────────────────────────────────────────────────

export type AlertType = "price" | "signal" | "order" | "system" | "agent";

export interface Alert {
  id: string;
  type: AlertType;
  message: string;
  symbol?: string;
  time: number;
  acknowledged: boolean;
}

// ─── UI ───────────────────────────────────────────────────────

export type PanelId = "watchlist" | "chart" | "analysis" | "options" | "trade";
export type TimeFrame = "1m" | "5m" | "15m" | "1H" | "4H" | "D" | "W" | "M";
export type ChartType = "candle" | "line" | "area";
export type Indicator = "EMA" | "SMA" | "Bollinger" | "RSI" | "MACD" | "Volume" | "VWAP" | "Stochastic" | "ATR";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── Custom Events ──────────────────────────────────────────

export interface QuickOrderEvent {
  symbol: string;
  side: "buy" | "sell";
  price: number;
}

// ─── Earnings Options Play ───────────────────────────────────

export type EarningsReportTime = "BMO" | "AMC" | "DMT";
export type EarningsVerdict = "bullish" | "neutral-bull" | "neutral" | "neutral-bear" | "bearish";
export type EarningsTopSetup = "short call" | "cash-secured put" | "short strangle" | "iron condor";
export type EarningsOptionSide = "call" | "put";
export type EarningsBucket = "15Δ" | "30Δ" | "ATM";

export interface CalendarRow {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  days_until: number;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  iv_rank: number | null;
  premium_yield_call_atm: number | null;
  premium_yield_put_atm: number | null;
  expected_move_pct: number | null;
  hist_avg_abs_move_pct: number | null;
  claude_verdict: EarningsVerdict | null;
  claude_confidence: number | null;
  top_setup: EarningsTopSetup | null;
}

export interface CalendarResponse {
  earnings: CalendarRow[];
  generated_at: string;
  partial: boolean;
  error?: string | null;
}

export interface LadderRow {
  strike: number;
  side: EarningsOptionSide;
  bucket: EarningsBucket;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  yield_pct: number;
  pop: number;
  theta: number;
  gamma: number;
  vega: number;
  oi: number;
  volume: number;
}

export interface StrikeLadder {
  expiry: string;
  underlying_price: number;
  rows: LadderRow[];
}

export interface ClaudeStructured {
  verdict: EarningsVerdict;
  direction_magnitude: { bull_case_pct: number; bear_case_pct: number };
  thesis: string;
  catalysts: string[];
  risks: string[];
  suggested_play: EarningsTopSetup;
  suggested_play_reason: string;
  confidence: number;
  model: string;
  generated_at: string;
}

export interface ComparableSetup {
  report_date: string;
  iv_rank: number;
  setup: string;
  outcome: string;
  similarity_score: number;
}

export interface ClaudeFullResearch {
  thesis_paragraph: string;
  comparable_setups: ComparableSetup[];
  post_earnings_drift_playbook: string;
  sector_backdrop: string;
  analyst_consensus_delta: string;
  what_would_change_my_mind: string;
  confidence: number;
  model: string;
  generated_at: string;
}

export interface HistQuarter {
  report_date: string;
  surprise_pct: number | null;
  next_day_move_pct: number;
  five_day_move_pct: number;
}

export interface HistoricalStats {
  avg_abs_move_pct: number;
  wins: number;
  losses: number;
  surprise_beat_rate: number;
  iv_vs_hist_vol_points: number | null;
}

export interface HistoricalBlock {
  quarters: HistQuarter[];
  stats: HistoricalStats;
}

export interface IVTermPoint {
  expiry: string;
  dte: number;
  atm_iv: number;
}

export interface SkewBlock {
  put_iv_25d: number | null;
  call_iv_25d: number | null;
  skew_points: number | null;
  interpretation: "put-heavy skew" | "call-heavy skew" | "neutral" | null;
}

export interface EarningsMetricsBlock {
  iv_rank: number | null;
  iv_percentile: number | null;
  current_iv: number | null;
  hv_20: number | null;
  hv_50: number | null;
  hv_100: number | null;
  hv_iv_ratio: number | null;
  expected_move_pct: number | null;
  expected_move_dollars: number | null;
  hist_avg_abs_move_pct: number | null;
  beat_rate: number | null;
  days_to_earnings: number | null;
  days_to_expiry: number | null;
}

export interface EarningsNewsArticle {
  title: string;
  source: string;
  published_at: string;
  url: string;
}

export interface EarningsDetail {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  quote: { last: number; change: number; change_pct: number } | null;
  metrics: EarningsMetricsBlock | null;
  strike_ladder: StrikeLadder | null;
  claude_structured: ClaudeStructured | null;
  claude_full_research: ClaudeFullResearch | null;
  historical_earnings: HistoricalBlock | null;
  iv_term_structure: IVTermPoint[] | null;
  skew: SkewBlock | null;
  news: EarningsNewsArticle[];
  partial: boolean;
  generated_at: string;
}

export interface EarningsCalendarFilters {
  window?: "current" | "next" | "both";
  min_iv_rank?: number;
  market_cap?: "mega" | "large" | "mid" | "small" | "all";
  bmo_amc?: "bmo" | "amc" | "both";
  watchlist_only?: boolean;
  sort?: "date" | "iv_rank" | "yield" | "claude_confidence";
}

// ─── Strategy SOTA Foundation types ───────────────────────────
// Mirror of backend/strategies/_core/contracts.py — keep in sync when
// backend contracts evolve. These are the shapes a BacktestRunner /
// SignalRunner returns; the existing `Signal` above (analysis UI) is
// unrelated and must not be renamed.

export type CoreOrderType =
  | "MKT"
  | "LMT"
  | "STP"
  | "STP_LMT"
  | "MOO"
  | "MOC";

export type CoreTimeInForce = "DAY" | "GTC" | "IOC" | "FOK";

export type OptionSide = "buy" | "sell";

export type StrategyKind = "autonomous" | "research";

export type StrategyCategory =
  | "equity"
  | "options"
  | "pairs"
  | "macro"
  | "intraday"
  | "smoke";

/** One leg of a multi-leg options order. */
export interface OptionLeg {
  occSymbol: string;              // OCC option symbol, e.g. NVDA260425C00205000
  side: OptionSide;
  quantity: number;
  limitPrice?: number | null;
}

/**
 * An order intent emitted by a backend strategy on a single bar.
 * Named `OrderSignal` to avoid clashing with the existing analysis-UI
 * `Signal` type above.
 */
export interface OrderSignal {
  symbol: string;
  asof: string;                   // ISO date
  orderType: CoreOrderType;
  timeInForce: CoreTimeInForce;
  targetWeight?: number | null;
  quantity?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  tag?: string;
  legs?: OptionLeg[] | null;
}

/** Reproducibility metadata stamped on every BacktestResult. */
export interface ReproMeta {
  gitSha: string;
  paramHash: string;
  snapshotRoot: string;
  seed: number;
  runAt: string;                  // ISO datetime
  strategyName: string;
  runnerVersion: string;
}

/** One closed round-trip trade (or an open position at backtest end). */
export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate?: string | null;
  entryPrice: string;             // Decimal serialised as string
  exitPrice?: string | null;
  quantity: number;
  pnl?: string | null;
  tag?: string;
}

/** Aggregated result of a BacktestRunner.run(). */
export interface BacktestResult {
  equityCurve: Array<{
    date: string;
    cash: number;
    positionsValue?: number;
    equity: number;
    drawdown: number;
  }>;
  dailyReturns: Array<{ date: string; value: number }>;
  trades: BacktestTrade[];
  signalsEmitted: OrderSignal[];
  metrics: Record<string, number>;
  params: Record<string, unknown>;
  start: string;
  end: string;
  repro: ReproMeta;
  warningsByAsof: Record<string, string[]>;
}

/** Strategy metadata surfaced from the _core.protocol registry. */
export interface StrategyMetaInfo {
  name: string;
  category: StrategyCategory;
  description: string;
  kind: StrategyKind;
  lookbackDays: number;
  requiredBars: string[];
  minUniverseSize: number;
  paperOnly: boolean;
}
