"use client";

import { useState, useMemo, useId } from "react";
import { formatCurrency, cn } from "@/lib/utils";

type Period = "1W" | "1M" | "3M" | "YTD";

interface PortfolioHeroProps {
  portfolioValue: number;
  dayPnl: number;
  dayPnlPct: number;
  equityHistory: { date: string; value: number }[];
  isDemo?: boolean;
}

function filterByPeriod(
  history: { date: string; value: number }[],
  period: Period
): { date: string; value: number }[] {
  if (history.length === 0) return history;
  const now = new Date();
  let cutoff: Date;
  if (period === "1W") {
    cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 7);
  } else if (period === "1M") {
    cutoff = new Date(now);
    cutoff.setMonth(now.getMonth() - 1);
  } else if (period === "3M") {
    cutoff = new Date(now);
    cutoff.setMonth(now.getMonth() - 3);
  } else {
    // YTD
    cutoff = new Date(now.getFullYear(), 0, 1);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filtered = history.filter((d) => d.date >= cutoffStr);
  return filtered.length > 0 ? filtered : history;
}

function EquityCurveSVG({
  data,
}: {
  data: { date: string; value: number }[];
}) {
  const W = 1000;
  const H = 120;
  const PAD_X = 0;
  const PAD_Y = 8;

  // useId must be called before any early return (Rules of Hooks)
  const rawId = useId();
  const gradientId = `equity-grad-${rawId.replace(/:/g, "")}`;

  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rawRange = maxV - minV;
  const range = rawRange > 0 ? rawRange : 1;
  // Add 10% padding above and below to make small movements more visible
  const paddedMin = minV - range * 0.1;
  const paddedMax = maxV + range * 0.1;
  const paddedRange = paddedMax - paddedMin;

  const toX = (i: number) =>
    PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2);
  const toY = (v: number) =>
    PAD_Y + (1 - (v - paddedMin) / paddedRange) * (H - PAD_Y * 2);

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(" ");

  const firstVal = data[0].value;
  const lastVal = data[data.length - 1].value;
  const isUp = lastVal >= firstVal;
  const colorVar = isUp ? "var(--profit)" : "var(--loss)";

  // Polygon: close the area down to the bottom
  const areaPoints = [
    `${toX(0)},${H}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${H}`,
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorVar} stopOpacity="0.15" />
          <stop offset="100%" stopColor={colorVar} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Gradient fill area */}
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={colorVar}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PortfolioHero({
  portfolioValue,
  dayPnl,
  dayPnlPct,
  equityHistory,
  isDemo,
}: PortfolioHeroProps) {
  const [period, setPeriod] = useState<Period>("1M");

  // Only apply demo opacity when data has actually loaded (portfolioValue > 0 or explicit demo flag)
  // This prevents a brief flash of opacity-40 on initial load when equity defaults to 0
  const hasLoaded = portfolioValue > 0 || dayPnl !== 0;
  const showDemoOpacity = isDemo && hasLoaded;

  const filteredHistory = useMemo(
    () => filterByPeriod(equityHistory, period),
    [equityHistory, period]
  );

  return (
    <>
      <h1 className="sr-only">AlphaDesk Dashboard</h1>
    <div className="rounded-xl border border-border bg-gradient-to-r from-[var(--surface)] via-[var(--panel)]/30 to-[var(--surface)] overflow-hidden">
      {/* Text content */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* Portfolio Equity */}
          <div className="min-w-0">
            <p className="text-label leading-none mb-1">Portfolio</p>
            <p className={cn("text-display tabular-nums text-gradient", showDemoOpacity && "opacity-40")} title={showDemoOpacity ? "Demo data — connect Alpaca API for live values" : undefined}>
              {portfolioValue ? formatCurrency(portfolioValue) : "\u2014"}
            </p>
          </div>

          {/* Day P&L */}
          <div className="min-w-0">
            <p className="text-label leading-none mb-1">Day P&L</p>
            {!portfolioValue && !isDemo ? (
              <p className="text-xl font-semibold tabular-nums leading-none text-muted-foreground">{"\u2014"}</p>
            ) : (
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums leading-none",
                  dayPnl > 0 ? "text-[var(--profit)] glow-profit" : dayPnl < 0 ? "text-[var(--loss)] glow-loss" : "text-muted-foreground",
                  showDemoOpacity && "opacity-40"
                )}
                title={showDemoOpacity ? "Demo data — connect Alpaca API for live values" : undefined}
              >
                {dayPnl > 0 ? "+" : ""}
                {formatCurrency(dayPnl)}{" "}
                <span className="text-sm font-normal text-secondary">
                  ({dayPnlPct > 0 ? "+" : ""}
                  {dayPnlPct.toFixed(2)}%)
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Period pills */}
        <div className="flex gap-1 shrink-0">
          {(["1W", "1M", "3M", "YTD"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                period === p
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart strip — dedicated space below text */}
      <div className="relative h-[56px] border-t border-border/30">
        <EquityCurveSVG data={filteredHistory} />
      </div>
    </div>
    </>
  );
}
