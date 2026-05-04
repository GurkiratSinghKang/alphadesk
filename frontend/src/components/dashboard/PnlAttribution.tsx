"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { StrategyData } from "@/components/dashboard/StrategyGrid";

// ─── Component ──────────────────────────────────────────────

interface PnlAttributionProps {
  strategies: StrategyData[];
}

interface StrategyPnl {
  id: string;
  shortName: string;
  invested: number;
  returnPct: number;
  dollarPnl: number;
  contributionPct: number;
}

export function PnlAttribution({ strategies }: PnlAttributionProps) {
  const router = useRouter();
  const { items, totalPnl } = useMemo(() => {
    // Compute dollar P&L from invested_amount and total_return_pct
    const withPnl: StrategyPnl[] = strategies
      .filter((s) => s.invested > 0 || s.returnPct !== 0)
      .map((s) => ({
        id: s.id,
        shortName: s.shortName,
        invested: s.invested,
        returnPct: s.returnPct,
        dollarPnl: s.invested * (s.returnPct / 100),
        contributionPct: 0,
      }))
      .filter((s) => Math.abs(s.dollarPnl) > 0.01);

    const total = withPnl.reduce((sum, s) => sum + s.dollarPnl, 0);

    // Compute percentage contribution (of total absolute P&L for meaningful ratios)
    const totalAbs = withPnl.reduce((sum, s) => sum + Math.abs(s.dollarPnl), 0);
    for (const s of withPnl) {
      s.contributionPct = totalAbs > 0 ? (s.dollarPnl / totalAbs) * 100 : 0;
    }

    // Sort by dollar P&L descending (most profitable first)
    withPnl.sort((a, b) => b.dollarPnl - a.dollarPnl);

    return { items: withPnl, totalPnl: total };
  }, [strategies]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">P&L Attribution</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-8">
          <p className="text-xs text-muted-foreground">No strategy P&L data yet.</p>
          <p className="text-label text-muted-foreground mt-1">
            Attribution appears once strategies hold positions.
          </p>
          <button
            onClick={() => router.push("/strategies")}
            className="mt-2 text-label text-[var(--primary)] hover:underline"
          >
            Configure strategies &rarr;
          </button>
        </div>
      </div>
    );
  }

  const maxAbsPnl = Math.max(...items.map((s) => Math.abs(s.dollarPnl)), 1);

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            P&L Attribution
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Total: </span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                totalPnl > 0
                  ? "text-[var(--profit)]"
                  : totalPnl < 0
                  ? "text-[var(--loss)]"
                  : "text-muted-foreground"
              )}
            >
              {totalPnl >= 0 ? "+" : ""}
              {formatCurrency(totalPnl)}
            </span>
            <p className="text-label text-muted-foreground">All-time P&L</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {items.map((s) => {
          const isPositive = s.dollarPnl >= 0;
          const barWidth = Math.max((Math.abs(s.dollarPnl) / maxAbsPnl) * 100, 2);

          return (
            <div key={s.id} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-foreground truncate max-w-[140px]" title={s.shortName}>
                  {s.shortName}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs tabular-nums font-medium",
                      isPositive ? "text-[var(--profit)]" : "text-[var(--loss)]"
                    )}
                  >
                    {isPositive ? "+" : ""}
                    {formatCurrency(s.dollarPnl)}
                  </span>
                  <span className="text-label tabular-nums text-muted-foreground w-12 text-right">
                    {s.contributionPct >= 0 ? "+" : ""}
                    {(s.contributionPct ?? 0).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-4 w-full rounded-sm bg-[var(--surface)] overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-sm transition-all duration-300",
                    isPositive ? "bg-[var(--profit)]/60" : "bg-[var(--loss)]/60"
                  )}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
