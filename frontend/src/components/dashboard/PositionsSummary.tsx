"use client";

import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio";
import { useMarketStore } from "@/stores/market";

export function PositionsSummary() {
  const router = useRouter();
  const positions = usePortfolioStore((s) => s.positions);

  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-[var(--panel)] px-4 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Briefcase className="h-4 w-4 text-muted-foreground opacity-30" />
          <span className="text-sm font-semibold text-foreground">Open Positions</span>
        </div>
        <p className="text-hint">No open positions — the pipeline opens trades during market hours</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Open Positions
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">{positions.length} position{positions.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="divide-y divide-border">
        {positions.map((pos) => {
          const isShort = pos.side === "short";
          const pnlPct = pos.avgCost > 0
            ? (isShort ? -1 : 1) * ((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100
            : 0;
          const positive = pos.unrealizedPnl >= 0;
          return (
            <div
              key={pos.symbol}
              className="flex items-center justify-between gap-4 px-4 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => {
                useMarketStore.getState().setSelectedSymbol(pos.symbol);
                router.push("/trade");
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-semibold text-foreground">{pos.symbol}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{pos.quantity} shares</span>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-sm tabular-nums text-foreground">{formatCurrency(pos.currentPrice)}</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">avg {formatCurrency(pos.avgCost)}</p>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className={cn("text-sm font-semibold tabular-nums", positive ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {positive ? "+" : ""}{formatCurrency(pos.unrealizedPnl)}
                  </p>
                  <p className={cn("text-[11px] tabular-nums", positive ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {positive ? "+" : ""}{pnlPct.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
