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
  description?: string;
  status: string;
  invested_amount: number;
  total_return_pct: number;
  sharpe_ratio?: number | null;
  win_rate: number;
  active_positions_count: number;
  sparkline: number[];
  live_disabled?: boolean;
  paper_only?: boolean;
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
  const ready = Boolean(
    s?.lastUpdated ||
      s?.source ||
      s?.is_demo !== undefined ||
      positions.length > 0 ||
      orderCount > 0 ||
      [s?.equity, s?.cash, s?.buyingPower, s?.totalMarketValue].some(
        (value) => Number.isFinite(value) && value !== 0,
      ),
  );
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

  // Round-8 UX killer-move 1: compressed from 7 cells to 4. The
  // previous bar surfaced Book equity, Day P&L, Cash, Exposure,
  // Unrealized, Realized today, and Positions·Orders — Day P&L's
  // delta line ALREADY shows the realized/unrealized split (line ~218
  // above), so the dedicated Unrealized + Realized cells were
  // duplicates. Cash is rolled into Buying-power (more decision-
  // relevant for active management) per the synthesis agent's
  // "40/30/20/10 budget" — equity is the hero, Day P&L is the second
  // tier, BP and Positions are the supporting context. Drops the
  // ContextBar cell-count from 7 → 4, eliminates 3 duplicate fields,
  // and lets the hero (Book equity) breathe.
  const buyingPower = s?.buyingPower ?? cash;
  return [
    {
      label: "Book equity",
      value: ready && equity > 0 ? fmtDollars(equity) : "—",
      delta: ready && equity > 0 && dayPnlPct !== 0 ? fmtPct(dayPnlPct) : undefined,
      deltaTone: dayPnl >= 0 ? "profit" : "loss",
      emphasis: true,
    },
    {
      label: "Day P&L",
      value: ready ? (dayPnl >= 0 ? `+${fmtDollars(dayPnl)}` : `−${fmtDollars(Math.abs(dayPnl))}`) : "—",
      // Surface the realized/unrealized split so the reader can reconcile
      // the number with the underlying Unrealized / Realized lines without
      // mental math (and without dedicated cells that duplicate the data).
      delta: dayPnlBreakdown,
      // Tone the value itself so negatives render coral and positives chartreuse.
      // Treat an exact zero as muted so it doesn't flash green for no movement.
      valueTone: !ready ? "muted" : dayPnl > 0 ? "profit" : dayPnl < 0 ? "loss" : "muted",
    },
    {
      // Buying power tells a trader what they CAN do; cash alone
      // understates capacity in a margin-enabled account.
      label: "Buying power",
      value: ready ? fmtDollars(buyingPower) : "—",
    },
    {
      // BUG-008: the right-panel Book tabs also show an "Orders" count, but
      // that set is "orders today (all statuses)" — while this top-bar cell
      // shows "open orders only" (pending + open). Distinct labels so users
      // don't read them as the same number with two values.
      label: "Positions · Open Orders",
      value: ready ? `${positions.length} · ${orderCount}` : "— · —",
      // Exposure as the secondary context line: shows long/short tilt
      // without taking a full cell. Quants want it; novices ignore it.
      delta: positions.length && equity > 0
        ? `${exposurePct.toFixed(0)}% gross · ${pctOfEquity(longVal, equity)} / ${pctOfEquity(shortVal, equity)}`
        : undefined,
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

export function toMetaCells(
  q: MarketQuote | undefined,
  // BUG-032: when the market is closed, unpopulated cells should read
  // "unavailable" instead of a silent em-dash that users interpret as
  // "we're still loading". Defaults true so existing callers keep their
  // prior "em-dash means missing" behaviour at the composite level.
  opts?: { marketOpen?: boolean },
): MetaCells {
  const marketOpen = opts?.marketOpen ?? true;
  // Copy used when the source endpoint simply doesn't expose the field
  // yet (avg volume, IV) OR when the market is closed and intraday
  // numbers don't exist yet for the session. "unavailable" is short
  // enough to fit the meta cell typography but explicit enough that the
  // user knows this isn't a loading state.
  const unavailable = marketOpen ? "—" : "unavailable";
  return {
    volume: q?.volume != null ? compactNumber(q.volume) : unavailable,
    // backend quote snapshot doesn't expose avg volume yet — always
    // unavailable, upgraded to a clearer label when market is closed
    avgVolume: unavailable,
    range:
      q && Number.isFinite(q.low) && Number.isFinite(q.high) && (q.low || q.high)
        ? `${q.low.toFixed(2)} — ${q.high.toFixed(2)}`
        : unavailable,
    // IV lives in a separate endpoint (useIVData); not wired here — and
    // for most closed-market sessions there won't be a live IV either.
    iv: unavailable,
    // regime-fit is a number (composite tone-codes 0 as "no data") — we
    // leave the numeric zero as the sentinel and let the composite pick
    // the copy at render time.
    regimeFit: 0,
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
      // Prefer strategy attribution when the backend provides it; sector
      // remains a useful fallback for older broker snapshots.
      strategyName: p.strategy ?? p.sector ?? "—",
      progress: Math.max(-1, Math.min(1, pnlPct / 10)),
      pnl,
      pnlPct,
    };
  });
}

/* ─── Status bar ───────────────────────────────────────────── */

export function toStatusPills(opts: {
  brokerConnected: boolean;
  brokerStatus?: "connected" | "pending" | "not_linked";
  marketOpen: boolean;
  closeCountdown?: string;
  claudeHealthy: boolean;
  claudeLatencyMs?: number;
  lastTickSec?: number;
  // Phase-1 / SB-1: pipeline + trading-mode pills mandated by the
  // 2026 design brief (Datadog/Bloomberg-style status rail). Optional
  // so non-dashboard surfaces calling this selector keep working.
  pipelineRunning?: number;  // count of currently-running strategies
  pipelineTotal?: number;    // total live strategies expected to run today
  tradingMode?: "paper" | "live";
}): StatusPill[] {
  const pills: StatusPill[] = [];
  const brokerStatus =
    opts.brokerStatus ?? (opts.brokerConnected ? "connected" : "not_linked");
  // Wave 3N persona-94 #1: a first-time user with no Alpaca creds sees
  // the offline pill with no remediation. Distinguish "not linked yet"
  // from the old "offline" state and surface a one-click fix link into
  // /settings. A third "pending" state covers first paint before the
  // portfolio summary has confirmed either live Alpaca or demo fallback.
  pills.push({
    label:
      brokerStatus === "connected"
        ? "Alpaca paper · connected"
        : brokerStatus === "pending"
          ? "Broker status pending"
          : "Broker not linked",
    tone:
      brokerStatus === "connected"
        ? "profit"
        : brokerStatus === "pending"
          ? "muted"
          : "amber",
    href: brokerStatus === "not_linked" ? "/settings" : undefined,
    hrefLabel: brokerStatus === "not_linked" ? "Configure Alpaca keys" : undefined,
    title:
      brokerStatus === "connected"
        ? undefined
        : brokerStatus === "pending"
          ? "Waiting for the portfolio summary before declaring broker state."
          : "AlphaDesk hasn't seen Alpaca credentials yet. Open /settings to paste your keys.",
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
  // before the first tick arrives.
  //
  // BUG-031: "Last tick —" is ambiguous when the market is closed — it
  // reads like the feed is broken. Swap to "Feed idle · market closed"
  // so the user knows the em-dash reflects the session calendar, not a
  // stale socket. Keep "Last tick X.XXs" when we have a fresh tick and
  // "Last tick —" only when the market is open but we haven't seen one
  // yet (startup / broker hiccup).
  pills.push({
    label:
      opts.lastTickSec != null
        ? `Last tick ${opts.lastTickSec.toFixed(2)}s`
        : opts.marketOpen
          ? "Last tick —"
          : "Feed idle · market closed",
    tone: "muted",
  });
  // Phase-1 / SB-1: pipeline pill — Datadog/Bloomberg pattern. Shows
  // ``running 2/12`` when strategies are mid-run, ``idle`` otherwise.
  if (opts.pipelineRunning != null && opts.pipelineTotal != null) {
    const running = opts.pipelineRunning;
    pills.push({
      label:
        running > 0
          ? `Pipeline · running ${running}/${opts.pipelineTotal}`
          : "Pipeline · idle",
      tone: running > 0 ? "profit" : "muted",
      title: running > 0
        ? `${running} of ${opts.pipelineTotal} live strategies are currently dispatching`
        : "Daily pipeline complete — next run at the next market open",
    });
  }
  // Phase-1 / SB-1: trading-mode pill. PAPER = amber (default safety),
  // LIVE = profit-tone with a small dot pulse the StatusBar may animate.
  // The mode is the user's most consequential setting; the pill is the
  // single visual anchor that the chrome is in PAPER vs LIVE state.
  if (opts.tradingMode != null) {
    pills.push({
      label: opts.tradingMode === "live" ? "Mode · LIVE" : "Mode · PAPER",
      tone: opts.tradingMode === "live" ? "profit" : "amber",
      title: opts.tradingMode === "live"
        ? "Real-money trading is ENABLED. Orders dispatched here hit the broker."
        : "Paper-mode active. Orders simulate against the Alpaca paper account; no real money at risk.",
    });
  }
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
