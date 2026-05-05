"use client";

import { useState, useEffect, useCallback } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { getBars } from "@/lib/api";
import type { TimeFrame } from "@/types";

// ─── Types ──────────────────────────────────────────────────

interface TimeframeConfig {
  tf: TimeFrame;
  label: string;
  description: string;
  barCount: number;
}

const TIMEFRAMES: TimeframeConfig[] = [
  { tf: "1m", label: "1M", description: "Intraday Scalping", barCount: 60 },
  { tf: "15m", label: "15M", description: "Intraday Swing", barCount: 60 },
  { tf: "1H", label: "1H", description: "Day Trading", barCount: 48 },
  { tf: "D", label: "D", description: "Position Trading", barCount: 60 },
];

// ─── Mini Chart ─────────────────────────────────────────────

function MiniChart({
  timeframe,
  bars,
  loading,
}: {
  timeframe: TimeframeConfig;
  bars: number[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="relative rounded-lg border border-border bg-[var(--bg-card)] p-2 h-full flex items-center justify-center">
        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bars.length < 2) {
    return (
      <div className="relative rounded-lg border border-border bg-[var(--bg-card)] p-2 h-full animate-pulse" />
    );
  }

  const min = Math.min(...bars);
  const max = Math.max(...bars);
  const range = max - min || 1;
  const current = bars[bars.length - 1];
  const first = bars[0];
  const trending = current > first;
  const avg = bars.reduce((s, v) => s + v, 0) / bars.length;
  const aboveAvg = current > avg;

  // Build SVG polyline points
  const points = bars
    .map(
      (v, i) =>
        `${(i / (bars.length - 1)) * 100},${100 - ((v - min) / range) * 100}`
    )
    .join(" ");

  // Build area fill path
  const areaPath = `M0,${100 - ((bars[0] - min) / range) * 100} ${bars
    .map(
      (v, i) =>
        `L${(i / (bars.length - 1)) * 100},${100 - ((v - min) / range) * 100}`
    )
    .join(" ")} L100,100 L0,100 Z`;

  const changePct = ((current - first) / first) * 100;

  return (
    <div
      className={cn(
        "relative rounded-lg border p-2 h-full flex flex-col bg-[var(--bg-card)]",
        aboveAvg
          ? "border-[var(--profit)]/30"
          : "border-[var(--loss)]/30"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-label font-bold text-foreground">
            {timeframe.label}
          </span>
          <span className="text-label text-muted-foreground hidden sm:inline">
            {timeframe.description}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-label tabular-nums font-medium text-foreground">
            ${(current ?? 0).toFixed(2)}
          </span>
          <span
            className={cn(
              "text-label tabular-nums font-medium",
              trending ? "text-[var(--profit)]" : "text-[var(--loss)]"
            )}
          >
            {trending ? "+" : ""}
            {(changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 relative">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          {/* Area fill */}
          <path
            d={areaPath}
            fill={trending ? "var(--profit)" : "var(--loss)"}
            opacity="0.06"
          />
          {/* Average line */}
          <line
            x1="0"
            y1={100 - ((avg - min) / range) * 100}
            x2="100"
            y2={100 - ((avg - min) / range) * 100}
            stroke="var(--muted-foreground)"
            strokeWidth="0.3"
            strokeDasharray="2 2"
            opacity="0.4"
          />
          {/* Price line */}
          <polyline
            points={points}
            fill="none"
            stroke={trending ? "var(--profit)" : "var(--loss)"}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          {/* Current price dot */}
          <circle
            cx="100"
            cy={100 - ((current - min) / range) * 100}
            r="2"
            fill={trending ? "var(--profit)" : "var(--loss)"}
          />
        </svg>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function MultiTimeframe() {
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const [barData, setBarData] = useState<Record<string, number[]>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  const fetchAllTimeframes = useCallback(
    async (symbol: string) => {
      const newLoading: Record<string, boolean> = {};
      TIMEFRAMES.forEach((t) => (newLoading[t.tf] = true));
      setLoadingStates(newLoading);

      const results: Record<string, number[]> = {};

      await Promise.allSettled(
        TIMEFRAMES.map(async (t) => {
          try {
            const bars = await getBars(symbol, t.tf, t.barCount);
            results[t.tf] = bars.map((b) => b.close);
          } catch {
            results[t.tf] = [];
          } finally {
            setLoadingStates((prev) => ({ ...prev, [t.tf]: false }));
          }
        })
      );

      setBarData(results);
    },
    []
  );

  useEffect(() => {
    if (selectedSymbol) {
      fetchAllTimeframes(selectedSymbol);
    }
  }, [selectedSymbol, fetchAllTimeframes]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!selectedSymbol) return;
    const interval = setInterval(() => fetchAllTimeframes(selectedSymbol), 60000);
    return () => clearInterval(interval);
  }, [selectedSymbol, fetchAllTimeframes]);

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-label font-semibold text-foreground">
            Multi-Timeframe
          </span>
          <span className="text-label text-muted-foreground">
            {selectedSymbol}
          </span>
        </div>
        <button
          onClick={() => fetchAllTimeframes(selectedSymbol)}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* 2x2 Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-1.5">
        {TIMEFRAMES.map((t) => (
          <MiniChart
            key={t.tf}
            timeframe={t}
            bars={barData[t.tf] ?? []}
            loading={loadingStates[t.tf] ?? true}
          />
        ))}
      </div>
    </div>
  );
}
