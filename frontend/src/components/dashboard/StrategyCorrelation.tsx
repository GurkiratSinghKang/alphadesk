"use client";

import { useMemo, useState } from "react";
import { GitMerge, TrendingDown, TrendingUp, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyData } from "@/components/dashboard/StrategyGrid";

// ─── Pearson Correlation ────────────────────────────────────

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  if (den === 0) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

function toReturns(sparkline: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < sparkline.length; i++) {
    const prev = sparkline[i - 1];
    returns.push(prev !== 0 ? (sparkline[i] - prev) / Math.abs(prev) : 0);
  }
  return returns;
}

function correlationColor(r: number): string {
  const clamped = Math.max(-1, Math.min(1, r));
  if (clamped >= 0) {
    const sat = 60 * clamped;
    const light = 25 + 20 * clamped;
    return `hsl(0, ${sat}%, ${light}%)`;
  } else {
    const abs = Math.abs(clamped);
    const sat = 60 * abs;
    const light = 25 + 20 * abs;
    return `hsl(220, ${sat}%, ${light}%)`;
  }
}

// ─── Component ──────────────────────────────────────────────

interface StrategyCorrelationProps {
  strategies: StrategyData[];
}

interface PairInfo {
  nameA: string;
  nameB: string;
  value: number;
}

export function StrategyCorrelation({ strategies }: StrategyCorrelationProps) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; value: number } | null>(null);

  const activeStrategies = useMemo(
    () => strategies.filter((s) => {
      if (!s.sparkline || s.sparkline.length < 3) return false;
      const unique = new Set(s.sparkline);
      return unique.size > 1;
    }),
    [strategies]
  );

  const returns = useMemo(
    () => activeStrategies.map((s) => toReturns(s.sparkline)),
    [activeStrategies]
  );

  const matrix = useMemo(() => {
    const n = activeStrategies.length;
    const m: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      m[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const r = pearson(returns[i], returns[j]);
        m[i][j] = r;
        m[j][i] = r;
      }
    }
    return m;
  }, [activeStrategies, returns]);

  // Extract insights from the matrix
  const insights = useMemo(() => {
    const pairs: PairInfo[] = [];
    const n = activeStrategies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairs.push({
          nameA: activeStrategies[i].shortName,
          nameB: activeStrategies[j].shortName,
          value: matrix[i][j],
        });
      }
    }
    pairs.sort((a, b) => a.value - b.value);

    const mostInverse = pairs[0] ?? null;
    const mostCorrelated = pairs[pairs.length - 1] ?? null;

    // Average absolute correlation (lower = better diversified)
    const avgAbsCorr = pairs.length > 0
      ? pairs.reduce((s, p) => s + Math.abs(p.value), 0) / pairs.length
      : 0;
    // Diversification score: 0-100 (lower avg corr = higher score)
    const divScore = Math.round(Math.max(0, Math.min(100, (1 - avgAbsCorr) * 100)));

    return { pairs, mostInverse, mostCorrelated, avgAbsCorr, divScore };
  }, [activeStrategies, matrix]);

  if (activeStrategies.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <GitMerge className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Strategy Correlation Matrix</h2>
        </div>
        <div className="p-8 text-center">
          <p className="text-label text-muted-foreground">Need at least 2 strategies with trade history to compute correlations.</p>
        </div>
      </div>
    );
  }

  // Scale cells to fill available space — target at least 44px for readability
  const n = activeStrategies.length;
  const cellSize = Math.max(36, Math.min(52, Math.floor(280 / n)));

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Strategy Correlation Matrix
          </h2>
        </div>
        {hoveredCell && (
          <span className="text-label tabular-nums text-muted-foreground">
            {activeStrategies[hoveredCell.row].shortName} / {activeStrategies[hoveredCell.col].shortName}:{" "}
            <span
              className={cn(
                "font-medium",
                hoveredCell.value > 0.3 ? "text-loss" : hoveredCell.value < -0.3 ? "text-ice" : "text-foreground"
              )}
            >
              {(hoveredCell.value ?? 0).toFixed(3)}
            </span>
          </span>
        )}
      </div>

      <div className="p-4">
        <div className="flex gap-6">
          {/* Left: Heatmap */}
          <div className="overflow-x-auto flex-1 min-w-0">
            <div className="inline-flex gap-0">
              {/* Y-axis labels */}
              <div className="flex flex-col justify-end" style={{ paddingTop: cellSize + 4 }}>
                {activeStrategies.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-end pr-2 text-label text-muted-foreground truncate"
                    style={{ height: cellSize, maxWidth: 100 }}
                    title={s.name}
                  >
                    {s.shortName}
                  </div>
                ))}
              </div>

              <div>
                {/* X-axis labels */}
                <div className="flex" style={{ height: cellSize + 4 }}>
                  {activeStrategies.map((s) => (
                    <div
                      key={s.id}
                      className="text-label text-muted-foreground overflow-hidden"
                      style={{ width: cellSize, transform: "rotate(-45deg) translateX(4px)", transformOrigin: "bottom left", whiteSpace: "nowrap" }}
                      title={s.name}
                    >
                      {s.shortName}
                    </div>
                  ))}
                </div>

                {/* Heatmap grid */}
                {matrix.map((row, i) => (
                  <div key={i} className="flex">
                    {row.map((val, j) => (
                      <div
                        key={j}
                        className="border border-[var(--bg-card)] transition-all hover:scale-110 hover:z-10 cursor-default flex items-center justify-center"
                        style={{
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: correlationColor(val),
                          opacity: i === j ? 0.4 : 0.85,
                        }}
                        onMouseEnter={() => setHoveredCell({ row: i, col: j, value: val })}
                        onMouseLeave={() => setHoveredCell(null)}
                        title={`${activeStrategies[i].shortName} / ${activeStrategies[j].shortName}: ${(val ?? 0).toFixed(3)}`}
                      >
                        <span className="text-label text-white/80 tabular-nums font-medium">
                          {(val ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-2 mt-3 text-label text-muted-foreground">
              <span>-1 (inverse)</span>
              <div className="flex h-2.5 w-28 rounded-sm overflow-hidden">
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: correlationColor(-1 + (i / 19) * 2) }} />
                ))}
              </div>
              <span>+1 (correlated)</span>
            </div>
          </div>

          {/* Right: Insights Panel */}
          <div className="w-52 shrink-0 space-y-3">
            {/* Diversification Score */}
            <div className="rounded-lg border border-border/50 bg-[var(--bg-card)] p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                  Diversification
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-2xl font-bold tabular-nums",
                  insights.divScore >= 70 ? "text-profit" : insights.divScore >= 40 ? "text-amber" : "text-loss"
                )}>
                  {insights.divScore}
                </span>
                <span className="text-label text-muted-foreground">/ 100</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", insights.divScore >= 70 ? "bg-profit" : insights.divScore >= 40 ? "bg-amber" : "bg-loss")}
                  style={{ width: `${insights.divScore}%` }}
                />
              </div>
              <p className="text-label text-muted-foreground mt-1.5">
                Avg |corr|: {insights.avgAbsCorr.toFixed(2)}
              </p>
            </div>

            {/* Most Correlated Pair */}
            {insights.mostCorrelated && (
              <div className="rounded-lg border border-border/50 bg-[var(--bg-card)] p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <TrendingUp className="h-3 w-3 text-loss" />
                  <span className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                    Most Correlated
                  </span>
                </div>
                <p className="text-label font-medium text-foreground">
                  {insights.mostCorrelated.nameA} / {insights.mostCorrelated.nameB}
                </p>
                <span className="text-sm font-bold tabular-nums text-loss">
                  {insights.mostCorrelated.value >= 0 ? "+" : ""}{insights.mostCorrelated.value.toFixed(3)}
                </span>
              </div>
            )}

            {/* Most Diversified Pair */}
            {insights.mostInverse && (
              <div className="rounded-lg border border-border/50 bg-[var(--bg-card)] p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <TrendingDown className="h-3 w-3 text-ice" />
                  <span className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                    Most Diversified
                  </span>
                </div>
                <p className="text-label font-medium text-foreground">
                  {insights.mostInverse.nameA} / {insights.mostInverse.nameB}
                </p>
                <span className="text-sm font-bold tabular-nums text-ice">
                  {insights.mostInverse.value >= 0 ? "+" : ""}{insights.mostInverse.value.toFixed(3)}
                </span>
              </div>
            )}

            {/* Top pairs list */}
            {insights.pairs.length > 2 && (
              <div className="rounded-lg border border-border/50 bg-[var(--bg-card)] p-3">
                <span className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                  All Pairs
                </span>
                <div className="mt-1.5 space-y-1">
                  {insights.pairs.map((p, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-label text-muted-foreground truncate mr-2">
                        {p.nameA}/{p.nameB}
                      </span>
                      <span className={cn(
                        "text-label font-medium tabular-nums shrink-0",
                        p.value > 0.3 ? "text-loss" : p.value < -0.3 ? "text-ice" : "text-muted-foreground"
                      )}>
                        {p.value >= 0 ? "+" : ""}{p.value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
