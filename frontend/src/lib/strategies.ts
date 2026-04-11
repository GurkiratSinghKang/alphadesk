import {
  TrendingUp,
  Activity,
  Zap,
  BarChart3,
  Target,
  Crosshair,
  Brain,
  Shield,
} from "lucide-react";

export const STRATEGY_META: Record<
  string,
  { name: string; shortName: string; icon: typeof Activity; regimeNote: string }
> = {
  "momentum-quality": {
    name: "Cross-Sectional Momentum + Quality",
    shortName: "Momentum + Quality",
    icon: TrendingUp,
    regimeNote: "Thrives in bull trends",
  },
  pead: {
    name: "Post-Earnings Announcement Drift",
    shortName: "PEAD",
    icon: Target,
    regimeNote: "Event-driven, all regimes",
  },
  "vrp-harvesting": {
    name: "Systematic VRP Harvesting",
    shortName: "VRP Harvesting",
    icon: Shield,
    regimeNote: "Best in low-vol contango",
  },
  "earnings-vol-premium": {
    name: "Earnings Volatility Premium",
    shortName: "Earnings Vol",
    icon: BarChart3,
    regimeNote: "Paused in high-vol regimes",
  },
  "regime-adaptive": {
    name: "HMM Regime-Adaptive Allocation",
    shortName: "Regime Adaptive",
    icon: Brain,
    regimeNote: "Adjusts to any regime",
  },
  "claude-alpha": {
    name: "Claude Alpha",
    shortName: "Claude Alpha",
    icon: Zap,
    regimeNote: "AI-driven, regime-aware",
  },
  "mean-reversion": {
    name: "Mean Reversion",
    shortName: "Mean Reversion",
    icon: Activity,
    regimeNote: "Favored in sideways markets",
  },
  "vcp-breakout": {
    name: "VCP Breakout",
    shortName: "VCP Breakout",
    icon: Crosshair,
    regimeNote: "Needs bull momentum",
  },
};

export const STRATEGY_ORDER: string[] = [
  "momentum-quality",
  "pead",
  "vrp-harvesting",
  "earnings-vol-premium",
  "regime-adaptive",
  "claude-alpha",
  "mean-reversion",
  "vcp-breakout",
];
