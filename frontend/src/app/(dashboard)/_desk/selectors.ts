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
import { STRATEGY_META, STRATEGY_ORDER, metaStage } from "@/lib/strategies";
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

/**
 * Registry-backed Phase 1 strategy route IDs — mirrors
 * `backend/strategies/registry.py::IMPLEMENTED_STRATEGY_ROUTE_IDS` and
 * `backend/api/routes/strategies.py::_REGISTRY_TO_ROUTE`. No marketing
 * placeholders (no "claude-alpha" / "dividend-capture" /
 * "sector-rotation" — those are ``stage: "planned"`` in ``STRATEGY_META``).
 *
 * Derived from `STRATEGY_META` at module load time so adding a new real
 * backend package is a one-line change in `lib/strategies.ts` instead of
 * here — they can't drift.
 */
export const REGISTRY_STRATEGY_IDS: readonly string[] = Object.keys(
  STRATEGY_META
).filter((id) => metaStage(id) === "live");

/** Strategy ids the rail should surface even though they aren't decorator-
 *  registered: ``manual-discretionary`` is the ledger-backed bucket for
 *  user-initiated trades (persona-1 #3 flagged it as invisible despite
 *  carrying +$57k invested capital). Keep it in a separate list so the
 *  test for "is this backed by a Python package?" stays honest. */
const OTHER_RAIL_STRATEGY_IDS: readonly string[] = Object.keys(
  STRATEGY_META
).filter((id) => metaStage(id) === "other");

/** Ids that appear on the rail — live + "other" (manual). Planned ghosts
 *  stay off the rail; the new `/strategies` listing page surfaces them
 *  under a "Coming soon" section so researchers can see the roadmap
 *  without the rail pretending they trade. */
const RAIL_STRATEGY_IDS: readonly string[] = [
  ...REGISTRY_STRATEGY_IDS,
  ...OTHER_RAIL_STRATEGY_IDS,
];

/** Shape API strategies onto StrategyRailItem. If the backend hasn't
 *  returned any strategies yet we render the canonical ordered list
 *  as paused rows with null return — no fake numbers.
 *
 *  Ghost ("planned") strategies are intentionally omitted — see
 *  `STRATEGY_META[...].stage`. They surface on `/strategies` instead.
 *  `manual-discretionary` IS included (persona-1 #3: previously invisible
 *  despite real invested capital). */
export function toRailItems(
  raw: RawStrategy[] | undefined
): StrategyRailItem[] {
  const byId = new Map((raw ?? []).map((s) => [s.id, s]));
  const allowed = new Set(RAIL_STRATEGY_IDS);
  const ids = STRATEGY_ORDER.filter((id) => allowed.has(id));
  return ids.map((id, i) => {
    const meta = STRATEGY_META[id];
    const api = byId.get(id);
    const active = (api?.status ?? "").toLowerCase() === "active";
    // Backend currently returns a live `total_return_pct` that is 0
    // until the ledger has closed trades. Treat 0 as "not yet" so the
    // rail renders an honest em-dash instead of a misleading 0.00%.
    // Once R-A populates a real `return_pct` off the ledger, non-zero
    // values will flow through naturally.
    const live = api?.total_return_pct;
    const returnPct =
      api == null || live == null || !Number.isFinite(live) || live === 0
        ? null
        : live;
    return {
      id,
      name: meta?.shortName ?? id,
      subtitle: meta?.regimeNote ?? "",
      status: active ? "active" : "paused",
      returnPct,
      indexLabel: String(i + 1).padStart(2, "0"),
    } satisfies StrategyRailItem;
  });
  // No cap — live (12) + manual (1) = 13 rows, still matches the rail's
  // natural height. Planned ghosts live on `/strategies` instead.
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
  const cash = s?.cash ?? 0;
  const longVal = positions
    .filter((p) => (p.quantity ?? 0) >= 0)
    .reduce((t, p) => t + (p.marketValue ?? 0), 0);
  const shortVal = positions
    .filter((p) => (p.quantity ?? 0) < 0)
    .reduce((t, p) => t + Math.abs(p.marketValue ?? 0), 0);
  const gross = longVal + shortVal;
  const exposurePct = equity > 0 ? (gross / equity) * 100 : 0;

  // Swap out Sharpe·30d / Beta (not exposed by the summary endpoint, so
  // they used to render permanent em-dashes in the ContextBar) for two
  // stats the summary does expose — `unrealized_pnl` and
  // `realized_pnl_today`. The former is the live P&L running on open
  // positions; the latter is today's closed-trade P&L.
  const unrealizedPnl = s?.unrealizedPnl ?? 0;
  const unrealizedPnlPct = s?.unrealizedPnlPct ?? 0;
  const realizedToday = s?.realizedPnlToday ?? 0;

  // Day P&L reconciliation (persona-3 P0 #8):
  // The backend only always exposes `realized_pnl_today`, which is $0
  // when no trades closed today. That produced a contradiction with the
  // Unrealized cell ("Day P&L $0" while Unrealized +$1,506 on the same
  // row). Until the backend surfaces a true `day_pnl = equity -
  // last_equity` (cross-wave flag — backend owner's call), derive it as
  // `realized_today + unrealized_pnl` so the number always moves with
  // the market. When `summary.dayPnl` is non-zero (lib/api already
  // forwards `rawAny.day_pnl` when the backend sends it), prefer that
  // authoritative value.
  const backendDayPnl = s?.dayPnl;
  const haveBackendDayPnl =
    backendDayPnl != null && Number.isFinite(backendDayPnl) && backendDayPnl !== 0;
  const dayPnl = haveBackendDayPnl ? backendDayPnl! : realizedToday + unrealizedPnl;
  const backendDayPnlPct = s?.dayPnlPct;
  const dayPnlPct =
    backendDayPnlPct != null &&
    Number.isFinite(backendDayPnlPct) &&
    backendDayPnlPct !== 0
      ? backendDayPnlPct
      : equity > 0
        ? (dayPnl / equity) * 100
        : 0;

  // A realized/unrealized split so the reader can reconcile the Day P&L
  // number with the other two cells at a glance. Rendered in the cell's
  // `delta` line (same slot the context bar already uses for "+0.52%").
  const realizedSign = realizedToday > 0 ? "+" : realizedToday < 0 ? "−" : "";
  const unrealizedSign = unrealizedPnl > 0 ? "+" : unrealizedPnl < 0 ? "−" : "";
  const dayPnlBreakdown =
    s && (realizedToday !== 0 || unrealizedPnl !== 0)
      ? `${realizedSign}${fmtDollars(Math.abs(realizedToday))} realized · ${unrealizedSign}${fmtDollars(Math.abs(unrealizedPnl))} unrealized`
      : undefined;

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
      // Surface the realized/unrealized split so the reader can reconcile
      // the number with the Unrealized / Realized today cells without
      // mental math.
      delta: dayPnlBreakdown,
      // Tone the value itself so negatives render coral and positives chartreuse.
      // Treat an exact zero as muted so it doesn't flash green for no movement.
      valueTone: !s ? "muted" : dayPnl > 0 ? "profit" : dayPnl < 0 ? "loss" : "muted",
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
    {
      label: "Unrealized P&L",
      value: !s
        ? "—"
        : unrealizedPnl >= 0
          ? `+${fmtDollars(unrealizedPnl)}`
          : `−${fmtDollars(Math.abs(unrealizedPnl))}`,
      delta:
        s && unrealizedPnlPct !== 0 ? fmtPct(unrealizedPnlPct) : undefined,
      valueTone: !s
        ? "muted"
        : unrealizedPnl > 0
          ? "profit"
          : unrealizedPnl < 0
            ? "loss"
            : "muted",
    },
    {
      label: "Realized today",
      value: !s
        ? "—"
        : realizedToday >= 0
          ? `+${fmtDollars(realizedToday)}`
          : `−${fmtDollars(Math.abs(realizedToday))}`,
      valueTone: !s
        ? "muted"
        : realizedToday > 0
          ? "profit"
          : realizedToday < 0
            ? "loss"
            : "muted",
    },
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
  // Always emit the 4th pill so the StatusBar has a stable shape even
  // before the first tick arrives. Render "—" when we have no data.
  pills.push({
    label:
      opts.lastTickSec != null
        ? `Last tick ${opts.lastTickSec.toFixed(2)}s`
        : "Last tick —",
    tone: "muted",
  });
  return pills;
}

/* ─── AI memo placeholder ──────────────────────────────────── */

/** When no pre-trade memo is available, return an "awaiting analysis"
 *  placeholder so the gold-pulse pane still renders intentionally. The
 *  copy is explicit about being an empty-state (not a loading state) so
 *  the user knows the panel isn't broken. The footer is still rendered
 *  by AIMemoPanel itself — we pass `NaN` confidence + "awaiting" as a
 *  signal the panel can choose to hide the footer on. */
export function emptyMemo(timestamp: string): AIMemo {
  return {
    text: "No memo yet — add one or wait for the AI to summarize.",
    chips: [],
    confidence: 0,
    model: "awaiting",
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
