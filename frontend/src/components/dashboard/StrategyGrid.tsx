"use client";

import React, { useState, useEffect } from "react";
import { Activity, Target, LayoutGrid, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { STRATEGY_META, STRATEGY_ORDER, type StrategyGroup } from "@/lib/strategies";
import { safeSetItem, safeGetItem } from "@/lib/storage";

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
  index = 0,
}: {
  strategy: StrategyData;
  regimeLabel: string;
  onClick: () => void;
  index?: number;
}) {
  const meta = STRATEGY_META[strategy.id];
  const Icon = meta?.icon ?? Activity;
  const regimeNote = meta?.regimeNote ?? "";

  return (
    <Card
      className="cursor-pointer border-border bg-[var(--surface)] card-glow hover:bg-[var(--surface)]/80 card-stagger"
      style={{ animationDelay: `${index * 50}ms` }}
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
                {strategy.name}
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
            {/* BUG-028 — manual/discretionary isn't a backtested strategy,
                it's the ledger-backed bucket for user-initiated trades.
                Render an explicit "No backtest — discretionary bucket"
                label so users don't read "—" as "we're still computing"
                next to a 7-position / $57.1K invested book. */}
            {strategy.id === "manual-discretionary" ? (
              <span
                className="text-xs italic text-muted-foreground"
                title="Manual trades are executed at the broker. Return/Sharpe/win-rate are computed from the trade ledger, not a simulated backtest."
              >
                No backtest &mdash; discretionary bucket
              </span>
            ) : strategy.returnPct === 0 && strategy.positions === 0 ? (
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
                  {(strategy.returnPct ?? 0) >= 0 ? "+" : ""}
                  {(strategy.returnPct ?? 0).toFixed(2)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {strategy.positions} active
                  {strategy.returnPct !== 0 && strategy.positions === 0 && (
                    <span className="text-[9px] text-muted-foreground ml-1">(historical)</span>
                  )}
                </span>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {regimeNote}
          </p>
        </div>
        <div className="mt-2 -mx-1">
          {strategy.sparkline && strategy.sparkline.length > 0 ? (
            <Sparkline
              data={strategy.sparkline}
              color={strategy.returnPct >= 0 ? "var(--profit)" : "var(--loss)"}
              width={140}
              height={28}
              className="w-full"
            />
          ) : (
            <div className="flex items-center justify-center h-[28px] w-full">
              <span className="text-[9px] text-muted-foreground/50">No data</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// ─── Compact Strategy Row ────────────────────────────────────

const CompactStrategyRow = React.memo(function CompactStrategyRow({
  strategy,
  onClick,
  index = 0,
}: {
  strategy: StrategyData;
  onClick: () => void;
  index?: number;
}) {
  const meta = STRATEGY_META[strategy.id];
  const Icon = meta?.icon ?? Activity;

  return (
    <button
      onClick={onClick}
      className="card-stagger flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-accent/50"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="shrink-0 rounded bg-[var(--panel)] p-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <span className="flex-1 truncate text-xs font-medium text-foreground">{strategy.shortName}</span>
      <Badge
        variant="outline"
        className={cn(
          "shrink-0 text-[9px] px-1.5 py-0",
          strategy.status === "active"
            ? "border-emerald-500/30 text-emerald-400"
            : "border-amber-500/30 text-amber-400"
        )}
      >
        {strategy.status === "active" ? "On" : "Off"}
      </Badge>
      {strategy.returnPct === 0 && strategy.positions === 0 ? (
        <span className="w-14 text-right text-[10px] tabular-nums text-muted-foreground">&mdash;</span>
      ) : (
        <span className={cn("w-14 text-right text-[10px] font-semibold tabular-nums", strategy.returnPct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
          {(strategy.returnPct ?? 0) >= 0 ? "+" : ""}{(strategy.returnPct ?? 0).toFixed(2)}%
        </span>
      )}
      <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{strategy.positions}p</span>
    </button>
  );
});

// ─── Strategy Grid Panel ─────────────────────────────────────

type ViewMode = "expanded" | "compact";

const VIEW_MODE_KEY = "alphadesk-strategy-view";

interface StrategyGridProps {
  strategies: StrategyData[];
  regimeLabel: string;
  onStrategyClick: (id: string) => void;
}

export function StrategyGrid({ strategies, regimeLabel, onStrategyClick }: StrategyGridProps) {
  // Always start with "expanded" during SSR/hydration to avoid mismatch,
  // then sync from localStorage after mount
  const [viewMode, setViewMode] = useState<ViewMode>("expanded");
  useEffect(() => {
    // Round-11 / BB-22: safeGetItem swallows Safari Private Mode throws.
    if (safeGetItem(VIEW_MODE_KEY) === "compact") setViewMode("compact");
  }, []);

  const toggleView = (mode: ViewMode) => {
    setViewMode(mode);
    // Safari Private Mode / iOS quota-exceeded throws here; don't crash the tree.
    safeSetItem(VIEW_MODE_KEY, mode);
  };

  return (
    <div data-tour="strategy-grid" className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Strategies
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {strategies.filter((s) => s.status === "active").length} active
          </span>
          <div className="flex items-center rounded-md border border-border/50 p-0.5">
            <button
              onClick={() => toggleView("expanded")}
              className={cn(
                "rounded p-1 transition-colors",
                viewMode === "expanded" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              title="Expanded view"
              aria-label="Expanded view"
            >
              <LayoutGrid className="h-3 w-3" />
            </button>
            <button
              onClick={() => toggleView("compact")}
              className={cn(
                "rounded p-1 transition-colors",
                viewMode === "compact" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              title="Compact view"
              aria-label="Compact view"
            >
              <List className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      {viewMode === "expanded" ? (
        <div className="p-3 space-y-4">
          {(["fundamental", "technical", "other"] as StrategyGroup[]).map((group) => {
            const grouped = strategies.filter(
              (s) => (STRATEGY_META[s.id]?.group ?? "other") === group
            );
            if (grouped.length === 0) return null;
            const label = group === "fundamental" ? "Fundamental" : group === "technical" ? "Technical Analysis" : "Other";
            return (
              <div key={group}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {grouped.length}
                  </span>
                  <div className="flex-1 border-t border-border/30" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {grouped.map((strategy, i) => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      regimeLabel={regimeLabel}
                      onClick={() => onStrategyClick(strategy.id)}
                      index={i}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-1.5">
          {(["fundamental", "technical", "other"] as StrategyGroup[]).map((group) => {
            const grouped = strategies.filter(
              (s) => (STRATEGY_META[s.id]?.group ?? "other") === group
            );
            if (grouped.length === 0) return null;
            const label = group === "fundamental" ? "Fundamental" : group === "technical" ? "Technical Analysis" : "Other";
            return (
              <div key={group}>
                <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    {label}
                  </span>
                  <div className="flex-1 border-t border-border/20" />
                </div>
                <div className="divide-y divide-border/30">
                  {grouped.map((strategy, i) => (
                    <CompactStrategyRow
                      key={strategy.id}
                      strategy={strategy}
                      onClick={() => onStrategyClick(strategy.id)}
                      index={i}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
