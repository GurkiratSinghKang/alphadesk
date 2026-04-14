"use client";

import React from "react";
import { Activity, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { STRATEGY_META, STRATEGY_ORDER } from "@/lib/strategies";

export { STRATEGY_META, STRATEGY_ORDER };

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
  sparkline: number[];
}

// ─── Strategy Card Component ─────────────────────────────────

const StrategyCard = React.memo(function StrategyCard({
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
              <p className="truncate text-sm font-medium text-foreground" title={strategy.name}>
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
            {strategy.returnPct === 0 && strategy.positions === 0 ? (
              <>
                <span className="text-sm text-muted-foreground">&mdash;</span>
                <span className="text-xs text-muted-foreground">No positions</span>
              </>
            ) : (
              <>
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
                  {strategy.positions} active
                </span>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {regimeNote}
          </p>
        </div>
        <div className="mt-2 -mx-1">
          <Sparkline
            data={(strategy.sparkline && strategy.sparkline.length > 0) ? strategy.sparkline : [0, 0, 0, 0, 0]}
            color={strategy.returnPct >= 0 ? "var(--profit)" : "var(--loss)"}
            width={140}
            height={28}
            className="w-full"
          />
        </div>
      </CardContent>
    </Card>
  );
});

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
