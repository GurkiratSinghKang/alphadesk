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

export const STRATEGY_META: Record<
  string,
  { name: string; shortName: string; icon: typeof Activity; regimeNote: string; group: StrategyGroup }
> = {
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
  },
  "dividend-capture": {
    name: "Dividend Capture",
    shortName: "Dividend Capture",
    icon: DollarSign,
    regimeNote: "Income-focused, stable markets",
    group: "fundamental",
  },
  "sector-rotation": {
    name: "Sector Rotation Model",
    shortName: "Sector Rotation",
    icon: PieChart,
    regimeNote: "Trend-following across sectors",
    group: "fundamental",
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
  "pairs-stat-arb": {
    name: "Statistical Arbitrage Pairs",
    shortName: "Pairs Stat Arb",
    icon: GitMerge,
    regimeNote: "Market-neutral cointegration",
    group: "technical",
  },
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
  },
  "vcp-breakout": {
    name: "VCP Breakout",
    shortName: "VCP Breakout",
    icon: Crosshair,
    regimeNote: "Minervini SEPA methodology",
    group: "technical",
  },
  "gap-fill": {
    name: "Overnight Gap Fill",
    shortName: "Gap Fill",
    icon: ArrowLeftRight,
    regimeNote: "Intraday, paused after hours",
    group: "technical",
  },

  // ─── Other ─────────────────────────────────────────────────
  "manual-discretionary": {
    name: "Manual / Discretionary",
    shortName: "Manual",
    icon: User,
    regimeNote: "Trader-initiated, all regimes",
    group: "other",
  },
};

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
  "pairs-stat-arb",
  "kama-breakout",
  "orb",
  "vwap-strategy",
  "mean-reversion",
  "vcp-breakout",
  "gap-fill",
  // Other
  "manual-discretionary",
];
