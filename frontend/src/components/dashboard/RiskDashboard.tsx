"use client";

import { useMemo } from "react";
import { Shield, AlertTriangle, TrendingDown, Activity } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio";

// ─── Types ──────────────────────────────────────────────────

interface RegimeInfo {
  regime?: string;       // Human-readable name from backend (e.g. "Bull Market")
  label: string;         // Normalized label from backend (e.g. "bull", "bear", "neutral")
  confidence: number;
  vix_level: number;
  description?: string;
}

interface RiskDashboardProps {
  regime: RegimeInfo | null;
}

// ─── Regime mapping ─────────────────────────────────────────

// Rough beta estimates for well-known tickers (used when backend doesn't provide betas)
const KNOWN_BETAS: Record<string, number> = {
  SPY: 1.0, QQQ: 1.2, IWM: 1.15, DIA: 0.95,
  AAPL: 1.2, MSFT: 0.9, GOOGL: 1.1, GOOG: 1.1, AMZN: 1.15, META: 1.3,
  NVDA: 1.7, TSLA: 2.0, AMD: 1.7, INTC: 1.0, NFLX: 1.3, AVGO: 1.2,
  CRM: 1.15, ADBE: 1.1, QCOM: 1.2, MU: 1.5,
  JPM: 1.1, BAC: 1.3, GS: 1.3, WFC: 1.1, MS: 1.4,
  JNJ: 0.55, PG: 0.45, KO: 0.55, PEP: 0.6, MRK: 0.5, UNH: 0.7,
  XOM: 0.9, CVX: 0.85, COP: 1.1,
  V: 0.95, MA: 1.05, PYPL: 1.4,
  XLK: 1.2, XLF: 1.1, XLE: 0.9, XLV: 0.7, XLP: 0.5, XLU: 0.4,
  BRK: 0.6, "BRK.B": 0.6,
  VZ: 0.4, T: 0.6, WMT: 0.5, LLY: 0.65, ABBV: 0.6,
};

/** Estimate portfolio-weighted beta from known betas; returns null if no positions have known betas. */
function estimatePortfolioBeta(
  positions: { symbol: string; marketValue: number }[]
): number | null {
  let weightedBeta = 0;
  let totalKnownValue = 0;

  for (const pos of positions) {
    const ticker = pos.symbol.toUpperCase();
    const beta = KNOWN_BETAS[ticker];
    if (beta !== undefined) {
      const absVal = Math.abs(pos.marketValue);
      weightedBeta += beta * absVal;
      totalKnownValue += absVal;
    }
  }

  if (totalKnownValue === 0) return null;
  return weightedBeta / totalKnownValue;
}

function getRegimeDisplay(label: string, _vixLevel?: number): {
  text: string;
  indicator: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  // Use the backend's textual regime label for display
  const normalized = label.toLowerCase();

  if (normalized === "bear" || normalized === "crisis") {
    return {
      text: "Risk Off",
      indicator: "\ud83d\udd34",
      color: "text-[var(--loss)]",
      bgColor: "bg-[var(--loss)]/10",
      borderColor: "border-[var(--loss)]/30",
    };
  }
  if (normalized === "bull") {
    return {
      text: "Risk On",
      indicator: "\ud83d\udfe2",
      color: "text-[var(--profit)]",
      bgColor: "bg-[var(--profit)]/10",
      borderColor: "border-[var(--profit)]/30",
    };
  }
  if (normalized === "neutral" || normalized === "correction") {
    return {
      text: "Caution",
      indicator: "\ud83d\udfe1",
      color: "text-amber",
      bgColor: "bg-amber/10",
      borderColor: "border-amber/30",
    };
  }
  // Fallback: unknown label
  return {
    text: label || "Unknown",
    indicator: "\u26aa",
    color: "text-muted-foreground",
    bgColor: "bg-[var(--neutral)]/10",
    borderColor: "border-[var(--neutral)]/30",
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

    // Portfolio-weighted beta from known stock betas (null if no known tickers)
    const betaEstimate = positions.length > 0 ? estimatePortfolioBeta(positions) : null;

    // Position-level VaR: sum of per-position VaR using individual volatility estimates
    // For each position, estimate annualized vol from its beta relative to market vol (VIX)
    const vix = regime?.vix_level ?? 15;
    const marketDailyVol = (vix / 100) / Math.sqrt(252); // daily market vol
    let portfolioVariance = 0;
    for (const pos of positions) {
      const ticker = pos.symbol.toUpperCase();
      const posBeta = KNOWN_BETAS[ticker] ?? 1.0; // assume beta=1 for unknowns
      const posDailyVol = posBeta * marketDailyVol;
      const posValue = Math.abs(pos.marketValue);
      // Variance contribution (simplified — assumes no correlation adjustment beyond beta)
      portfolioVariance += (posDailyVol * posValue) ** 2;
    }
    // 95% VaR = 1.65 * portfolio daily std dev
    const dailyVaR = positions.length > 0 ? 1.65 * Math.sqrt(portfolioVariance) : 0;

    return {
      longExposure,
      cashPct: Math.max(0, cashPct),
      betaEstimate,
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
          "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium",
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
            <span className="text-[12px] uppercase tracking-wider text-muted-foreground font-medium">Portfolio Exposure</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
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
              <span className="text-[12px] text-muted-foreground">Long {(metrics.longExposure ?? 0).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--neutral)]/40" />
              <span className="text-[12px] text-muted-foreground">Cash {(metrics.cashPct ?? 0).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Beta */}
          <div
            className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2"
            title={
              metrics.betaEstimate == null
                ? "Beta calculation requires historical returns data. Showing N/A because no positions match known tickers."
                : "Estimated from known stock betas, portfolio-weighted. Not a substitute for regression-based beta."
            }
          >
            <div className="flex items-center gap-1 mb-0.5">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Beta{metrics.betaEstimate != null ? " (est)" : ""}
              </span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.betaEstimate == null
                ? "text-muted-foreground"
                : metrics.betaEstimate > 1.3 ? "text-amber" : metrics.betaEstimate > 0.5 ? "text-foreground" : "text-muted-foreground"
            )}>
              {positions.length === 0
                ? "--"
                : metrics.betaEstimate != null
                  ? metrics.betaEstimate.toFixed(2)
                  : "N/A"}
            </p>
          </div>

          {/* VaR */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingDown className="h-3 w-3 text-muted-foreground" />
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground">Daily VaR</span>
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
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground">Max Pos</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.maxPosPct > 20 ? "text-amber" : "text-foreground"
            )}>
              {positions.length > 0 ? `${(metrics.maxPosPct ?? 0).toFixed(1)}%` : "--"}
            </p>
            {positions.length > 0 && (
              <p className="text-[12px] text-muted-foreground truncate">{metrics.maxPosSymbol}</p>
            )}
          </div>

          {/* Concentration */}
          <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              <Shield className="h-3 w-3 text-muted-foreground" />
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground">Top Sector</span>
            </div>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              metrics.maxSectorPct > 30 ? "text-amber" : "text-foreground"
            )}>
              {positions.length > 0 ? `${(metrics.maxSectorPct ?? 0).toFixed(1)}%` : "--"}
            </p>
            {positions.length > 0 && (
              <p className="text-[12px] text-muted-foreground truncate">{metrics.maxSectorName}</p>
            )}
          </div>
        </div>

        {/* VIX level if available */}
        {regime && (
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <span className="text-[12px] text-muted-foreground">VIX Level</span>
            <span className={cn(
              "text-[12px] font-semibold tabular-nums",
              regime.vix_level < 18 ? "text-[var(--profit)]" :
              regime.vix_level < 25 ? "text-amber" :
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
