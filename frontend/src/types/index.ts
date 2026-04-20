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
export type OrderStatus = "pending" | "open" | "filled" | "partial" | "cancelled" | "rejected";

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
