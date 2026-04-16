"use client";

import { useState, useMemo } from "react";
import {
  Zap,
  TrendingDown,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  Shield,
  AlertTriangle,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio";

// ─── Types ──────────────────────────────────────────────────

interface StressScenario {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  modifier: (pos: { symbol: string; sector?: string }) => number; // returns multiplier per position
  color: string;
}

interface StressedPosition {
  symbol: string;
  currentValue: number;
  stressedValue: number;
  impact: number;
  impactPct: number;
}

interface StressResult {
  totalCurrentValue: number;
  totalStressedValue: number;
  totalImpact: number;
  totalImpactPct: number;
  positions: StressedPosition[];
  hedgeSuggestions: string[];
}

// ─── Sector-based classification from position data ────────
// Classify positions by their sector field instead of hardcoded symbol lists.
// Falls back to a minimal ticker lookup for positions lacking sector data.

const TECH_SECTORS = new Set(["Technology", "Information Technology", "Communication Services"]);
const DEFENSIVE_SECTORS = new Set(["Utilities", "Consumer Staples", "Health Care", "Healthcare"]);
const GROWTH_SECTORS = new Set(["Technology", "Information Technology", "Communication Services", "Consumer Discretionary"]);
const VALUE_SECTORS = new Set(["Financials", "Energy", "Industrials", "Materials"]);

/** Minimal fallback: map well-known ETFs / tickers to a sector when position.sector is missing. */
const TICKER_SECTOR_FALLBACK: Record<string, string> = {
  QQQ: "Technology", XLK: "Technology", VGT: "Technology", ARKK: "Technology",
  XLU: "Utilities", XLP: "Consumer Staples", XLV: "Healthcare",
  XLE: "Energy", XLF: "Financials", VTV: "Financials", IWD: "Financials",
  SPY: "Broad Market", IWM: "Broad Market", DIA: "Broad Market",
};

function getPositionSector(pos: { symbol: string; sector?: string }): string {
  if (pos.sector) return pos.sector;
  return TICKER_SECTOR_FALLBACK[pos.symbol.toUpperCase()] ?? "Unknown";
}

function isTechPosition(pos: { symbol: string; sector?: string }): boolean {
  return TECH_SECTORS.has(getPositionSector(pos));
}

function isDefensivePosition(pos: { symbol: string; sector?: string }): boolean {
  return DEFENSIVE_SECTORS.has(getPositionSector(pos));
}

function isGrowthPosition(pos: { symbol: string; sector?: string }): boolean {
  return GROWTH_SECTORS.has(getPositionSector(pos));
}

function isValuePosition(pos: { symbol: string; sector?: string }): boolean {
  return VALUE_SECTORS.has(getPositionSector(pos));
}

// ─── Scenarios ──────────────────────────────────────────────

const SCENARIOS: StressScenario[] = [
  {
    id: "crash",
    name: "Market Crash",
    description: "Broad market decline of 10%",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    modifier: () => -0.10,
    color: "text-[var(--loss)]",
  },
  {
    id: "sector-rotation",
    name: "Sector Rotation",
    description: "Tech/Growth sectors -15%, Defensive sectors +5%",
    icon: <ArrowDownRight className="h-3.5 w-3.5" />,
    modifier: (pos) => {
      if (isTechPosition(pos)) return -0.15;
      if (isDefensivePosition(pos)) return 0.05;
      return -0.03;
    },
    color: "text-amber-400",
  },
  {
    id: "rate-hike",
    name: "Rate Hike",
    description: "Growth sectors -8%, Value sectors +3%",
    icon: <Zap className="h-3.5 w-3.5" />,
    modifier: (pos) => {
      if (isGrowthPosition(pos)) return -0.08;
      if (isValuePosition(pos)) return 0.03;
      return -0.02;
    },
    color: "text-amber-400",
  },
  {
    id: "black-swan",
    name: "Black Swan",
    description: "Catastrophic drop of 20%",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    modifier: () => -0.20,
    color: "text-[var(--loss)]",
  },
];

// ─── Compute stress result ──────────────────────────────────

function computeStressResult(
  positions: { symbol: string; sector?: string; currentPrice: number; quantity: number; marketValue: number }[],
  modifier: (pos: { symbol: string; sector?: string }) => number
): StressResult {
  const results = positions.map((p) => {
    const currentValue = Math.abs(p.marketValue);
    const scenarioChange = modifier(p);
    const stressedValue = currentValue * (1 + scenarioChange);
    const impact = stressedValue - currentValue;
    return {
      symbol: p.symbol,
      currentValue,
      stressedValue,
      impact,
      impactPct: scenarioChange * 100,
    };
  });

  const totalCurrentValue = results.reduce((s, r) => s + r.currentValue, 0);
  const totalStressedValue = results.reduce((s, r) => s + r.stressedValue, 0);
  const totalImpact = totalStressedValue - totalCurrentValue;
  const totalImpactPct =
    totalCurrentValue > 0 ? (totalImpact / totalCurrentValue) * 100 : 0;

  // Sort by impact (worst first)
  results.sort((a, b) => a.impact - b.impact);

  // Identify the top 3 largest positions by value for hedge suggestions
  const bySize = [...results].sort((a, b) => b.currentValue - a.currentValue);
  const top3Names = bySize.slice(0, 3).map((r) => r.symbol);

  // Generate hedge suggestions referencing actual positions
  const hedgeSuggestions: string[] = [];
  const worstSymbol = results[0]?.symbol;
  if (totalImpact < -1000 && top3Names.length > 0) {
    hedgeSuggestions.push(
      `Consider protective puts on ${top3Names.slice(0, 2).join(", ")} (largest positions)`
    );
  }
  if (totalImpact < -5000) {
    hedgeSuggestions.push("Add SPY/QQQ put spreads as a broad portfolio hedge");
  }
  if (worstSymbol && results[0]?.impact < -500) {
    hedgeSuggestions.push(`Reduce concentration in ${worstSymbol} (most impacted)`);
  }
  // Use sector-based classification from position data
  const techPositions = positions.filter(isTechPosition);
  if (techPositions.length > positions.length * 0.5) {
    const techNames = techPositions
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
      .slice(0, 3)
      .map((p) => p.symbol)
      .join(", ");
    hedgeSuggestions.push(`Diversify away from tech-heavy allocation (${techNames})`);
  }
  if (hedgeSuggestions.length === 0) {
    hedgeSuggestions.push("Portfolio appears well-hedged for this scenario");
  }

  return {
    totalCurrentValue,
    totalStressedValue,
    totalImpact,
    totalImpactPct,
    positions: results,
    hedgeSuggestions,
  };
}

// ─── Component ──────────────────────────────────────────────

export function StressTest() {
  const positions = usePortfolioStore((s) => s.positions);
  const [open, setOpen] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string>("crash");
  const [customPct, setCustomPct] = useState<string>("-10");
  const [showPositions, setShowPositions] = useState(false);

  const activeScenario = selectedScenario === "custom"
    ? {
        id: "custom",
        name: "Custom Scenario",
        description: `All positions ${parseFloat(customPct) >= 0 ? "+" : ""}${customPct}%`,
        modifier: () => (parseFloat(customPct) || 0) / 100,
        color: parseFloat(customPct) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]",
      }
    : SCENARIOS.find((s) => s.id === selectedScenario)!;

  const result = useMemo(() => {
    if (!positions.length) return null;
    return computeStressResult(positions, activeScenario.modifier);
  }, [positions, activeScenario, selectedScenario, customPct]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-lg border border-border",
          "bg-[var(--surface)] px-4 py-2.5 text-xs font-medium",
          "text-muted-foreground hover:text-foreground hover:border-[var(--chart-4)]/50",
          "transition-all duration-200"
        )}
      >
        <Zap className="h-3.5 w-3.5" />
        Stress Test
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[var(--chart-4)]" />
          <h2 className="text-sm font-semibold text-foreground">
            Portfolio Stress Test
          </h2>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Scenario selector */}
        <div className="flex flex-wrap gap-1.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedScenario(s.id)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all",
                selectedScenario === s.id
                  ? "border-[var(--chart-4)]/50 bg-[var(--chart-4)]/10 text-foreground"
                  : "border-border bg-[var(--surface)] text-muted-foreground hover:text-foreground"
              )}
            >
              {s.icon}
              {s.name}
            </button>
          ))}
          <button
            onClick={() => setSelectedScenario("custom")}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all",
              selectedScenario === "custom"
                ? "border-[var(--chart-4)]/50 bg-[var(--chart-4)]/10 text-foreground"
                : "border-border bg-[var(--surface)] text-muted-foreground hover:text-foreground"
            )}
          >
            Custom
          </button>
        </div>

        {/* Custom input */}
        {selectedScenario === "custom" && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">
              Apply % Change:
            </label>
            <input
              type="number"
              value={customPct}
              onChange={(e) => setCustomPct(e.target.value)}
              className="w-20 rounded border border-border bg-[var(--surface)] px-2 py-1 text-xs tabular-nums text-foreground outline-none focus:border-[var(--chart-4)]/50"
              step="1"
            />
            <span className="text-[10px] text-muted-foreground">%</span>
          </div>
        )}

        {/* Scenario description */}
        <p className="text-[10px] text-muted-foreground">
          {activeScenario.description}
        </p>

        {/* No positions state */}
        {!positions.length && (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            No positions to stress test
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            {/* Impact summary */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Projected Value
                </span>
                <p className="text-base font-bold tabular-nums text-foreground mt-0.5">
                  {formatCurrency(result.totalStressedValue)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-[var(--surface)] px-3 py-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Impact
                </span>
                <p
                  className={cn(
                    "text-base font-bold tabular-nums mt-0.5",
                    result.totalImpact >= 0
                      ? "text-[var(--profit)]"
                      : "text-[var(--loss)]"
                  )}
                >
                  {result.totalImpact >= 0 ? "+" : ""}
                  {formatCurrency(result.totalImpact)}
                  <span className="text-[10px] ml-1">
                    ({result.totalImpactPct >= 0 ? "+" : ""}
                    {(result.totalImpactPct ?? 0).toFixed(1)}%)
                  </span>
                </p>
              </div>
            </div>

            {/* Impact bar visualization */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Portfolio Change
                </span>
              </div>
              <div className="h-4 rounded-full bg-muted/30 overflow-hidden relative">
                {result.totalImpactPct < 0 ? (
                  <div
                    className="absolute top-0 right-1/2 h-full bg-[var(--loss)]/60 rounded-l-full transition-all duration-500"
                    style={{
                      width: `${Math.min(Math.abs(result.totalImpactPct), 50)}%`,
                    }}
                  />
                ) : (
                  <div
                    className="absolute top-0 left-1/2 h-full bg-[var(--profit)]/60 rounded-r-full transition-all duration-500"
                    style={{
                      width: `${Math.min(result.totalImpactPct, 50)}%`,
                    }}
                  />
                )}
                <div className="absolute top-0 left-1/2 w-px h-full bg-muted-foreground/30" />
              </div>
            </div>

            {/* Position breakdown */}
            <div>
              <button
                onClick={() => setShowPositions(!showPositions)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPositions ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                Most Affected Positions
              </button>
              {showPositions && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.positions.slice(0, 8).map((p) => (
                    <div
                      key={p.symbol}
                      className="flex items-center justify-between rounded bg-[var(--surface)] px-2 py-1"
                    >
                      <span className="text-[10px] font-medium text-foreground">
                        {p.symbol}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] tabular-nums text-muted-foreground">
                          {formatCurrency(p.currentValue)}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-medium tabular-nums",
                            p.impact >= 0
                              ? "text-[var(--profit)]"
                              : "text-[var(--loss)]"
                          )}
                        >
                          {p.impact >= 0 ? "+" : ""}
                          {formatCurrency(p.impact)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hedge suggestions */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-1 mb-1.5">
                <Shield className="h-3 w-3 text-[var(--chart-4)]" />
                <span className="text-[10px] font-semibold text-foreground">
                  Suggested Hedges
                </span>
              </div>
              <ul className="space-y-1">
                {result.hedgeSuggestions.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[10px] text-muted-foreground"
                  >
                    <span className="text-[var(--chart-4)] mt-px shrink-0">
                      &bull;
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Disclaimer */}
            <p className="text-[9px] text-muted-foreground/60 pt-2 border-t border-border">
              Scenarios are simplified models using uniform sector-level shocks. Actual drawdowns depend on correlations, liquidity, and timing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
