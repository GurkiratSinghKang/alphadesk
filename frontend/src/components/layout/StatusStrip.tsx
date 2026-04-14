"use client";

import { useState, useEffect } from "react";
import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { useRegime } from "@/hooks/useQueries";

export function StatusStrip() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const summary = usePortfolioStore((s) => s.summary);
  const { isConnected } = useWs();
  const tradingMode = useUIStore((s) => s.tradingMode);

  const { data: regimeData } = useRegime();
  const regime = regimeData?.regime ?? null;

  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;
  const hasPnl = Number.isFinite(summary.dayPnl);

  const regimeColor = regime?.label === "bull" ? "text-[var(--profit)]" : regime?.label === "bear" ? "text-[var(--loss)]" : "text-amber-400";
  const isDemo = regimeData?.is_demo === true;

  if (!mounted) {
    return <div className="flex h-7 shrink-0 items-center border-b border-border bg-[var(--background)] px-4 text-[11px]" />;
  }

  return (
    <div role="status" className="flex h-7 shrink-0 items-center gap-0 border-b border-border bg-[var(--background)] px-4 text-[11px] overflow-x-auto scrollbar-none whitespace-nowrap">
      <div className="flex items-center gap-1.5 pr-4 border-r border-border/50">
        <span className="text-[#8a8a95] font-medium">P&L</span>
        {hasPnl ? (
          <span aria-live="polite" aria-atomic="true" className={cn("font-semibold tabular-nums", dayPnl >= 0 ? "text-[var(--profit)] glow-profit" : "text-[var(--loss)] glow-loss")}>
            <span className="sr-only">{dayPnl >= 0 ? "gain" : "loss"}</span>
            {dayPnl >= 0 ? "+" : ""}<AnimatedNumber value={dayPnl} format={(n) => formatCurrency(Math.abs(n))} />
            <span className="text-muted-foreground ml-1">({dayPnlPct >= 0 ? "+" : ""}<AnimatedNumber value={dayPnlPct} format={(n) => (n ?? 0).toFixed(2)} />%)</span>
          </span>
        ) : (
          <span aria-live="polite" aria-atomic="true" className="text-[#8a8a95] tabular-nums">$--.--</span>
        )}
      </div>
      <div className="hidden md:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-[#8a8a95]">Regime</span>
        <span className={cn("font-medium truncate max-w-[160px]", regime ? regimeColor : "text-[#8a8a95]", isDemo && "opacity-40")}>
          {regime?.regime ?? "---"}
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-[#8a8a95]">VIX</span>
        <span className={cn("tabular-nums font-medium", isDemo ? "text-muted-foreground opacity-40" : "text-foreground")}>
          {regime?.vix_level ? regime.vix_level.toFixed(1) : "--.-"}
        </span>
      </div>
      <span role="status" aria-live="polite" className="flex items-center gap-1.5 px-4 border-r border-border/50">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5" aria-label="Live data connected">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--profit)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
            </span>
            <span className="text-[var(--profit)] font-medium">LIVE</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" aria-label="Live data disconnected" />
            <span className="text-[var(--loss)] font-medium">OFFLINE</span>
          </>
        )}
      </span>
      <div className="flex items-center gap-2 px-4">
        <span className="text-foreground font-medium">Alpaca ({tradingMode === "paper" ? "Paper" : "Live"})</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", tradingMode === "paper" ? "bg-[var(--profit)]/15 text-[var(--profit)]" : "bg-[var(--loss)]/15 text-[var(--loss)]")}>
          {tradingMode}
        </span>
      </div>
    </div>
  );
}
