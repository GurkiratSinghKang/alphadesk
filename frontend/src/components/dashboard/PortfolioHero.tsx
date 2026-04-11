"use client";

import { Clock } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, cn } from "@/lib/utils";

interface PortfolioHeroProps {
  portfolioValue: number;
  dayPnl: number;
  dayPnlPct: number;
  regimeLabel: string;
  regimeName: string;
  regimeBadgeColor: string;
  vixLevel: number;
  vixChangePct: number | null;
  pipelineSummaryText: string;
  wsConnected: boolean;
}

export function PortfolioHero({
  portfolioValue,
  dayPnl,
  dayPnlPct,
  regimeLabel,
  regimeName,
  regimeBadgeColor,
  vixLevel,
  vixChangePct,
  pipelineSummaryText,
  wsConnected,
}: PortfolioHeroProps) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-r from-[var(--surface)] via-[var(--panel)]/30 to-[var(--surface)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Portfolio Equity */}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
            Portfolio
          </p>
          <p className="text-4xl font-bold text-foreground tabular-nums leading-none tracking-tight text-gradient">
            {formatCurrency(portfolioValue)}
          </p>
        </div>

        <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

        {/* Day P&L */}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
            Day P&L
          </p>
          <p
            className={cn(
              "text-xl font-semibold tabular-nums leading-none",
              dayPnl >= 0 ? "text-[var(--profit)] glow-profit" : "text-[var(--loss)] glow-loss"
            )}
          >
            {dayPnl >= 0 ? "+" : ""}
            {formatCurrency(dayPnl)}{" "}
            <span className="text-sm font-normal">
              ({dayPnlPct >= 0 ? "+" : ""}
              {dayPnlPct.toFixed(2)}%)
            </span>
          </p>
        </div>

        <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

        {/* Market Regime Badge */}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
            Regime
          </p>
          <Badge
            variant="outline"
            className={cn("text-sm font-medium px-3 py-0.5", regimeBadgeColor)}
          >
            {regimeName}
          </Badge>
        </div>

        <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

        {/* VIX */}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
            VIX
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-semibold tabular-nums text-foreground leading-none">
              {vixLevel.toFixed(1)}
            </span>
            {vixChangePct !== null && (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  vixChangePct <= 0
                    ? "text-[var(--profit)]"
                    : "text-[var(--loss)]"
                )}
              >
                {vixChangePct <= 0 ? "\u2193" : "\u2191"}
                {Math.abs(vixChangePct).toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

        {/* Pipeline Status */}
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
            Pipeline
          </p>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground truncate">
              {pipelineSummaryText}
            </span>
          </div>
        </div>

        {/* WebSocket Indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          {wsConnected ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs text-emerald-400">Live</span>
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-xs text-red-400">Offline</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
