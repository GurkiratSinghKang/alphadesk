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

// Round-11 / Y-12: ``PositionGreeks`` removed alongside ``Position.greeks``
// — the backend never emitted per-position Greek dicts. Use
// ``PortfolioGreeks.byPosition`` for per-symbol attribution.

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  marketValue: number;
  side?: "long" | "short";
  sector?: string;
  // Round-11 / Y-12 (P3): backend ``PositionResponse`` (trades.py:512)
  // does not emit per-position Greeks. The previous ``greeks?:
  // PositionGreeks`` was always ``undefined``, so any consumer doing
  // ``position.greeks?.delta`` rendered a stale em-dash and any
  // truthy-check guard short-circuited silently. Use
  // ``getPortfolioGreeks().byPosition`` (Y-7) when per-position
  // attribution is needed.
  /**
   * Round-5 F-6 — originating strategy id (e.g. "earnings-options-play").
   * Null when the position was opened manually or before strategy
   * tagging existed. Surfaced on the /reports Current Positions table
   * so closed-trade attribution and open-position attribution agree.
   */
  strategy?: string | null;
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
  /**
   * Round-5 F-1 / F-13 — originating strategy id. Null on manual orders
   * placed before strategy threading existed. Backend returns this on
   * `OrderResponse.strategy` (see backend/api/routes/trades.py:398).
   */
  strategy?: string | null;
  /**
   * Round-11 / Y-10 (P2): backend ``OrderResponse.combo_type`` carries
   * the multi-leg shape (``"strangle"`` | ``"vertical_spread"`` |
   * ``"iron_condor"``). FE used to drop it, so multi-leg orders rendered
   * as a single leg in the recent-orders strip. Surface it.
   */
  comboType?: string | null;
  /**
   * Round-11 / Y-10: backend ``OrderResponse.reject_reason`` carries
   * the broker's free-text rejection message. Without it the UI shows
   * "rejected" with no operator-actionable detail.
   */
  rejectReason?: string | null;
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
  /**
   * Round-11 / Y-8 (P2): backend ``api/routes/portfolio.py:35-37``
   * emits ``last_updated`` (ISO datetime) and ``source`` ("alpaca"
   * | "demo") on every summary response. The FE used to drop both
   * — surface them so the dashboard header can render a "last
   * refreshed Xs ago" pill and so other consumers can detect
   * demo-mode without re-deriving from ``is_demo``.
   */
  lastUpdated?: string;
  source?: string;
}

export interface PortfolioGreeks {
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  betaWeightedDelta: number;
  /**
   * Round-11 / Y-7 (P2): backend computes per-position Greek
   * contributions (``api/routes/portfolio.py:75``). Surface the
   * array so the Greeks panel can show "by position" attribution
   * — backend already does the work; FE was discarding the field.
   */
  byPosition?: Array<{
    symbol: string;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  }>;
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
  /**
   * Round-11 / Y-9 (P1, regulatory): the BE
   * (``api/routes/analysis.py``) emits ``advisory_disclaimer`` on
   * every analyze response (Persona 67-5 explicitly required this).
   * The FE used to drop it. Recommendation panels must surface this
   * caveat. Field is optional so older BE responses don't crash
   * existing consumers; new code paths should expect a string.
   */
  disclaimer?: string;
  /**
   * Round-11 / Y-9: ``"live_disabled"`` means the strategy is
   * denylisted from real-capital orders; ``"paper_only"`` means
   * it can only paper-trade. Both should drive a visible chip on
   * the Analyze panel so a trader doesn't act on a recommendation
   * they can't fulfil through this terminal.
   */
  strategyLiveStatus?: "live_disabled" | "paper_only" | null;
}

// ─── Screener ─────────────────────────────────────────────────

export interface ScreenerResult {
  symbol: string;
  price: number;
  // Round-11 / Y-4 (P3): backend ``ScreenerResult`` only emits
  // ``change_pct`` — never the absolute dollar change. The FE used
  // to declare ``change: number`` and hard-code ``0`` in the mapper,
  // which the screener UI then rendered as a stale "$0.00" column.
  // Dropped: callers should display % only or derive from
  // ``price * changePct / (100 + changePct)`` if they really need $.
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

/**
 * Round-4 backend tags every calendar row with a state describing where
 * the report falls relative to "now" in the NY market date — drives the
 * UI's sticky/today highlights and per-row weekend filtering.
 */
export type EarningsReportState = "upcoming" | "today_pre" | "today_done" | "past";

export interface CalendarRow {
  symbol: string;
  company: string;
  sector: string;
  reportDate: string;
  reportTime: EarningsReportTime;
  daysUntil: number;
  price: number | null;
  change: number | null;
  changePct: number | null;
  ivRank: number | null;
  premiumYieldCallAtm: number | null;
  premiumYieldPutAtm: number | null;
  expectedMovePct: number | null;
  histAvgAbsMovePct: number | null;
  claudeVerdict: EarningsVerdict | null;
  claudeConfidence: number | null;
  topSetup: EarningsTopSetup | null;
  /** Round-4: state of this earnings report relative to today. Optional —
   *  older fixtures predating the field don't need to provide it. */
  reportState?: EarningsReportState;
}

/**
 * Round-4: backend now reports _why_ the calendar slice came back with
 * a particular shape so the UI can write copy that matches the actual
 * data condition (e.g. weekend-with-no-reports).
 */
export type CalendarMetaReason =
  | "ok"
  | "no_curated_matches"
  | "fmp_unavailable"
  | "weekend_no_reports";

export interface CalendarMeta {
  reason?: CalendarMetaReason;
  beforeCurated?: number;
}

export interface CalendarResponse {
  earnings: CalendarRow[];
  generatedAt: string;
  partial: boolean;
  error?: string | null;
  /**
   * Per-row Pydantic validation failures encountered during hydration.
   * Empty array is the happy path. Each entry is `{ symbol, error }`.
   * Optional on the wire (field is default_factory=list on the backend) so
   * older clients and test fixtures that pre-date the field don't need to
   * thread an empty array through every invocation.
   */
  validation_errors?: Array<{ symbol: string | null; error: string }>;
  /** Round-4: ISO date "YYYY-MM-DD" — start of the window in NY market
   *  date. Optional so older fixtures don't need to thread it. */
  windowStart?: string;
  /** Round-4: ISO date "YYYY-MM-DD" inclusive — end of the window. */
  windowEnd?: string;
  /** Round-4: backend-rendered label like "Apr 27 – May 1, 2026". */
  windowLabel?: string;
  /** Round-4: why we got this set of rows. Optional / partial — UI only
   *  reads it when present. */
  meta?: CalendarMeta;
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
  yieldPct: number;
  pop: number;
  theta: number;
  gamma: number;
  vega: number;
  oi: number;
  volume: number;
}

export interface StrikeLadder {
  expiry: string;
  underlyingPrice: number;
  rows: LadderRow[];
  /** Round-4: true when the chain is synthetic / demo data — UI surfaces
   *  a "DEMO DATA" badge in the StrikeLadder header. Optional so older
   *  fixtures don't need it. */
  isDemo?: boolean;
}

export interface ClaudeStructured {
  verdict: EarningsVerdict;
  directionMagnitude: { bullCasePct: number; bearCasePct: number };
  thesis: string;
  catalysts: string[];
  risks: string[];
  suggestedPlay: EarningsTopSetup;
  suggestedPlayReason: string;
  confidence: number;
  model: string;
  generatedAt: string;
}

export interface ComparableSetup {
  reportDate: string;
  ivRank: number;
  setup: string;
  outcome: string;
  similarityScore: number;
}

export interface ClaudeFullResearch {
  thesisParagraph: string;
  comparableSetups: ComparableSetup[];
  postEarningsDriftPlaybook: string;
  sectorBackdrop: string;
  analystConsensusDelta: string;
  whatWouldChangeMyMind: string;
  confidence: number;
  model: string;
  generatedAt: string;
}

export interface HistQuarter {
  reportDate: string;
  surprisePct: number | null;
  nextDayMovePct: number;
  fiveDayMovePct: number;
}

export interface HistoricalStats {
  avgAbsMovePct: number;
  wins: number;
  losses: number;
  surpriseBeatRate: number;
  ivVsHistVolPoints: number | null;
}

export interface HistoricalBlock {
  quarters: HistQuarter[];
  stats: HistoricalStats;
}

export interface IVTermPoint {
  expiry: string;
  dte: number;
  atmIv: number;
}

export interface SkewBlock {
  putIv25d: number | null;
  callIv25d: number | null;
  skewPoints: number | null;
  interpretation: "put-heavy skew" | "call-heavy skew" | "neutral" | null;
}

export interface EarningsMetricsBlock {
  ivRank: number | null;
  ivPercentile: number | null;
  currentIv: number | null;
  hv20: number | null;
  hv50: number | null;
  hv100: number | null;
  hvIvRatio: number | null;
  expectedMovePct: number | null;
  expectedMoveDollars: number | null;
  histAvgAbsMovePct: number | null;
  beatRate: number | null;
  daysToEarnings: number | null;
  daysToExpiry: number | null;
}

export interface EarningsNewsArticle {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
}

/**
 * Round-4: backend tags partial-data responses with an enumerated list
 * of degraded-path codes so the UI can surface a precise banner. Open
 * union — UI maps unknown codes to a generic message.
 *
 * Round-5 (NEW-Y8): backend now distinguishes a transient "news cooldown"
 * (`news_unavailable`) from a hard upstream error (`news_error`); also
 * surfaces `claude_unavailable` when the budget tripped, and
 * `iv_term_partial` when only some expiries returned. New codes added
 * verbatim — UI's ERROR_CODE_COPY map renders friendly labels;
 * unknown-but-string codes still pass through raw.
 */
export type EarningsErrorCode =
  | "stub_detail"
  | "news_unavailable"
  | "news_error"
  | "chain_demo"
  | "iv_unavailable"
  | "iv_term_partial"
  | "metrics_unavailable"
  | "hv_unavailable"
  | "claude_unavailable";

export interface EarningsDetail {
  symbol: string;
  company: string;
  sector: string;
  // Nullable for stub-detail responses when the symbol isn't on the
  // current FMP calendar slice and has no known next-report date (B-41).
  reportDate: string | null;
  reportTime: EarningsReportTime;
  quote: { last: number; change: number; changePct: number } | null;
  metrics: EarningsMetricsBlock | null;
  strikeLadder: StrikeLadder | null;
  claudeStructured: ClaudeStructured | null;
  claudeFullResearch: ClaudeFullResearch | null;
  // B-63: `historicalEarnings` removed — backend loader was a stub; the
  // FMP surprises join will return as a dedicated follow-up PR.
  ivTermStructure: IVTermPoint[] | null;
  skew: SkewBlock | null;
  news: EarningsNewsArticle[];
  partial: boolean;
  generatedAt: string;
  /**
   * Round-4: codes for known-degraded data paths so the UI can surface
   * a precise banner. Empty array on the happy path. Optional so test
   * fixtures pre-dating the field still type-check.
   */
  errorCodes?: EarningsErrorCode[];
}

export interface EarningsCalendarFilters {
  window?: "current" | "next" | "both";
  minIvRank?: number;
  // B-66: `marketCap` removed — curated-universe filter always applies.
  bmoAmc?: "bmo" | "amc" | "both";
  watchlistOnly?: boolean;
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
