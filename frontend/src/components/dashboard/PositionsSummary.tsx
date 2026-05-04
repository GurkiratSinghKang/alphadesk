"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio";
import { useMarketStore } from "@/stores/market";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { getBars } from "@/lib/api";

export function PositionsSummary() {
  const router = useRouter();
  const positions = usePortfolioStore((s) => s.positions);
  const [sparkData, setSparkData] = useState<Record<string, number[]>>({});
  // Track which symbols have already been fetched to avoid refetch spam
  const fetchedSymbolsRef = useRef<Set<string>>(new Set());

  // Fetch 20-day bars only for NEW position symbols
  useEffect(() => {
    if (positions.length === 0) return;
    let cancelled = false;

    const newSymbols = positions
      .map((p) => p.symbol)
      .filter((sym) => !fetchedSymbolsRef.current.has(sym));

    if (newSymbols.length === 0) return;

    // Mark as fetched immediately to prevent duplicate requests
    for (const sym of newSymbols) {
      fetchedSymbolsRef.current.add(sym);
    }

    Promise.allSettled(
      newSymbols.map((sym) =>
        getBars(sym, "D", 20)
          .then((bars) => ({ symbol: sym, closes: bars.map((b) => b.close) }))
          .catch(() => ({ symbol: sym, closes: [] as number[] }))
      )
    ).then((results) => {
      if (cancelled) return;
      const newData: Record<string, number[]> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.closes.length > 0) {
          newData[r.value.symbol] = r.value.closes;
        }
      }
      if (Object.keys(newData).length > 0) {
        setSparkData((prev) => ({ ...prev, ...newData }));
      }
    });
    return () => { cancelled = true; };
  }, [positions]);

  if (positions.length === 0) {
    return (
      <div data-tour="positions-summary" className="rounded-xl border border-border bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Open Positions</h2>
        </div>
        <div className="px-4 py-4">
          <p className="text-hint">No open positions — the pipeline opens trades during market hours</p>
        </div>
      </div>
    );
  }

  return (
    <div data-tour="positions-summary" className="rounded-xl border border-border bg-[var(--panel)]">
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
                {sparkData[pos.symbol] && sparkData[pos.symbol].length >= 2 && (
                  <Sparkline
                    data={sparkData[pos.symbol]}
                    color={positive ? "var(--profit)" : "var(--loss)"}
                    width={60}
                    height={20}
                    className="shrink-0 hidden sm:block"
                  />
                )}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-sm tabular-nums text-foreground">{formatCurrency(pos.currentPrice)}</p>
                  <p className="text-label tabular-nums text-muted-foreground">avg {formatCurrency(pos.avgCost)}</p>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className={cn("text-sm font-semibold tabular-nums", positive ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {positive ? "+" : ""}{formatCurrency(pos.unrealizedPnl)}
                  </p>
                  <p className={cn("text-label tabular-nums", positive ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {positive ? "+" : ""}{(pnlPct ?? 0).toFixed(2)}%
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
