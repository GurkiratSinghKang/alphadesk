"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { useRegime, usePortfolioSummary } from "@/hooks/useQueries";

export function StatusStrip() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const summary = usePortfolioStore((s) => s.summary);
  const { isConnected } = useWs();
  const tradingMode = useUIStore((s) => s.tradingMode);

  const { data: regimeData } = useRegime();
  const regime = regimeData?.regime ?? null;
  // Wave 3N persona-94 #8: portfolio summary exposes its own `is_demo`
  // flag — when the user has no Alpaca creds, we want to light up the
  // banner regardless of whether regime data has loaded yet.
  const { data: portfolioResp } = usePortfolioSummary();

  const hasSummary =
    summary.is_demo !== undefined ||
    Boolean(summary.lastUpdated) ||
    summary.equity > 0 ||
    summary.buyingPower > 0 ||
    summary.positionsCount > 0;
  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;
  const hasPnl = hasSummary && Number.isFinite(summary.dayPnl);
  const signedCurrency = (n: number) => {
    const value = Number.isFinite(n) ? n : 0;
    if (value > 0) return `+${formatCurrency(value)}`;
    if (value < 0) return `-${formatCurrency(Math.abs(value))}`;
    return formatCurrency(0);
  };
  const signedPercent = (n: number) => {
    const value = Number.isFinite(n) ? n : 0;
    if (value > 0) return `+${value.toFixed(2)}`;
    if (value < 0) return `-${Math.abs(value).toFixed(2)}`;
    return value.toFixed(2);
  };

  const regimeColor = regime?.label === "bull" ? "text-[var(--profit)]" : regime?.label === "bear" ? "text-[var(--loss)]" : "text-amber";
  const isDemo =
    regimeData?.is_demo === true ||
    (portfolioResp as { is_demo?: boolean } | undefined)?.is_demo === true;

  if (!mounted) {
    return <div className="flex h-7 shrink-0 items-center border-b border-border bg-[var(--background)] px-4 text-[12px]" />;
  }

  return (
    <div role="status" className="flex h-7 shrink-0 items-center gap-0 border-b border-border bg-[var(--background)] px-4 text-[12px] overflow-x-auto scrollbar-none whitespace-nowrap">
      <div className="flex items-center gap-1.5 pr-4 border-r border-border/50">
        <span className="text-fg-muted font-medium">P&L</span>
        {hasPnl ? (
          <span aria-live="polite" aria-atomic="true" className={cn("font-semibold tabular-nums", dayPnl > 0 ? "text-[var(--profit)] glow-profit" : dayPnl < 0 ? "text-[var(--loss)] glow-loss" : "text-muted-foreground")}>
            <span className="sr-only">{dayPnl > 0 ? "gain" : dayPnl < 0 ? "loss" : "flat"}</span>
            <AnimatedNumber value={dayPnl} format={signedCurrency} />
            <span className="text-muted-foreground ml-1">(<AnimatedNumber value={dayPnlPct} format={signedPercent} />%)</span>
          </span>
        ) : (
          <span aria-live="polite" aria-atomic="true" className="text-fg-muted tabular-nums">$--.--</span>
        )}
      </div>
      <div className="hidden md:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-fg-muted">Regime</span>
        <span className={cn("font-medium truncate max-w-[160px]", regime ? regimeColor : "text-fg-muted", isDemo && "opacity-40")}>
          {regime?.regime ?? "---"}
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-fg-muted">VIX</span>
        <span className={cn("tabular-nums font-medium", isDemo ? "text-muted-foreground opacity-40" : "text-foreground")}>
          {regime?.vix_level ? regime.vix_level.toFixed(1) : "--.-"}
        </span>
      </div>
      {/* BUG-007: the green-dot indicator marks websocket stream health,
          not real-money live trading. Reserve "LIVE" for the real live-
          trading mode (see Alpaca (Paper|Live) cell to the right) and
          label this pill STREAMING / OFFLINE so it can't be mistaken. */}
      <span role="status" aria-live="polite" className="flex items-center gap-1.5 px-4 border-r border-border/50">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5" aria-label="Streaming data connected">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--profit)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
            </span>
            <span className="text-[var(--profit)] font-medium">STREAMING</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" aria-label="Streaming data disconnected" />
            <span className="text-[var(--loss)] font-medium">OFFLINE</span>
          </>
        )}
      </span>
      {/* BUG-043 — the PAPER badge's uppercase tracking crept close to
          the Trade nav-tab highlight on narrow viewports. Add a small
          inline-flex gap + relative/isolate so the badge's border-box
          can never overlap a sibling component's hover outline, and
          reserve a hair of right padding against the strip edge so the
          letter spacing doesn't push the last glyph into the overflow
          scroll track. */}
      <div className="relative isolate flex items-center gap-2 px-4 pr-5">
        <span className="text-foreground font-medium">Alpaca ({tradingMode === "paper" ? "Paper" : "Live"})</span>
        <span className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none",
          tradingMode === "paper"
            ? "bg-[var(--profit)]/15 text-[var(--profit)]"
            : "bg-[var(--loss)]/15 text-[var(--loss)]"
        )}>
          {tradingMode}
        </span>
      </div>
      {/* Wave 3N persona-94 #8: `is_demo` is the backend's signal that
          no Alpaca credentials are configured. Don't just mute the other
          cells — tell the user what state they're in and link them to
          the fix path. Rendered last so it sits at the right edge of the
          strip and doesn't re-layout the P&L cluster. */}
      {isDemo && (
        <Link
          href="/settings"
          className="ml-auto flex items-center gap-1.5 border-l border-border/50 pl-4 text-amber hover:text-foreground"
          title="AlphaDesk hasn't seen Alpaca credentials yet. Click to configure."
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber"
            aria-hidden
          />
          <span className="font-semibold uppercase tracking-wider text-[9px]">
            Demo data
          </span>
          <span className="hidden sm:inline text-[10px] text-muted-foreground">
            · link Alpaca in /settings
          </span>
        </Link>
      )}
    </div>
  );
}
