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

export interface StrategyMetaEntry {
  name: string;
  shortName: string;
  icon: typeof Activity;
  regimeNote: string;
  group: StrategyGroup;
  /** Implementation stage (see :type:`StrategyStage`). Defaults to "live"
   *  when omitted so adding a new real package is one line. */
  stage?: StrategyStage;
}

export const STRATEGY_META: Record<string, StrategyMetaEntry> = {
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
    regimeNote: "Paused in high-vol regimes",
    group: "fundamental",
  },
  "regime-adaptive": {
    name: "HMM Regime-Adaptive Allocation",
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
    regimeNote: "200-SMA trend following, crisis alpha",
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
    regimeNote: "Top-quintile relative strength",
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
    regimeNote: "Intraday, first 30-min range",
    group: "technical",
  },
  "vwap-strategy": {
    name: "VWAP Bounce / Breakout",
    shortName: "VWAP Strategy",
    icon: CandlestickChart,
    regimeNote: "Institutional benchmark levels",
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
    regimeNote: "Intraday, paused after hours",
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

/** Convenience accessor: treat missing ``stage`` as "live" so callers can
 *  write ``metaStage(id) === "planned"`` without null-handling. */
export function metaStage(id: string): StrategyStage {
  return STRATEGY_META[id]?.stage ?? "live";
}

/** True when the strategy ships a real backend implementation (decorator-
 *  registered package). Ghosts and manual return false. */
export function isStrategyLive(id: string): boolean {
  return metaStage(id) === "live";
}

export const STRATEGY_ORDER: string[] = [
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
