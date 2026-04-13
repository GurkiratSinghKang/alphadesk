"use client";

import { useState, useEffect } from "react";
import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";
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

  // Determine if US equity market is likely open (ET hours, approximate)
  const now = new Date();
  const etHour = now.getUTCHours() - 4; // rough ET offset
  const dayOfWeek = now.getUTCDay();
  const isMarketOpen = dayOfWeek >= 1 && dayOfWeek <= 5 && etHour >= 9.5 && etHour < 16;
  const demoLabel = isMarketOpen ? "{demoLabel}" : "(Market closed)";

  const regimeColor = regime?.label === "bull" ? "text-[var(--profit)]" : regime?.label === "bear" ? "text-[var(--loss)]" : "text-amber-400";

  if (!mounted) {
    return <div className="flex h-7 shrink-0 items-center border-b border-border bg-[var(--background)] px-4 text-[11px]" />;
  }

  return (
    <div role="status" className="flex h-7 shrink-0 items-center gap-0 border-b border-border bg-[var(--background)] px-4 text-[11px]">
      <div className="flex items-center gap-1.5 pr-4 border-r border-border/50">
        <span className="text-[#8a8a95] font-medium">P&L</span>
        {hasPnl ? (
          <span aria-live="polite" aria-atomic="true" className={cn("font-semibold tabular-nums", dayPnl >= 0 ? "text-[var(--profit)] glow-profit" : "text-[var(--loss)] glow-loss")}>
            <span className="sr-only">{dayPnl >= 0 ? "gain" : "loss"}</span>
            {dayPnl >= 0 ? "+" : ""}{formatCurrency(dayPnl)}
            <span className="text-secondary ml-1">({dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%)</span>
          </span>
        ) : (
          <span aria-live="polite" aria-atomic="true" className="text-[#8a8a95] tabular-nums">$--.--</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-[#8a8a95]">Regime</span>
        <span className={cn("font-medium truncate max-w-[160px]", regime ? regimeColor : "text-[#8a8a95]")}>
          {regime?.regime ?? "---"}
          {regimeData?.is_demo && <span className="ml-1 text-amber-400 text-[9px] font-normal">{demoLabel}</span>}
        </span>
      </div>
      <div className="flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-[#8a8a95]">VIX</span>
        <span className={cn("tabular-nums font-medium", regimeData?.is_demo ? "text-muted-foreground" : "text-foreground")}>
          {regime?.vix_level ? regime.vix_level.toFixed(1) : "--.-"}
          {regimeData?.is_demo && <span className="ml-1 text-amber-400 text-[9px] font-normal">{demoLabel}</span>}
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
