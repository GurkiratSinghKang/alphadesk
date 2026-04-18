/**
 * _desk/selectors.ts
 * ──────────────────
 * Data-shape adapters that map store / React-Query results into the
 * presentation-only shapes Layer-2 composites expect. No fetching, no
 * side effects — pure synchronous mappers so the flagship page stays
 * thin and under 300 lines.
 *
 * Rules:
 *  - if a backend field is missing, surface "—" or empty arrays;
 *    never fabricate numbers (that was the audit's P0).
 *  - strategy id → display name goes through STRATEGY_META to keep
 *    editorial naming consistent with the rest of the app.
 */
import type {
  AIMemo,
  ContextCell,
  MarketSymbol,
  MetaCells,
  PositionRow,
  Quote,
  StatusPill,
  StrategyOption,
  StrategyRailItem,
} from "@/components/composites";
import type { Regime, RegimeVol } from "@/components/primitives/RegimePill";
import { STRATEGY_META, STRATEGY_ORDER } from "@/lib/strategies";
import type { Position, PortfolioSummary, Quote as MarketQuote } from "@/types";

/* ─── Regime ───────────────────────────────────────────────── */

export interface RawRegime {
  regime: string;
  label: string;
  confidence: number;
  vix_level: number;
  description: string;
}

/** Map the backend's free-form regime string onto the composite's
 *  `RegimePill` type domain. Default to "neutral" if unrecognised. */
export function toRegime(raw: RawRegime | null | undefined): {
  regime: Regime;
  vol?: RegimeVol;
  label?: string;
} {
  if (!raw) return { regime: "neutral", label: "unknown" };
  const r = (raw.regime || "").toLowerCase();
  const regime: Regime =
    r.includes("bull") ? "bull" :
    r.includes("bear") ? "bear" :
    r.includes("crisis") || r.includes("risk-off") ? "crisis" :
    "neutral";
  const vix = raw.vix_level ?? 0;
  const vol: RegimeVol | undefined =
    vix === 0 ? undefined :
    vix >= 30 ? "high" :
    vix >= 20 ? "elevated" :
    "low";
  const label = raw.label
    ? raw.label.toLowerCase()
    : vol
      ? `${regime} · ${vol} volatility`
      : regime;
  return { regime, vol, label };
}

/* ─── Strategy rail ────────────────────────────────────────── */

export interface RawStrategy {
  id: string;
  name: string;
  status: string;
  invested_amount: number;
  total_return_pct: number;
  win_rate: number;
  active_positions_count: number;
  sparkline: number[];
}

/** Shape API strategies onto StrategyRailItem. If the backend hasn't
 *  returned any strategies yet we render the canonical ordered list
 *  as paused rows with null return — no fake numbers. */
export function toRailItems(
  raw: RawStrategy[] | undefined
): StrategyRailItem[] {
  const byId = new Map((raw ?? []).map((s) => [s.id, s]));
  return STRATEGY_ORDER.map((id, i) => {
    const meta = STRATEGY_META[id];
    const api = byId.get(id);
    const active = (api?.status ?? "").toLowerCase() === "active";
    return {
      id,
      name: meta?.shortName ?? id,
      subtitle: meta?.regimeNote ?? "",
      status: active ? "active" : "paused",
      returnPct: api ? api.total_return_pct : null,
      indexLabel: String(i + 1).padStart(2, "0"),
    } satisfies StrategyRailItem;
  }).slice(0, 8); // cap the rail at 8 rows; full catalogue lives on /strategies
}

export function toStrategyOptions(
  items: StrategyRailItem[]
): StrategyOption[] {
  return items.map((s) => ({ id: s.id, label: s.name }));
}

/* ─── Context bar ──────────────────────────────────────────── */

export function toContextCells(
  summary: PortfolioSummary | undefined,
  positions: Position[],
  orderCount: number
): ContextCell[] {
  const s = summary;
  const equity = s?.equity ?? 0;
  const dayPnl = s?.dayPnl ?? 0;
  const dayPnlPct = s?.dayPnlPct ?? 0;
  const cash = s?.cash ?? 0;
  const longVal = positions
    .filter((p) => (p.quantity ?? 0) >= 0)
    .reduce((t, p) => t + (p.marketValue ?? 0), 0);
  const shortVal = positions
    .filter((p) => (p.quantity ?? 0) < 0)
    .reduce((t, p) => t + Math.abs(p.marketValue ?? 0), 0);
  const gross = longVal + shortVal;
  const exposurePct = equity > 0 ? (gross / equity) * 100 : 0;

  return [
    {
      label: "Book equity",
      value: equity > 0 ? fmtDollars(equity) : "—",
      delta: equity > 0 && dayPnlPct !== 0 ? fmtPct(dayPnlPct) : undefined,
      deltaTone: dayPnl >= 0 ? "profit" : "loss",
      emphasis: true,
    },
    {
      label: "Day P&L",
      value: s ? (dayPnl >= 0 ? `+${fmtDollars(dayPnl)}` : `−${fmtDollars(Math.abs(dayPnl))}`) : "—",
    },
    {
      label: "Cash",
      value: s ? fmtDollars(cash) : "—",
    },
    {
      label: "Exposure · Long / Short",
      value: equity > 0 ? `${exposurePct.toFixed(0)}%` : "—",
      delta: positions.length
        ? `${pctOfEquity(longVal, equity)} / ${pctOfEquity(shortVal, equity)}`
        : undefined,
    },
    { label: "Sharpe · 30d", value: "—" }, // not in summary endpoint
    { label: "Beta", value: "—" },         // not in summary endpoint
    {
      label: "Positions · Orders",
      value: `${positions.length} · ${orderCount}`,
    },
  ];
}

function pctOfEquity(v: number, equity: number): string {
  if (equity <= 0) return "0%";
  return `${Math.round((v / equity) * 100)}%`;
}

/* ─── Symbol + quote + meta for the chart panel ────────────── */

const VENUE_BY_SYMBOL: Record<string, string> = {
  SPY: "NYSE Arca · ETF",
  QQQ: "Nasdaq · ETF",
  IWM: "NYSE Arca · ETF",
  VIX: "CBOE · Index",
  NVDA: "Nasdaq · Semis",
  AAPL: "Nasdaq · Hardware",
  MSFT: "Nasdaq · Software",
  GOOGL: "Nasdaq · Internet",
  AMZN: "Nasdaq · Internet",
  META: "Nasdaq · Internet",
  TSLA: "Nasdaq · Autos",
  AMD: "Nasdaq · Semis",
};

/** Derive MarketSymbol from a ticker + optional quote. name falls back
 *  to the ticker itself — the chart header still reads cleanly. */
export function toMarketSymbol(ticker: string): MarketSymbol {
  return {
    ticker,
    name: ticker,
    venue: VENUE_BY_SYMBOL[ticker] ?? "—",
  };
}

export function toQuote(q: MarketQuote | undefined): Quote {
  if (!q) return { last: 0, change: 0, changePct: 0 };
  return {
    last: q.last ?? q.close ?? 0,
    change: q.change ?? 0,
    changePct: q.changePct ?? 0,
  };
}

/** Compact a number like 28_400_000 → "28.4M". */
export function compactNumber(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function toMetaCells(q: MarketQuote | undefined): MetaCells {
  return {
    volume: compactNumber(q?.volume),
    avgVolume: "—", // backend quote snapshot doesn't expose avg volume yet
    range:
      q && Number.isFinite(q.low) && Number.isFinite(q.high) && (q.low || q.high)
        ? `${q.low.toFixed(2)} — ${q.high.toFixed(2)}`
        : "—",
    iv: "—", // IV lives in a separate endpoint (useIVData); not wired here
    regimeFit: 0, // exposed for future — composite renders gracefully at 0
  };
}

/* ─── Positions ────────────────────────────────────────────── */

export function toPositionRows(positions: Position[]): PositionRow[] {
  return positions.map((p, i) => {
    const mv = p.marketValue ?? 0;
    const pnl = p.unrealizedPnl ?? 0;
    const basis = Math.max(Math.abs(mv - pnl), 1);
    const pnlPct = (pnl / basis) * 100;
    return {
      id: `${p.symbol}-${i}`,
      symbol: p.symbol,
      quantity: p.quantity ?? 0,
      entryPrice: p.avgCost ?? 0,
      // Positions API doesn't echo the strategy → show sector as a
      // secondary italic label; falls back to em-dash if missing.
      strategyName: p.sector ?? "—",
      progress: Math.max(-1, Math.min(1, pnlPct / 10)),
      pnl,
      pnlPct,
    };
  });
}

/* ─── Status bar ───────────────────────────────────────────── */

export function toStatusPills(opts: {
  brokerConnected: boolean;
  marketOpen: boolean;
  closeCountdown?: string;
  claudeHealthy: boolean;
  claudeLatencyMs?: number;
  lastTickSec?: number;
}): StatusPill[] {
  const pills: StatusPill[] = [];
  pills.push({
    label: opts.brokerConnected
      ? "Alpaca paper · connected"
      : "Alpaca paper · offline",
    tone: opts.brokerConnected ? "profit" : "muted",
  });
  pills.push({
    label: opts.marketOpen
      ? opts.closeCountdown
        ? `Market · open · ${opts.closeCountdown} to close`
        : "Market · open"
      : "Market · closed",
    tone: opts.marketOpen ? "profit" : "muted",
  });
  pills.push({
    label:
      opts.claudeHealthy && opts.claudeLatencyMs != null
        ? `Claude · healthy · p50 ${opts.claudeLatencyMs}ms`
        : opts.claudeHealthy
          ? "Claude · healthy"
          : "Claude · idle",
    tone: opts.claudeHealthy ? "profit" : "muted",
  });
  if (opts.lastTickSec != null) {
    pills.push({
      label: `Last tick ${opts.lastTickSec.toFixed(2)}s`,
      tone: "muted",
    });
  }
  return pills;
}

/* ─── AI memo placeholder ──────────────────────────────────── */

/** When no pre-trade memo is available, return a minimal "awaiting
 *  analysis" placeholder so the gold-pulse pane still renders. No
 *  fake numbers — confidence 0, latency 0, empty chips. */
export function emptyMemo(timestamp: string): AIMemo {
  return {
    text: "No pre-trade memo available. Stage an order to request analysis.",
    chips: [],
    confidence: 0,
    model: "—",
    latencyMs: 0,
    timestamp,
  };
}

/* ─── Formatting helpers ───────────────────────────────────── */

function fmtDollars(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
