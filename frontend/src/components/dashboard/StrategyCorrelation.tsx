"use client";

import { useMemo, useState } from "react";
import { GitMerge } from "lucide-react";
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

/** Convert sparkline values to period-over-period returns */
function toReturns(sparkline: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < sparkline.length; i++) {
    const prev = sparkline[i - 1];
    returns.push(prev !== 0 ? (sparkline[i] - prev) / Math.abs(prev) : 0);
  }
  return returns;
}

/** Interpolate correlation value to muted professional color
 *  -1 = muted blue hsl(220, 60%, 45%)
 *   0 = dark gray   hsl(0, 0%, 25%)
 *  +1 = muted red   hsl(0, 60%, 45%)
 */
function correlationColor(r: number): string {
  const clamped = Math.max(-1, Math.min(1, r));
  if (clamped >= 0) {
    // Dark gray to muted red
    const hue = 0;
    const sat = 60 * clamped;            // 0% at 0 -> 60% at +1
    const light = 25 + 20 * clamped;     // 25% at 0 -> 45% at +1
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  } else {
    // Dark gray to muted blue
    const abs = Math.abs(clamped);
    const hue = 220;
    const sat = 60 * abs;                // 0% at 0 -> 60% at -1
    const light = 25 + 20 * abs;         // 25% at 0 -> 45% at -1
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }
}

// ─── Component ──────────────────────────────────────────────

interface StrategyCorrelationProps {
  strategies: StrategyData[];
}

export function StrategyCorrelation({ strategies }: StrategyCorrelationProps) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; value: number } | null>(null);

  // Filter to strategies with actual trade data (non-trivial sparklines)
  const activeStrategies = useMemo(
    () => strategies.filter((s) => {
      if (!s.sparkline || s.sparkline.length < 3) return false;
      const unique = new Set(s.sparkline);
      return unique.size > 1; // skip flat lines
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

  if (activeStrategies.length < 2) return null;

  const cellSize = activeStrategies.length > 8 ? 28 : 36;

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
          <span className="text-xs tabular-nums text-muted-foreground">
            {activeStrategies[hoveredCell.row].shortName} / {activeStrategies[hoveredCell.col].shortName}:{" "}
            <span
              className={cn(
                "font-medium",
                hoveredCell.value > 0.3
                  ? "text-red-400"
                  : hoveredCell.value < -0.3
                  ? "text-blue-400"
                  : "text-foreground"
              )}
            >
              {(hoveredCell.value ?? 0).toFixed(3)}
            </span>
          </span>
        )}
      </div>

      <div className="p-4 overflow-x-auto">
        <div className="inline-flex gap-0">
          {/* Y-axis labels */}
          <div className="flex flex-col justify-end" style={{ paddingTop: cellSize + 4 }}>
            {activeStrategies.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center justify-end pr-2 text-[10px] text-muted-foreground truncate"
                style={{ height: cellSize, maxWidth: 90 }}
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
                  className="text-[10px] text-muted-foreground overflow-hidden"
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
                    className="border border-[var(--surface)] transition-transform hover:scale-110 hover:z-10 cursor-default flex items-center justify-center"
                    style={{
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: correlationColor(val),
                      opacity: i === j ? 0.5 : 0.85,
                    }}
                    onMouseEnter={() => setHoveredCell({ row: i, col: j, value: val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    title={`${activeStrategies[i].shortName} / ${activeStrategies[j].shortName}: ${(val ?? 0).toFixed(3)}`}
                  >
                    {Math.abs(val) > 0.01 && cellSize > 30 && (
                      <span className="text-[8px] text-white/70 tabular-nums">{val.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-muted-foreground">
          <span>-1 (inverse)</span>
          <div className="flex h-3 w-32 rounded-sm overflow-hidden">
            {Array.from({ length: 20 }, (_, i) => {
              const r = -1 + (i / 19) * 2;
              return (
                <div
                  key={i}
                  className="flex-1"
                  style={{ backgroundColor: correlationColor(r) }}
                />
              );
            })}
          </div>
          <span>+1 (correlated)</span>
        </div>
      </div>
    </div>
  );
}
