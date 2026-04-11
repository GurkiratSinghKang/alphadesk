"use client";

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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sparkline, generateSparkData } from "@/components/dashboard/Sparkline";

// ─── Types ───────────────────────────────────────────────────

export interface StrategyData {
  id: string;
  name: string;
  shortName: string;
  status: "active" | "paused";
  returnPct: number;
  positions: number;
  winRate: number;
  invested: number;
  icon: typeof Activity;
}

// ─── Constants ───────────────────────────────────────────────

export const STRATEGY_META: Record<string, { name: string; shortName: string; icon: typeof Activity; regimeNote: string }> = {
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

export const STRATEGY_ORDER = [
  "momentum-quality",
  "pead",
  "vrp-harvesting",
  "earnings-vol-premium",
  "regime-adaptive",
  "claude-alpha",
  "mean-reversion",
  "vcp-breakout",
];

// ─── Strategy Card Component ─────────────────────────────────

function StrategyCard({
  strategy,
  regimeLabel,
  onClick,
}: {
  strategy: StrategyData;
  regimeLabel: string;
  onClick: () => void;
}) {
  const meta = STRATEGY_META[strategy.id];
  const Icon = meta?.icon ?? Activity;
  const regimeNote = meta?.regimeNote ?? "";

  return (
    <Card
      className="cursor-pointer border-border bg-[var(--surface)] card-glow hover:bg-[var(--surface)]/80"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-md bg-[var(--panel)] p-1.5">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {strategy.shortName}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-xs",
              strategy.status === "active"
                ? "border-emerald-500/30 text-emerald-400"
                : "border-amber-500/30 text-amber-400"
            )}
          >
            {strategy.status === "active" ? "Active" : "Paused"}
          </Badge>
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                strategy.returnPct >= 0
                  ? "text-[var(--profit)]"
                  : "text-[var(--loss)]"
              )}
            >
              {strategy.returnPct >= 0 ? "+" : ""}
              {strategy.returnPct.toFixed(2)}%
            </span>
            <span className="text-xs text-muted-foreground">
              {strategy.positions} pos
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {regimeNote}
          </p>
        </div>
        {strategy.returnPct !== 0 || strategy.positions > 0 ? (
          <div className="mt-2 -mx-1">
            <Sparkline
              data={generateSparkData(strategy.id.length * 31 + strategy.id.charCodeAt(0), 30)}
              color={strategy.returnPct >= 0 ? "#22c55e" : "#ef4444"}
              width={140}
              height={28}
              className="w-full"
            />
          </div>
        ) : (
          <div className="mt-2 h-[28px]" />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Strategy Grid Panel ─────────────────────────────────────

interface StrategyGridProps {
  strategies: StrategyData[];
  regimeLabel: string;
  onStrategyClick: (id: string) => void;
}

export function StrategyGrid({ strategies, regimeLabel, onStrategyClick }: StrategyGridProps) {
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Strategies
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {strategies.filter((s) => s.status === "active").length} active
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {strategies.map((strategy) => (
          <StrategyCard
            key={strategy.id}
            strategy={strategy}
            regimeLabel={regimeLabel}
            onClick={() => onStrategyClick(strategy.id)}
          />
        ))}
      </div>
    </div>
  );
}
