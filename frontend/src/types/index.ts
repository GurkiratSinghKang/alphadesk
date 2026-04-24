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
}

export interface CalendarResponse {
  earnings: CalendarRow[];
  generatedAt: string;
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

export interface EarningsDetail {
  symbol: string;
  company: string;
  sector: string;
  reportDate: string;
  reportTime: EarningsReportTime;
  quote: { last: number; change: number; changePct: number } | null;
  metrics: EarningsMetricsBlock | null;
  strikeLadder: StrikeLadder | null;
  claudeStructured: ClaudeStructured | null;
  claudeFullResearch: ClaudeFullResearch | null;
  historicalEarnings: HistoricalBlock | null;
  ivTermStructure: IVTermPoint[] | null;
  skew: SkewBlock | null;
  news: EarningsNewsArticle[];
  partial: boolean;
  generatedAt: string;
}

export interface EarningsCalendarFilters {
  window?: "current" | "next" | "both";
  minIvRank?: number;
  marketCap?: "mega" | "large" | "mid" | "small" | "all";
  bmoAmc?: "bmo" | "amc" | "both";
  watchlistOnly?: boolean;
  sort?: "date" | "iv_rank" | "yield" | "claude_confidence";
}
