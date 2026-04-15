"use client";

import { useMemo } from "react";
import { Shield, AlertTriangle, TrendingDown, Activity } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio";

// ─── Types ──────────────────────────────────────────────────

interface RegimeInfo {
  label: string;
  confidence: number;
  vix_level: number;
}

interface RiskDashboardProps {
  regime: RegimeInfo | null;
}

// ─── Regime mapping ─────────────────────────────────────────

function getRegimeDisplay(_label: string, vixLevel?: number): {
  text: string;
  indicator: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  // HIGH-10: Use VIX thresholds for regime label instead of text matching
  const vix = vixLevel ?? 15;

  if (vix > 35) {
    return {
      text: "Defensive",
      indicator: "\u26ab",
      color: "text-muted-foreground",
      bgColor: "bg-[var(--neutral)]/10",
      borderColor: "border-[var(--neutral)]/30",
    };
  }
  if (vix >= 25) {
    return {
      text: "Risk Off",
      indicator: "\ud83d\udd34",
      color: "text-[var(--loss)]",
      bgColor: "bg-[var(--loss)]/10",
      borderColor: "border-[var(--loss)]/30",
    };
  }
  if (vix >= 18) {
    return {
      text: "Caution",
      indicator: "\ud83d\udfe1",
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/30",
    };
  }
  // VIX < 18: Risk On
  return {
    text: "Risk On",
    indicator: "\ud83d\udfe2",
    color: "text-[var(--profit)]",
    bgColor: "bg-[var(--profit)]/10",
    borderColor: "border-[var(--profit)]/30",
  };
}

// ─── Component ──────────────────────────────────────────────

export function RiskDashboard({ regime }: RiskDashboardProps) {
  const positions = usePortfolioStore((s) => s.positions);
  const summary = usePortfolioStore((s) => s.summary);

  // Compute risk metrics from positions
  const metrics = useMemo(() => {
    const equity = summary.equity > 0 ? summary.equity : 100000;
    const totalMarketValue = summary.totalMarketValue;
    const cash = summary.cash;

    // Exposure
    const longExposure = totalMarketValue > 0
      ? Math.min((totalMarketValue / equity) * 100, 100)
      : 0;
    const cashPct = cash > 0 ? Math.min((cash / equity) * 100, 100) : 100 - longExposure;

    // Max position size
    let maxPosPct = 0;
    let maxPosSymbol = "";
    for (const pos of positions) {
      const posPct = equity > 0 ? (Math.abs(pos.marketValue) / equity) * 100 : 0;
      if (posPct > maxPosPct) {
        maxPosPct = posPct;
        maxPosSymbol = pos.symbol;
      }
    }

    // Sector concentration — group by sector, find most concentrated
    const sectorValues: Record<string, number> = {};
    for (const pos of positions) {
      const sector = pos.sector || "Unknown";
      sectorValues[sector] = (sectorValues[sector] ?? 0) + Math.abs(pos.marketValue);
    }
    const totalSectorValue = Object.values(sectorValues).reduce((s, v) => s + v, 0);
    let maxSectorPct = 0;
    let maxSectorName = "N/A";
    for (const [name, val] of Object.entries(sectorValues)) {
      const pct = totalSectorValue > 0 ? (val / totalSectorValue) * 100 : 0;
      if (pct > maxSectorPct) {
        maxSectorPct = pct;
        maxSectorName = name;
      }
    }

    // Simple beta estimate (placeholder — real beta would come from backend)
    const beta = positions.length > 0 ? 1.0 + (positions.length - 3) * 0.05 : 0;
    const clampedBeta = Math.max(0, Math.min(beta, 2.5));

    // VaR from regime VIX level
    const vix = regime?.vix_level ?? 15;
    const dailyVaR = (vix / 100) * Math.sqrt(1 / 252) * equity * 1.65;

    return {
      longExposure,
      cashPct: Math.max(0, cashPct),
      beta: clampedBeta,
      dailyVaR,
      maxPosPct,
      maxPosSymbol,
      maxSectorPct,
      maxSectorName,
    };
  }, [positions, summary, regime]);

  const regimeDisplay = regime
    ? getRegimeDisplay(regime.label, regime.vix_level)
    : { text: "Unknown", indicator: "\u26aa", color: "text-muted-foreground", bgColor: "bg-muted/10", borderColor: "border-border" };

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Risk Overview</h2>
        </div>
        {/* Regime badge */}
        <div className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium",
          regimeDisplay.bgColor,
          regimeDisplay.borderColor,
          regimeDisplay.color,
        )}>
          <span>{regimeDisplay.indicator}</span>
          <span>{regimeDisplay.text}</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Exposure bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Portfolio Exposure</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {(metrics.longExposure ?? 0).toFixed(0)}% invested
            </span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
            <div
              className="bg-[var(--profit)] transition-all duration-500 rounded-l-full"
              style={{ width: `${metrics.longExposure}%` }}
              title={`Long: ${(metrics.longExposure ?? 0).toFixed(1)}%`}
            />
            <div
              className="bg-[var(--neutral)]/40 transition-all duration-500"
              style={{ width: `${metrics.cashPct}%` }}
              title={`Cash: ${(metrics.cashPct ?? 0).toFixed(1)}%`}
            />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
              <span className="text-[9px] text-muted-foreground">Long {(metrics.longExposure ?? 0).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--neutral)]/40" />
              <span className="text-[9px] text-muted-foreground">Cash {(metrics.cashPct ?? 0).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Beta */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Beta</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.beta > 1.3 ? "text-amber-400" : metrics.beta > 0.5 ? "text-foreground" : "text-muted-foreground"
            )}>
              {positions.length > 0 ? (metrics.beta ?? 0).toFixed(2) : "--"}
            </p>
          </div>

          {/* VaR */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingDown className="h-3 w-3 text-muted-foreground" />
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Daily VaR</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.dailyVaR > 5000 ? "text-[var(--loss)]" : "text-foreground"
            )}>
              {positions.length > 0 ? formatCurrency(metrics.dailyVaR) : "--"}
            </p>
          </div>

          {/* Max position */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Max Pos</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.maxPosPct > 20 ? "text-amber-400" : "text-foreground"
            )}>
              {positions.length > 0 ? `${(metrics.maxPosPct ?? 0).toFixed(1)}%` : "--"}
            </p>
            {positions.length > 0 && (
              <p className="text-[9px] text-muted-foreground truncate">{metrics.maxPosSymbol}</p>
            )}
          </div>

          {/* Concentration */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <Shield className="h-3 w-3 text-muted-foreground" />
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Top Sector</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.maxSectorPct > 30 ? "text-amber-400" : "text-foreground"
            )}>
              {positions.length > 0 ? `${(metrics.maxSectorPct ?? 0).toFixed(1)}%` : "--"}
            </p>
            {positions.length > 0 && (
              <p className="text-[9px] text-muted-foreground truncate">{metrics.maxSectorName}</p>
            )}
          </div>
        </div>

        {/* VIX level if available */}
        {regime && (
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <span className="text-[10px] text-muted-foreground">VIX Level</span>
            <span className={cn(
              "text-[11px] font-semibold tabular-nums",
              regime.vix_level < 18 ? "text-[var(--profit)]" :
              regime.vix_level < 25 ? "text-amber-400" :
              "text-[var(--loss)]"
            )}>
              {(regime.vix_level ?? 0).toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
