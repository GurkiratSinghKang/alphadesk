import {
  TrendingUp,
  Activity,
  Zap,
  BarChart3,
  Target,
  Crosshair,
  Brain,
  Shield,
  GitMerge,
  DollarSign,
  PieChart,
  ArrowLeftRight,
  User,
  LineChart,
  ArrowDownUp,
  Layers,
  Gauge,
  Clock,
  CandlestickChart,
} from "lucide-react";

export type StrategyGroup = "fundamental" | "technical" | "other";

/**
 * Implementation stage — mirrors the ``implementation_stage`` helper in
 * ``backend/strategies/registry.py``. Keep the two lists in sync when adding
 * or shipping a strategy.
 *
 *   · "live"    — a real Python package ships under ``backend/strategies/<name>/``
 *                 and the OOS metrics are real.
 *   · "planned" — advertised in the catalogue but no implementation yet; UI
 *                 should render a muted "Coming soon" card instead of an
 *                 "Active" pill.
 *   · "other"   — ledger-backed (manual trades) or otherwise outside the
 *                 live/planned axis. Surface raw status from the API.
 */
export type StrategyStage = "live" | "planned" | "other";

/** Kind — autonomous strategies run in the engine; research entries are
 *  decision-support screeners (no auto-trading). Drives /strategies section
 *  grouping (Active / Research / Coming soon). */
export type StrategyKind = "autonomous" | "research";

export interface StrategyMetaEntry {
  name: string;
  shortName: string;
  icon: typeof Activity;
  regimeNote: string;
  group: StrategyGroup;
  /** Implementation stage (see :type:`StrategyStage`). Defaults to "live"
   *  when omitted so adding a new real package is one line. */
  stage?: StrategyStage;
  /** Strategy kind — defaults to "autonomous" when omitted. */
  kind?: StrategyKind;
}

export const STRATEGY_META: Record<string, StrategyMetaEntry> = {
  // ─── Research Tools ─────────────────────────────────────────
  "earnings-options-play": {
    name: "Earnings Options Play",
    shortName: "Earnings Options",
    icon: CandlestickChart,
    regimeNote: "Research screener · pick your own trade",
    group: "fundamental",
    kind: "research",
  },

  // ─── Fundamental / Options Strategies ──────────────────────
  "momentum-quality": {
    name: "Cross-Sectional Momentum + Quality",
    shortName: "Momentum + Quality",
    icon: TrendingUp,
    regimeNote: "Thrives in bull trends",
    group: "fundamental",
  },
  pead: {
    name: "Post-Earnings Announcement Drift",
    shortName: "PEAD",
    icon: Target,
    regimeNote: "Event-driven, all regimes",
    group: "fundamental",
  },
  "vrp-harvesting": {
    name: "Systematic VRP Harvesting",
    shortName: "VRP Harvesting",
    icon: Shield,
    regimeNote: "Best in low-vol contango",
    group: "fundamental",
  },
  "earnings-vol-premium": {
    name: "Earnings Volatility Premium",
    shortName: "Earnings Vol",
    icon: BarChart3,
    regimeNote: "Options research · live disabled",
    group: "fundamental",
  },
  "regime-adaptive": {
    // Round-6 / I-5: was "HMM Regime-Adaptive Allocation". The backend
    // strategy uses an SMA-cross + VIX-level classifier (see
    // backend/strategies/regime_adaptive/spec.md), not a Hidden-Markov
    // Model. The previous label was aspirational copy that never
    // matched the implementation.
    name: "SMA + VIX Regime Allocation",
    shortName: "Regime Adaptive",
    icon: Brain,
    regimeNote: "Adjusts to any regime",
    group: "fundamental",
  },
  "claude-alpha": {
    name: "Claude Alpha",
    shortName: "Claude Alpha",
    icon: Zap,
    regimeNote: "AI-driven, regime-aware",
    group: "fundamental",
    stage: "planned",
  },
  "dividend-capture": {
    name: "Dividend Capture",
    shortName: "Dividend Capture",
    icon: DollarSign,
    regimeNote: "Income-focused, stable markets",
    group: "fundamental",
    stage: "planned",
  },
  "sector-rotation": {
    name: "Sector Rotation Model",
    shortName: "Sector Rotation",
    icon: PieChart,
    regimeNote: "Trend-following across sectors",
    group: "fundamental",
    stage: "planned",
  },

  // ─── Technical Analysis Strategies ─────────────────────────
  "ts-momentum": {
    name: "Time-Series Momentum",
    shortName: "TS Momentum",
    icon: LineChart,
    regimeNote: "Sign-of-12M ETF momentum",
    group: "technical",
  },
  "rsi2-reversal": {
    name: "RSI-2 Mean Reversion",
    shortName: "RSI-2 Reversal",
    icon: ArrowDownUp,
    regimeNote: "Short-term dip buying, 75% win rate",
    group: "technical",
  },
  "dual-momentum": {
    name: "Dual Momentum",
    shortName: "Dual Momentum",
    icon: Layers,
    regimeNote: "GEM: US / ex-US / bonds",
    group: "technical",
  },
  "pairs-trading": {
    name: "Statistical Arbitrage Pairs",
    shortName: "Pairs Trading",
    icon: GitMerge,
    regimeNote: "Market-neutral, all regimes",
    group: "technical",
  },
  // 2026-04-20 — removed duplicate "pairs-stat-arb" entry. Backend's
  // _ROUTE_TO_REGISTRY aliases it to the same pairs_trading package, and
  // keeping both in STRATEGY_META rendered the same strategy twice on
  // /strategies — once as Active, once as Coming Soon.
  "kama-breakout": {
    name: "KAMA + ATR Breakout",
    shortName: "KAMA Breakout",
    icon: Gauge,
    regimeNote: "Vol-adaptive, squeeze breakouts",
    group: "technical",
  },
  orb: {
    name: "Opening Range Breakout",
    shortName: "ORB",
    icon: Clock,
    regimeNote: "Paper-only intraday breakout",
    group: "technical",
  },
  "vwap-strategy": {
    name: "VWAP Bounce / Breakout",
    shortName: "VWAP Strategy",
    icon: CandlestickChart,
    regimeNote: "Paper-only VWAP pullback",
    group: "technical",
  },
  "mean-reversion": {
    name: "Mean Reversion",
    shortName: "Mean Reversion",
    icon: Activity,
    regimeNote: "Favored in sideways markets",
    group: "technical",
    stage: "planned",
  },
  "vcp-breakout": {
    name: "VCP Breakout",
    shortName: "VCP Breakout",
    icon: Crosshair,
    regimeNote: "Minervini SEPA methodology",
    group: "technical",
    stage: "planned",
  },
  "gap-fill": {
    name: "Overnight Gap Fill",
    shortName: "Gap Fill",
    icon: ArrowLeftRight,
    regimeNote: "Planned intraday concept",
    group: "technical",
    stage: "planned",
  },

  // ─── Other ─────────────────────────────────────────────────
  // Manual/discretionary is NOT a ghost — it's the first-class bucket for
  // user-initiated trades, backed by the trade ledger
  // (``backend/data/ingestion/trade_ledger.py``). Keep ``stage: "other"``.
  "manual-discretionary": {
    name: "Manual / Discretionary",
    shortName: "Manual",
    icon: User,
    regimeNote: "Trader-initiated, all regimes",
    group: "other",
    stage: "other",
  },
};

/**
 * Strategies whose backend implementation is structurally unfit for
 * live capital (research stubs, or pending intraday-data integration).
 * Mirrors ``STRATEGY_LIVE_DISABLED`` in ``backend/core/config.py`` —
 * keep these two lists in sync. Used by the catalog UI to render a
 * "NOT-READY for live" badge instead of an "Active" pill, and by the
 * trade-button row to gate the "Submit Live" toggle.
 *
 * Round-6 / I-16: previously inferred from a missing-id heuristic that
 * silently let paper-only or live-disabled research/screener entries past
 * the gate. Hardcoding the list here keeps the FE contract explicit.
 */
export const LIVE_DISABLED: ReadonlySet<string> = new Set<string>([
  "vrp-harvesting",
  "earnings-vol-premium",
  "earnings-options-play",
]);

/** Strategies routed only to Alpaca paper. Mirror of
 *  ``STRATEGY_PAPER_ONLY`` in ``backend/core/config.py``. */
export const PAPER_ONLY: ReadonlySet<string> = new Set<string>([
  "kama-breakout",
  "orb",
  "vwap-strategy",
  "earnings-options-play",
]);

/** Convenience accessor: treat missing ``stage`` as "live" so callers can
 *  write ``metaStage(id) === "planned"`` without null-handling. */
export function metaStage(id: string): StrategyStage {
  return STRATEGY_META[id]?.stage ?? "live";
}

/** Convenience accessor: treat missing ``kind`` as "autonomous" so callers can
 *  write ``metaKind(id) === "research"`` without null-handling. */
export function metaKind(id: string): StrategyKind {
  return STRATEGY_META[id]?.kind ?? "autonomous";
}

/** True when the strategy ships a real backend implementation (decorator-
 *  registered package). Ghosts and manual return false. */
export function isStrategyLive(id: string): boolean {
  return metaStage(id) === "live";
}

export const STRATEGY_ORDER: string[] = [
  // Research tools (rendered in the Research section, not Active/Coming Soon)
  "earnings-options-play",
  // Fundamental
  "momentum-quality",
  "pead",
  "vrp-harvesting",
  "earnings-vol-premium",
  "regime-adaptive",
  "claude-alpha",
  "dividend-capture",
  "sector-rotation",
  // Technical
  "ts-momentum",
  "rsi2-reversal",
  "dual-momentum",
  "pairs-trading",
  "kama-breakout",
  "orb",
  "vwap-strategy",
  "mean-reversion",
  "vcp-breakout",
  "gap-fill",
  // Other
  "manual-discretionary",
];
