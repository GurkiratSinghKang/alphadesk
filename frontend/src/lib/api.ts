import { env } from "@/env";
import type {
  Quote,
  OHLCVBar,
  OptionsChain,
  Position,
  Order,
  PortfolioSummary,
  PortfolioGreeks,
  Analysis,
  ScreenerResult,
  TimeFrame,
} from "@/types";

// ─── Base Fetch ──────────────────────────────────────────────

function getAccessToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return match?.[1];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = typeof window !== "undefined"
    ? (env.API_URL || "")
    : (env.API_URL || "http://localhost:8000");
  const url = `${base}${path}`;

  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && typeof window !== "undefined") {
    if (window.location.pathname !== "/login") {
      // Clear any legacy JS-set cookies and redirect to login
      document.cookie = "access_token=; path=/; max-age=0";
      document.cookie = "refresh_token=; path=/; max-age=0";
      // Request backend to clear HttpOnly cookies
      fetch(`${base}/api/v1/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
      window.location.href = "/login";
    }
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Dispatch error event for toast system to catch
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
        detail: { status: res.status, message: `API ${res.status}: ${res.statusText}`, path },
      }));
    }
    throw new Error(`API ${res.status}: ${res.statusText} – ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Strategies ─────────────────────────────────────────────

export function getStrategies() {
  return apiFetch<{ id: string; name: string; status: string; invested_amount: number; total_return_pct: number; win_rate: number; active_positions_count: number; sparkline: number[] }[]>(
    `/api/v1/strategies/`
  );
}

export function getIndexSparklines() {
  return apiFetch<{ sparklines: Record<string, number[]>; as_of: string }>(
    `/api/v1/market-overview/indices/sparklines`
  );
}

export interface StrategyPerformance {
  name: string;
  description: string;
  status: string;
  invested_amount: number;
  current_value: number;
  total_return_pct: number;
  annualized_return_pct: number;
  return_dollars: number;
  win_rate: number;
  sharpe_ratio: number;
  max_drawdown: number;
  active_positions_count: number;
  equity_curve: { date: string; value: number }[];
  last_trade_date: string;
}

export function getStrategyPerformance(strategyId: string) {
  return apiFetch<StrategyPerformance>(`/api/v1/strategies/${strategyId}/performance`);
}

export interface StrategyTrade {
  id: number;
  symbol: string;
  strategy: string | null;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  entry_time: string;
  exit_time: string | null;
  status: string;
  notes: string | null;
  conviction?: number;
  rationale?: string;
  stop_loss?: number | null;
  take_profit?: number | null;
  exit_reason?: string | null;
}

export function getStrategyTrades(strategyId: string, limit = 100) {
  return apiFetch<StrategyTrade[]>(`/api/v1/trades/history?strategy=${strategyId}&limit=${limit}`);
}

export function toggleStrategy(strategyId: string) {
  return apiFetch<{ strategy_id: string; new_status: string }>(`/api/v1/strategies/${strategyId}/toggle`, { method: "POST" });
}

export interface StrategyAnalytics {
  strategy_id: string;
  sector_exposure: { current: Record<string, number> };
  monthly_returns: { year: number; month: number; return_pct: number }[];
  streaks: { current: { type: string; count: number }; best_win: number; worst_loss: number };
  conviction_distribution: { bucket: string; wins: number; losses: number }[];
  hold_time_stats: { avg_win_days: number; avg_loss_days: number; median_hold_days: number };
  correlations: Record<string, number>;
  rolling_beta: { date: string; beta: number }[];
  best_trade: { symbol: string; pnl: number; pnl_pct: number } | null;
  worst_trade: { symbol: string; pnl: number; pnl_pct: number } | null;
}

export function getStrategyAnalytics(strategyId: string) {
  return apiFetch<StrategyAnalytics>(`/api/v1/strategies/${strategyId}/analytics`);
}

export interface StrategyPositionDetail {
  symbol: string;
  shares: number;
  entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  entry_date: string;
  days_held: number;
  conviction: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string | null;
}

export function getStrategyPositions(strategyId: string) {
  return apiFetch<StrategyPositionDetail[]>(`/api/v1/strategies/${strategyId}/positions`);
}

// ─── Market Overview ────────────────────────────────────────

export function getMarketIndices() {
  return apiFetch<{ indices: { symbol: string; name: string; price: number; change: number; change_pct: number }[] }>(
    `/api/v1/market-overview/indices`
  );
}

// ─── Symbol Search ──────────────────────────────────────────

export async function searchSymbols(query: string, limit = 10) {
  const resp = await apiFetch<{ count: number; results: { symbol: string; name: string; type: string; exchange: string; sector: string }[] }>(
    `/api/v1/symbols/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  return resp.results;
}

// ─── Market Data ─────────────────────────────────────────────

export function getQuote(symbol: string) {
  return apiFetch<Quote>(`/api/v1/market/quotes/${symbol}`);
}

export async function getBars(symbol: string, timeframe: TimeFrame = "D", limit = 500): Promise<OHLCVBar[]> {
  // Map frontend timeframe codes to backend Timeframe enum values
  const tfMap: Record<string, string> = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1H": "1h", "4H": "4h",
    "D": "1d", "W": "1w", "M": "1mo",
  };
  const tf = tfMap[timeframe] || "1d";
  interface BackendBar {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap?: number;
  }
  const raw = await apiFetch<BackendBar[]>(
    `/api/v1/market/bars/${symbol}?timeframe=${tf}&limit=${limit}`
  );
  return raw.map((b) => ({
    time: Math.floor(new Date(b.timestamp).getTime() / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/** Fetch snapshots for multiple symbols (fires parallel requests). */
export async function getSnapshot(symbols: string[]): Promise<Record<string, Quote>> {
  const results: Record<string, Quote> = {};
  const fetches = symbols.map(async (s) => {
    try {
      const quote = await apiFetch<Quote>(`/api/v1/market/quotes/${s}`);
      results[s] = quote;
    } catch {
      // skip symbols that fail
    }
  });
  await Promise.all(fetches);
  return results;
}

// ─── Screener ────────────────────────────────────────────────

export async function screenStocks(preset?: string, filters?: Record<string, unknown>): Promise<ScreenerResult[]> {
  interface BackendResult {
    symbol: string;
    name: string;
    sector: string | null;
    price: number | null;
    change_pct: number | null;
    composite_score: number;
    metrics: Record<string, number>;
  }
  const resp = await apiFetch<{ count: number; results: BackendResult[]; screened_at: string }>(
    `/api/v1/screener/screen`,
    {
      method: "POST",
      body: JSON.stringify({ strategy: preset, ...filters }),
    },
  );
  return resp.results.map((r) => ({
    symbol: r.symbol,
    price: r.price ?? 0,
    change: 0,
    changePct: r.change_pct ?? 0,
    rsScore: r.metrics?.rs_score ?? 0,
    fScore: r.metrics?.f_score ?? 0,
    ivRank: r.metrics?.iv_rank ?? 0,
    ivPctl: r.metrics?.iv_percentile ?? 0,
    mlScore: r.metrics?.ml_score ?? 0,
    composite: r.composite_score ?? 0,
    sector: r.sector ?? "Unknown",
  }));
}

export function getScreenerPresets() {
  return apiFetch<{ name: string; description: string }[]>(`/api/v1/screener/presets`);
}

// ─── Analysis ────────────────────────────────────────────────

export async function analyzeSymbol(symbol: string): Promise<Analysis> {
  interface BackendAnalysis {
    symbol: string;
    composite_score: number;
    recommendation: string;
    agent_results: { agent: string; score: number; summary: string; details: Record<string, unknown> }[];
  }
  const resp = await apiFetch<BackendAnalysis>(`/api/v1/analysis/analyze/${symbol}`, {
    method: "POST",
    body: JSON.stringify({ agents: ["technical", "fundamental", "sentiment", "options"] }),
  });
  const findAgent = (name: string) => resp.agent_results?.find((a) => a.agent === name);
  return {
    symbol: resp.symbol,
    technicalScore: findAgent("technical")?.score ?? 0,
    fundamentalScore: findAgent("fundamental")?.score ?? 0,
    sentimentScore: findAgent("sentiment")?.score ?? 0,
    composite: resp.composite_score ?? 0,
    summary: findAgent("technical")?.summary ?? resp.recommendation ?? "",
    signals: [],
  };
}

export function getAnalysis(symbol: string) {
  return apiFetch<Analysis>(`/api/v1/analysis/analysis/${symbol}`);
}

// ─── Options ─────────────────────────────────────────────────

export async function getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChain> {
  const qs = expiration ? `?expiry=${expiration}` : "";
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/options/chain/${symbol}${qs}`);
  // Backend returns { underlying, contracts: [...], expirations, ... }
  // Frontend expects { symbol, calls: [...], puts: [...], expirations }
  const contracts = (raw.contracts ?? []) as Array<Record<string, unknown>>;
  const calls = contracts
    .filter((c) => c.option_type === "call")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: (c.strike as number) ?? 0,
      type: "call" as const,
      bid: (c.bid as number) ?? 0,
      ask: (c.ask as number) ?? 0,
      last: (c.last as number) ?? 0,
      volume: (c.volume as number) ?? 0,
      oi: (c.open_interest as number) ?? 0,
      iv: (c.iv as number) ?? 0,
      delta: (c.delta as number) ?? 0,
      gamma: (c.gamma as number) ?? 0,
      theta: (c.theta as number) ?? 0,
      vega: (c.vega as number) ?? 0,
    }));
  const puts = contracts
    .filter((c) => c.option_type === "put")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: (c.strike as number) ?? 0,
      type: "put" as const,
      bid: (c.bid as number) ?? 0,
      ask: (c.ask as number) ?? 0,
      last: (c.last as number) ?? 0,
      volume: (c.volume as number) ?? 0,
      oi: (c.open_interest as number) ?? 0,
      iv: (c.iv as number) ?? 0,
      delta: (c.delta as number) ?? 0,
      gamma: (c.gamma as number) ?? 0,
      theta: (c.theta as number) ?? 0,
      vega: (c.vega as number) ?? 0,
    }));
  return {
    symbol: (raw.underlying as string) ?? symbol,
    expirations: (raw.expirations as string[]) ?? [],
    calls,
    puts,
  };
}

export async function getIVData(symbol: string) {
  // Backend returns snake_case: iv_rank, iv_percentile, current_iv
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/options/iv/${symbol}`);
  return {
    ivRank: (raw.iv_rank as number) ?? 0,
    ivPctl: (raw.iv_percentile as number) ?? 0,
    currentIV: (raw.current_iv as number) ?? 0,
    hvRatio: ((raw.current_iv as number) ?? 0) / Math.max((raw.hv_20 as number) ?? 1, 0.01),
  };
}

// ─── Orders & Trading ────────────────────────────────────────

export interface PlaceOrderPayload {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  quantity: number;
  price?: number;
  legs?: { symbol: string; side: "buy" | "sell"; quantity: number; price?: number }[];
}

export function placeOrder(payload: PlaceOrderPayload) {
  // Transform frontend payload to backend CreateOrderRequest format
  const legs = (payload.legs ?? [{ symbol: payload.symbol, side: payload.side, quantity: payload.quantity, price: payload.price }]).map((leg) => ({
    symbol: leg.symbol,
    side: leg.side,
    qty: leg.quantity,
    order_type: payload.type,
    limit_price: payload.type === "limit" || payload.type === "stop_limit" ? (leg.price ?? null) : null,
    stop_price: payload.type === "stop" || payload.type === "stop_limit" ? (leg.price ?? null) : null,
  }));
  return apiFetch<Order>(`/api/v1/trades/orders`, {
    method: "POST",
    body: JSON.stringify({ legs, time_in_force: "day" }),
  });
}

export function cancelOrder(orderId: string) {
  return apiFetch<{ success: boolean }>(`/api/v1/trades/orders/${orderId}`, {
    method: "DELETE",
  });
}

export async function getOrders(status?: string): Promise<Order[]> {
  const qs = status ? `?status=${status}` : "";
  const raw = await apiFetch<Record<string, unknown>[]>(`/api/v1/trades/orders${qs}`);
  return raw.map((o) => {
    const legs = (o.legs as Array<Record<string, unknown>>) ?? [];
    const firstLeg = legs[0] ?? {};
    return {
      id: (o.id as string) ?? "",
      symbol: (firstLeg.symbol as string) ?? (o.symbol as string) ?? "",
      side: ((firstLeg.side as string) ?? (o.side as string) ?? "buy") as "buy" | "sell",
      type: ((firstLeg.order_type as string) ?? (o.type as string) ?? "market") as Order["type"],
      quantity: (firstLeg.qty as number) ?? (o.quantity as number) ?? 0,
      price: (firstLeg.limit_price as number) ?? (o.price as number) ?? undefined,
      status: ((o.status as string) ?? "pending") as Order["status"],
      legs: legs.map((l) => ({
        symbol: (l.symbol as string) ?? "",
        side: ((l.side as string) ?? "buy") as "buy" | "sell",
        quantity: (l.qty as number) ?? 0,
        price: (l.limit_price as number) ?? undefined,
      })),
      filledAt: (o.filled_at as string) ?? undefined,
      createdAt: (o.submitted_at as string) ?? new Date().toISOString(),
    };
  });
}

// ─── Portfolio ───────────────────────────────────────────────

export async function getPositions(): Promise<Position[]> {
  const raw = await apiFetch<Record<string, unknown>[]>(`/api/v1/trades/positions`);
  return raw.map((p) => ({
    symbol: (p.symbol as string) ?? "",
    quantity: (p.quantity as number) ?? (p.qty as number) ?? 0,
    avgCost: (p.avg_cost as number) ?? (p.avgCost as number) ?? 0,
    currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
    unrealizedPnl: (p.unrealized_pnl as number) ?? (p.unrealizedPnl as number) ?? 0,
    marketValue: (p.market_value as number) ?? (p.marketValue as number) ?? 0,
    side: (p.side as "long" | "short") ?? undefined,
  }));
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  interface BackendSummary {
    equity: number;
    cash: number;
    buying_power: number;
    total_market_value: number;
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
    realized_pnl_today: number;
    positions_count: number;
    is_demo?: boolean;
    source?: string;
  }
  const raw = await apiFetch<BackendSummary>(`/api/v1/portfolio/summary`);
  const dayPnl = (raw.unrealized_pnl ?? 0) + (raw.realized_pnl_today ?? 0);
  const lastEquity = (raw.equity ?? 0) - dayPnl;
  const dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
  return {
    equity: raw.equity,
    cash: raw.cash,
    buyingPower: raw.buying_power,
    totalMarketValue: raw.total_market_value,
    unrealizedPnl: raw.unrealized_pnl,
    unrealizedPnlPct: raw.unrealized_pnl_pct,
    realizedPnlToday: raw.realized_pnl_today,
    positionsCount: raw.positions_count,
    dayPnl,
    dayPnlPct,
    is_demo: raw.is_demo === true || raw.source === "demo",
  };
}

export async function getPortfolioGreeks(): Promise<PortfolioGreeks> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/portfolio/greeks`);
  return {
    netDelta: (raw.net_delta as number) ?? 0,
    netGamma: (raw.net_gamma as number) ?? 0,
    netTheta: (raw.net_theta as number) ?? 0,
    netVega: (raw.net_vega as number) ?? 0,
    betaWeightedDelta: (raw.beta_weighted_delta as number) ?? 0,
  };
}

// ─── P&L Calendar ───────────────────────────────────────────

export interface CalendarDay {
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
}

export interface CalendarData {
  month: number;
  year: number;
  days: CalendarDay[];
  monthTotal: number;
  tradingDays: number;
  winningDays: number;
  losingDays: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
}

export async function getPnlCalendar(year?: number, month?: number): Promise<CalendarData> {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;
  const resp = await apiFetch<Record<string, unknown>>(`/api/v1/portfolio/calendar?year=${y}&month=${m}`);
  const days = resp.days as Array<Record<string, unknown>> | undefined;
  return {
    month: resp.month as number,
    year: resp.year as number,
    days: (days || []).map((d) => ({
      date: d.date as string,
      pnl: d.pnl as number,
      trades: d.trades as number,
      winRate: d.win_rate as number,
    })),
    monthTotal: resp.month_total as number,
    tradingDays: resp.trading_days as number,
    winningDays: resp.winning_days as number,
    losingDays: resp.losing_days as number,
    bestDay: resp.best_day as { date: string; pnl: number } | null,
    worstDay: resp.worst_day as { date: string; pnl: number } | null,
  };
}

// ─── Market Regime & Sectors ────────────────────────────────

export function getMarketRegime() {
  return apiFetch<{ regime: { regime: string; label: string; confidence: number; vix_level: number; description: string; indicators: Record<string, unknown> }; as_of: string; is_demo?: boolean }>('/api/v1/market-overview/regime');
}

export function getMarketSectors() {
  return apiFetch<{ sectors: { sector: string; change_pct: number; ytd_pct: number; leader: string; leader_change_pct: number }[]; as_of: string }>('/api/v1/market-overview/sectors');
}

// ─── News ───────────────────────────────────────────────────

export async function getMarketNews() {
  const resp = await apiFetch<{ articles: { title: string; source: string; published_at: string; url: string }[] }>('/api/v1/news/market');
  return resp.articles;
}

// ─── Alerts ────────────────────────────────────────────────

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: "above" | "below";
  triggered: boolean;
  triggered_at: string | null;
  created_at: string;
}

export function getPriceAlerts(symbol?: string): Promise<PriceAlert[]> {
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return apiFetch<PriceAlert[]>(`/api/v1/trades/alerts${qs}`);
}

export function createPriceAlert(symbol: string, price: number, condition: "above" | "below") {
  return apiFetch<PriceAlert>(`/api/v1/trades/alerts`, {
    method: "POST",
    body: JSON.stringify({ symbol, price, condition }),
  });
}

export function deletePriceAlert(alertId: string) {
  return apiFetch<{ ok: boolean }>(`/api/v1/trades/alerts/${alertId}`, {
    method: "DELETE",
  });
}

// ─── Portfolio Performance ──────────────────────────────────

export function getPortfolioPerformance() {
  return apiFetch<{ equity_curve: { date: string; cumulative_pnl: number }[] }>(`/api/v1/portfolio/performance`);
}

// ─── Chat / Agents ───────────────────────────────────────────

export interface ChatResponse {
  conversation_id: string;
  message: string;
  actions_taken: string[];
  suggestions: string[];
  timestamp: string;
}

export function chatWithAgent(message: string, symbol?: string, context?: string) {
  return apiFetch<ChatResponse>(`/api/v1/agents/chat`, {
    method: "POST",
    body: JSON.stringify({
      message,
      context: { symbol, extra: context },
    }),
  });
}

// ─── Pipeline ──────────────────────────────────────────────

export interface PipelineStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: string | null;
}

export interface PipelineScreenedStock {
  symbol: string;
  name: string;
  price: number;
  compositeScore: number;
  sector: string;
  changePct: number;
}

export interface PipelineAnalysis {
  symbol: string;
  signal: string;
  conviction: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rationale: string;
}

export interface PipelineOrder {
  symbol: string;
  side: string;
  qty: number;
  price: number;
  orderId: string;
  status: string;
  timestamp: string;
}

export interface PipelineRun {
  date: string;
  timestamp: string;
  screened: PipelineScreenedStock[];
  analyzed: PipelineAnalysis[];
  signals: any[];
  ordersPlaced: PipelineOrder[];
  ordersClosed: PipelineOrder[];
  portfolioSnapshot: { equity: number; cash: number; positions: number };
  errors: string[];
  /** Raw per-strategy breakdown from the pipeline log */
  strategies?: Record<string, any>;
  /** Master agent decisions/rejections */
  master_agent?: Record<string, any>;
}

export interface PipelinePosition {
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number | null;
  takeProfit: number | null;
  entryDate: string;
  signal: string;
  rationale: string;
}

export function getPipelineStatus() {
  return apiFetch<PipelineStatus>('/api/v1/pipeline/status');
}

export async function triggerPipeline(): Promise<{ ok: boolean; result: PipelineRun }> {
  const raw = await apiFetch<{ ok: boolean; result: Record<string, unknown> }>('/api/v1/pipeline/run', { method: 'POST' });
  return { ok: raw.ok, result: mapPipelineRun(raw.result) };
}

export async function getPipelineHistory(): Promise<Record<string, any>[]> {
  return apiFetch<Record<string, any>[]>('/api/v1/pipeline/history');
}

export async function getPipelineRun(date: string): Promise<PipelineRun> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/pipeline/history/${date}`);
  return mapPipelineRun(raw);
}

export function mapPipelineRun(raw: Record<string, unknown>): PipelineRun {
  const r = raw as Record<string, any>;

  // Build screened/analyzed arrays — top-level arrays if available, otherwise
  // aggregate from per-strategy data inside r.strategies
  let screened: PipelineScreenedStock[] = [];
  let analyzed: PipelineAnalysis[] = [];

  if (Array.isArray(r.screened) && r.screened.length > 0) {
    screened = r.screened.map((s: any) => ({
      symbol: s.symbol, name: s.name, price: s.price,
      compositeScore: s.composite_score ?? s.compositeScore ?? 0,
      sector: s.sector ?? "", changePct: s.change_pct ?? s.changePct ?? 0,
    }));
  }
  if (Array.isArray(r.analyzed) && r.analyzed.length > 0) {
    analyzed = r.analyzed.map((a: any) => ({
      symbol: a.symbol, signal: a.signal ?? "hold", conviction: a.conviction ?? 0,
      entryPrice: a.entry_price ?? a.entryPrice ?? null,
      stopLoss: a.stop_loss ?? a.stopLoss ?? null,
      takeProfit: a.take_profit ?? a.takeProfit ?? null,
      rationale: a.rationale ?? "",
    }));
  }

  // Aggregate from per-strategy data when top-level arrays are absent
  const strategies = r.strategies ?? {};
  if (screened.length === 0 && typeof strategies === "object") {
    let totalScreened = 0;
    for (const strat of Object.values(strategies) as any[]) {
      if (typeof strat?.screened === "number") totalScreened += strat.screened;
    }
    // Create placeholder entries so PipelineFlow can show the count
    if (totalScreened > 0) {
      screened = Array.from({ length: totalScreened }, (_, i) => ({
        symbol: `stock-${i}`, name: "", price: 0,
        compositeScore: 0, sector: "", changePct: 0,
      }));
    }
  }
  if (analyzed.length === 0 && typeof strategies === "object") {
    // Collect analyses from each strategy's analyses array
    for (const [stratName, strat] of Object.entries(strategies) as [string, any][]) {
      if (Array.isArray(strat?.analyses)) {
        for (const a of strat.analyses) {
          analyzed.push({
            symbol: a.symbol ?? stratName, signal: a.signal ?? "hold",
            conviction: a.conviction ?? 0,
            entryPrice: a.entry_price ?? a.entryPrice ?? null,
            stopLoss: a.stop_loss ?? a.stopLoss ?? null,
            takeProfit: a.take_profit ?? a.takeProfit ?? null,
            rationale: a.rationale ?? "",
          });
        }
      } else if (typeof strat?.analyzed === "number" && strat.analyzed > 0) {
        // Only have a count — create placeholders
        for (let i = 0; i < strat.analyzed; i++) {
          analyzed.push({
            symbol: `${stratName}-${i}`, signal: "hold", conviction: 0,
            entryPrice: null, stopLoss: null, takeProfit: null, rationale: "",
          });
        }
      }
    }
  }

  return {
    date: r.date ?? "",
    timestamp: r.timestamp ?? "",
    screened,
    analyzed,
    signals: r.signals ?? [],
    ordersPlaced: (r.orders_placed ?? r.ordersPlaced ?? []).map((o: any) => ({
      symbol: o.symbol, side: o.side, qty: o.qty ?? 0, price: o.price ?? 0,
      orderId: o.order_id ?? o.orderId ?? "", status: o.status ?? "",
      timestamp: o.timestamp ?? "",
    })),
    ordersClosed: (r.orders_closed ?? r.ordersClosed ?? []).map((o: any) => ({
      symbol: o.symbol, side: o.side, qty: o.qty ?? 0, price: o.price ?? 0,
      orderId: o.order_id ?? o.orderId ?? "", status: o.status ?? "",
      timestamp: o.timestamp ?? "",
    })),
    portfolioSnapshot: {
      equity: r.portfolio_snapshot?.equity ?? r.portfolioSnapshot?.equity ?? 0,
      cash: r.portfolio_snapshot?.cash ?? r.portfolioSnapshot?.cash ?? 0,
      positions: r.portfolio_snapshot?.positions ?? r.portfolioSnapshot?.positions ?? 0,
    },
    errors: r.errors ?? [],
    strategies: typeof strategies === "object" && strategies ? strategies : undefined,
    master_agent: r.master_agent ?? undefined,
  };
}

export interface PipelinePerformance {
  totalTrades: number;
  openPositions: number;
  totalPnl: number;
  winRate: number;
  avgPnlPct: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
}

export async function getPipelinePositions(): Promise<{ positions: PipelinePosition[]; performance: PipelinePerformance }> {
  const resp = await apiFetch<{ open_positions: Record<string, unknown>[]; performance: Record<string, unknown> }>('/api/v1/pipeline/positions');
  const perf = resp.performance ?? {};
  return {
    positions: (resp.open_positions ?? []).map((p: Record<string, unknown>) => ({
      symbol: (p.symbol as string) ?? "",
      shares: (p.shares as number) ?? (p.qty as number) ?? 0,
      entryPrice: (p.entry_price as number) ?? (p.entryPrice as number) ?? 0,
      currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
      pnl: (p.pnl as number) ?? (p.unrealized_pl as number) ?? 0,
      pnlPct: (p.pnl_pct as number) ?? (p.pnlPct as number) ?? 0,
      stopLoss: (p.stop_loss as number) ?? (p.stopLoss as number) ?? null,
      takeProfit: (p.take_profit as number) ?? (p.takeProfit as number) ?? null,
      entryDate: (p.entry_time as string) ?? (p.entry_date as string) ?? (p.entryDate as string) ?? "",
      signal: (p.signal as string) ?? "hold",
      rationale: (p.rationale as string) ?? "",
    })),
    performance: {
      totalTrades: (perf.total_trades as number) ?? 0,
      openPositions: (perf.open_positions as number) ?? 0,
      totalPnl: (perf.total_pnl as number) ?? 0,
      winRate: (perf.win_rate as number) ?? 0,
      avgPnlPct: (perf.avg_pnl_pct as number) ?? 0,
      bestTrade: perf.best_trade ? { symbol: (perf.best_trade as any).symbol, pnl: (perf.best_trade as any).pnl } : null,
      worstTrade: perf.worst_trade ? { symbol: (perf.worst_trade as any).symbol, pnl: (perf.worst_trade as any).pnl } : null,
    },
  };
}
