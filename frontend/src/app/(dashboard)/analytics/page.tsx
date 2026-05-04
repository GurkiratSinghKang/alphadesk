"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { TrendingDown, BarChart3, Activity, Calendar, Table2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DashboardPageLayout } from "@/components/layouts";
import { getPortfolioPerformance, getTradeHistory, type TradeHistoryEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountEquity, equityAtPoint, startingEquity } from "@/lib/accountEquity";

// 2026-04-21 typography polish: the `/analytics` page predated the
// editorial token system the dashboard hero rolled onto. Section titles
// were set in bland `text-sm font-semibold`, KPI values in unopinionated
// `text-xs font-medium`. Three shared classes pulled from
// `styles/design-tokens.css` bring this page onto the same ladder:
//   .t-section-display  italic (13px from --fs-section-cap) — section headers
//   .t-label            12 sans caps 0.12em   — KPI eyebrows
//   .t-num-md           16 mono tabular-med   — row numbers / percents
// Kept local to avoid touching shared composites.

// ─── Token helpers ──────────────────────────────────────────
// SVG `fill` / `stroke` attributes need a concrete color string at runtime —
// the browser does not resolve `var(--down-500)` inside those attributes.
// Read the design-token off :root and fall back to the literal hex in the
// token file so the chart still renders pre-hydration. Mirrors the helper
// in `components/charts/TradingChart.tsx`.
function getTokenVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

// Compose a rgba() string from a hex color + alpha. Used for chart fills
// where the design-token `--loss-tint` / `--profit-tint` pre-alpha is not
// the alpha we need (histogram bars want 0.4, heatmap wants 0.15–0.7).
function rgbaFromHex(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Types ──────────────────────────────────────────────────

interface EquityPoint {
  date: string;
  cumulative_pnl: number;
  // `value` is the authoritative equity level emitted by the backend.
  // Optional for backwards-compat with older API responses — helpers use
  // `equityAtPoint` to fall back to `baseEquity + cumulative_pnl`.
  value?: number;
}

type TradeHistoryCompat = TradeHistoryEntry & {
  exitPrice?: number | null;
  entryPrice?: number | null;
  realizedPnl?: number | null;
  entryTime?: string;
  exitTime?: string | null;
};

// ─── Helpers ────────────────────────────────────────────────

function computeDailyReturns(curve: EquityPoint[], baseEquity: number): { date: string; ret: number }[] {
  if (curve.length < 2) return [];
  const results: { date: string; ret: number }[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prevEq = equityAtPoint(curve[i - 1], baseEquity);
    const currEq = equityAtPoint(curve[i], baseEquity);
    const ret = prevEq > 0 ? (currEq - prevEq) / prevEq : 0;
    results.push({ date: curve[i].date, ret });
  }
  return results;
}

function computeDrawdown(curve: EquityPoint[], baseEquity: number): { date: string; dd: number }[] {
  if (curve.length === 0) return [];
  const results: { date: string; dd: number }[] = [];
  let peak = -Infinity;
  for (const pt of curve) {
    const equity = equityAtPoint(pt, baseEquity);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (equity - peak) / peak : 0;
    results.push({ date: pt.date, dd });
  }
  return results;
}

function computeRollingSharpe(dailyReturns: { date: string; ret: number }[], window = 30): { date: string; sharpe: number }[] {
  if (dailyReturns.length < window) return [];
  const results: { date: string; sharpe: number }[] = [];
  for (let i = window - 1; i < dailyReturns.length; i++) {
    const slice = dailyReturns.slice(i - window + 1, i + 1).map((d) => d.ret);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    // Sample (Bessel-corrected) variance — divide by N-1, not N. Using
    // the biased MLE systematically inflates Sharpe on short windows
    // (~3% overstatement at window=30) because the denominator is too
    // small. Matches the backend `sharpe()` helper in backtest/metrics.py
    // which also uses ddof=1.
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    results.push({ date: dailyReturns[i].date, sharpe });
  }
  return results;
}

function computeHistogram(dailyReturns: { ret: number }[], buckets = 20): { min: number; max: number; count: number }[] {
  if (dailyReturns.length === 0) return [];
  const returns = dailyReturns.map((d) => d.ret * 100); // percentages
  const lo = Math.min(...returns);
  const hi = Math.max(...returns);
  const range = hi - lo || 1;
  const step = range / buckets;
  const bins: { min: number; max: number; count: number }[] = [];
  for (let i = 0; i < buckets; i++) {
    bins.push({ min: lo + step * i, max: lo + step * (i + 1), count: 0 });
  }
  for (const r of returns) {
    const idx = Math.min(Math.floor((r - lo) / step), buckets - 1);
    bins[idx].count++;
  }
  return bins;
}

function normalPDF(x: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / std) ** 2);
}

function computeMonthlyReturns(curve: EquityPoint[], baseEquity: number): Map<string, number> {
  // Group by month, compute return for each month. Base each month's
  // return on the PRIOR month's final equity (not the first data-point
  // inside the current month) so the gap between month-end close and
  // next-month open isn't dropped. For the first month in the dataset
  // there's no prior close — fall back to the month's first point to
  // avoid a divide-by-zero.
  const monthly = new Map<string, { first: number; last: number }>();
  const order: string[] = [];
  for (const pt of curve) {
    const key = pt.date.slice(0, 7); // YYYY-MM
    const entry = monthly.get(key);
    const equity = equityAtPoint(pt, baseEquity);
    if (!entry) {
      monthly.set(key, { first: equity, last: equity });
      order.push(key);
    } else {
      entry.last = equity;
    }
  }
  const returns = new Map<string, number>();
  let prevLast: number | null = null;
  for (const key of order) {
    const val = monthly.get(key)!;
    const base = prevLast ?? val.first;
    returns.set(key, base > 0 ? ((val.last - base) / base) * 100 : 0);
    prevLast = val.last;
  }
  return returns;
}

function computeTradeStats(trades: TradeHistoryEntry[]) {
  // Normalize field names: accept both snake_case and camelCase from API
  const normalized = trades.map((trade) => {
    const t = trade as TradeHistoryCompat;
    return {
    ...t,
    exit_price: t.exit_price ?? t.exitPrice ?? null,
    entry_price: t.entry_price ?? t.entryPrice ?? 0,
    pnl: t.pnl ?? t.realizedPnl ?? null,
    entry_time: t.entry_time ?? t.entryTime ?? "",
    exit_time: t.exit_time ?? t.exitTime ?? null,
    status: t.status ?? "open",
    };
  });

  // Filter for closed trades: has exit_price or status indicates closed
  const closed = normalized.filter(
    (t) => (t.exit_price !== null && t.pnl !== null) || t.status === "closed"
  );
  if (closed.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, scratches: 0,
      winRate: null, profitFactor: null,
      avgWin: null, avgLoss: null,
      largestWin: 0, largestLoss: 0,
      avgHoldMs: 0, maxHoldMs: 0, maxConsecWins: 0, maxConsecLosses: 0,
    };
  }

  // Break-even trades (pnl === 0) are "scratches" — excluded from both
  // win and loss buckets so they don't deflate win-rate or distort
  // profit factor. Win-rate denominator becomes (wins + losses), NOT
  // the total trade count, matching backend `hit_rate` semantics.
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const scratches = closed.filter((t) => (t.pnl ?? 0) === 0);
  const totalWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const pnls = closed.map((t) => t.pnl ?? 0);
  const decidedCount = wins.length + losses.length;

  // Hold times
  const holdTimes = closed
    .filter((t) => t.entry_time && t.exit_time)
    .map((t) => new Date(t.exit_time!).getTime() - new Date(t.entry_time).getTime());

  // Consecutive streaks — scratches don't reset or extend either streak
  let maxConsecWins = 0, maxConsecLosses = 0, curWins = 0, curLosses = 0;
  for (const pnl of pnls) {
    if (pnl > 0) { curWins++; curLosses = 0; maxConsecWins = Math.max(maxConsecWins, curWins); }
    else if (pnl < 0) { curLosses++; curWins = 0; maxConsecLosses = Math.max(maxConsecLosses, curLosses); }
    // pnl === 0: scratch — leaves both counters untouched
  }

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    scratches: scratches.length,
    // BUG-034 — when the denominator is zero (0 decided trades, just a
    // scratch) win-rate should surface as null ("n/a"), not a false 0 %.
    winRate: decidedCount > 0 ? (wins.length / decidedCount) * 100 : null,
    // BUG-034 — profit factor = wins / losses. With 0 losses and 0 wins
    // the ratio is undefined; emit `null` (rendered as "n/a") rather than
    // the misleading `0.00`. Infinite is still correct when wins>0 and
    // losses=0 (all winners, no drawdown).
    profitFactor: totalLoss > 0
      ? totalWin / totalLoss
      : totalWin > 0
        ? Infinity
        : null,
    // BUG-034 — avg win/loss must be null (→ "n/a") when the bucket is
    // empty, so we don't print "-$0.00" for a zero-denominator average.
    avgWin: wins.length > 0 ? totalWin / wins.length : null,
    avgLoss: losses.length > 0 ? totalLoss / losses.length : null,
    largestWin: pnls.length > 0 ? Math.max(...pnls) : 0,
    largestLoss: pnls.length > 0 ? Math.min(...pnls) : 0,
    avgHoldMs: holdTimes.length > 0 ? holdTimes.reduce((s, v) => s + v, 0) / holdTimes.length : 0,
    maxHoldMs: holdTimes.length > 0 ? Math.max(...holdTimes) : 0,
    maxConsecWins,
    maxConsecLosses,
  };
}

function formatDuration(ms: number): string {
  if (ms === 0) return "--";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${(hours ?? 0).toFixed(1)}h`;
  const days = hours / 24;
  return `${(days ?? 0).toFixed(1)}d`;
}

// ─── SVG Chart Components ───────────────────────────────────

function DrawdownChart({ data }: { data: { date: string; dd: number }[] }) {
  if (data.length === 0) return <EmptyState label="No drawdown data" />;
  // 2026-04-21 polish — match distribution dims (220×48×24×18) so rows
  // of charts line up on the same baseline. Axis tick font 8→10 px.
  const w = 600, h = 220, px = 48, py = 24, axisPy = 18;
  const minDD = Math.min(...data.map((d) => d.dd));
  const yScale = (v: number) => py + ((0 - v) / (0 - minDD || 1)) * (h - py - axisPy);
  const xScale = (i: number) => px + (i / (data.length - 1 || 1)) * (w - 2 * px);

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"}${(xScale(i) ?? 0).toFixed(1)},${(yScale(d.dd) ?? 0).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${(xScale(data.length - 1) ?? 0).toFixed(1)},${(yScale(0) ?? 0).toFixed(1)} L${(xScale(0) ?? 0).toFixed(1)},${(yScale(0) ?? 0).toFixed(1)} Z`;

  // Y-axis labels
  const yTicks = [0, minDD / 2, minDD];

  // Design-token aware stroke + fill. Drawdown is a loss signal → coral
  // `--down-500`; fill uses the pre-alpha'd `--loss-tint` (rgba at 0.12).
  // Fallback hex matches the token's literal value so the chart still
  // paints before CSS loads.
  const downColor = getTokenVar("--down-500", "#e07856");
  const lossTint = getTokenVar("--loss-tint", "rgba(224, 120, 86, 0.12)");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={px}
            y1={yScale(t)}
            x2={w - px}
            y2={yScale(t)}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <text
            x={px - 6}
            y={yScale(t) + 3}
            textAnchor="end"
            fill="var(--fg-muted)"
            fontSize="10"
            fontFamily="monospace"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {(t * 100).toFixed(1)}%
          </text>
        </g>
      ))}
      {/* Area fill (coral tint) */}
      <path d={areaD} fill={lossTint} />
      {/* Line (coral) */}
      <path d={pathD} fill="none" stroke={downColor} strokeWidth="1.5" />
      {/* X-axis labels */}
      {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
        <text
          key={idx}
          x={xScale(idx)}
          y={h - 4}
          textAnchor="middle"
          fill="var(--fg-muted)"
          fontSize="10"
          fontFamily="monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {data[idx]?.date?.slice(5) ?? ""}
        </text>
      ))}
    </svg>
  );
}

function RollingSharpeChart({ data }: { data: { date: string; sharpe: number }[] }) {
  if (data.length === 0) return <EmptyState label="Not enough data for rolling Sharpe (need 30+ days)" />;
  // 2026-04-21 polish — harmonised dims + axis fontSize to match the
  // other charts on the page. Y-axis label gutter lifted (48 → leaves
  // room for 3-digit sharpe prints like `-3.2`).
  const w = 600, h = 220, px = 48, py = 24, axisPy = 18;
  const values = data.map((d) => d.sharpe);
  const minV = Math.min(...values, -1);
  const maxV = Math.max(...values, 1);
  const range = maxV - minV || 1;
  const yScale = (v: number) => py + ((maxV - v) / range) * (h - py - axisPy);
  const xScale = (i: number) => px + (i / (data.length - 1 || 1)) * (w - 2 * px);

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"}${(xScale(i) ?? 0).toFixed(1)},${(yScale(d.sharpe) ?? 0).toFixed(1)}`).join(" ");

  const yTicks = [maxV, (maxV + minV) / 2, minV];
  const zeroY = yScale(0);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={px}
            y1={yScale(t)}
            x2={w - px}
            y2={yScale(t)}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <text
            x={px - 6}
            y={yScale(t) + 3}
            textAnchor="end"
            fill="var(--fg-muted)"
            fontSize="10"
            fontFamily="monospace"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      {/* Zero line — dashed hairline splits winning vs losing Sharpe */}
      {minV < 0 && maxV > 0 && (
        <line
          x1={px}
          y1={zeroY}
          x2={w - px}
          y2={zeroY}
          stroke="var(--fg-muted)"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.55"
        />
      )}
      <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
      {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
        <text
          key={idx}
          x={xScale(idx)}
          y={h - 4}
          textAnchor="middle"
          fill="var(--fg-muted)"
          fontSize="10"
          fontFamily="monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {data[idx]?.date?.slice(5) ?? ""}
        </text>
      ))}
    </svg>
  );
}

function ReturnDistribution({ bins, dailyReturns }: { bins: { min: number; max: number; count: number }[]; dailyReturns: { ret: number }[] }) {
  if (bins.length === 0) return <EmptyState label="No return data" />;
  // 2026-04-21 polish — taller viewport (220) + wider padding (px 48)
  // so the tick labels never collide with the first/last bar. Axis font
  // bumped from 8 → 10 (SVG px) so labels are legible on retina displays.
  const w = 600, h = 220, px = 48, py = 24, axisPy = 18;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const barW = (w - 2 * px) / bins.length;

  // Normal curve
  const returns = dailyReturns.map((d) => d.ret * 100);
  const mean = returns.reduce((s, v) => s + v, 0) / (returns.length || 1);
  const std = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length || 1));
  const step = bins.length > 1 ? bins[1].min - bins[0].min : 1;
  const normalScale = dailyReturns.length * step;

  const normalPoints = bins.map((b, i) => {
    const midX = px + i * barW + barW / 2;
    const midVal = (b.min + b.max) / 2;
    const density = normalPDF(midVal, mean, std) * normalScale;
    const normY = py + ((maxCount - density) / maxCount) * (h - py - axisPy);
    return `${i === 0 ? "M" : "L"}${(midX ?? 0).toFixed(1)},${(Math.max(py, normY) ?? 0).toFixed(1)}`;
  }).join(" ");

  // Bar fills must be a concrete color — resolve design tokens at runtime
  // and compose a 0.4 alpha histogram fill. Chartreuse positive / coral
  // negative, matching the rest of the F0 palette. Normal-curve stroke
  // uses `--chart-4` (ice) which is already token-resolved via CSS var.
  const upHex = getTokenVar("--up-500", "#a8d04d");
  const downHex = getTokenVar("--down-500", "#e07856");
  const upFill = rgbaFromHex(upHex, 0.4);
  const downFill = rgbaFromHex(downHex, 0.4);

  // Outlier markers — flag bins whose midpoint falls beyond ±2σ. Rendered
  // as a thin coral/chartreuse tick above each offending bar so the tail
  // stands out against the bulk of the distribution.
  const outlierThreshold = 2 * std;

  // x-axis: first / quartile / median / three-quarter / last — five
  // reference points so labels stay spaced comfortably on narrow cards.
  const labelIdxs = Array.from(
    new Set([
      0,
      Math.floor(bins.length * 0.25),
      Math.floor(bins.length * 0.5),
      Math.floor(bins.length * 0.75),
      bins.length - 1,
    ]),
  ).filter((i) => i >= 0 && i < bins.length);

  // Zero reference line — vertical rule at x = 0% so winning bins sit to
  // the right and losing bins to the left at a glance.
  const zeroBinIdx = bins.findIndex((b) => b.min <= 0 && b.max >= 0);
  const zeroX = zeroBinIdx >= 0 ? px + zeroBinIdx * barW + barW / 2 : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Zero reference line */}
      {zeroX !== null && (
        <line
          x1={zeroX}
          y1={py}
          x2={zeroX}
          y2={h - axisPy}
          stroke="var(--border)"
          strokeWidth="0.75"
          strokeDasharray="3 3"
        />
      )}
      {/* Bars */}
      {bins.map((b, i) => {
        const barH = (b.count / maxCount) * (h - py - axisPy);
        const x = px + i * barW;
        const y = h - axisPy - barH;
        const midVal = (b.min + b.max) / 2;
        const isOutlier = Math.abs(midVal - mean) > outlierThreshold && b.count > 0;
        const fill = midVal >= 0 ? upFill : downFill;
        const outlineColor = midVal >= 0 ? upHex : downHex;
        return (
          <g key={i}>
            <rect
              x={x + 1}
              y={y}
              width={Math.max(barW - 2, 1)}
              height={barH}
              fill={fill}
              rx="1"
            />
            {isOutlier && (
              // Thin accent stroke above the bar marks the ±2σ tail.
              <line
                x1={x + 1}
                y1={y - 3}
                x2={x + Math.max(barW - 1, 2)}
                y2={y - 3}
                stroke={outlineColor}
                strokeWidth="1.5"
              />
            )}
          </g>
        );
      })}
      {/* Normal curve overlay */}
      <path d={normalPoints} fill="none" stroke="var(--chart-4)" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* X-axis labels — five evenly-spaced ticks, 10px mono tabular */}
      {labelIdxs.map((idx) => (
        <text
          key={idx}
          x={px + idx * barW + barW / 2}
          y={h - 4}
          textAnchor="middle"
          fill="var(--fg-muted)"
          fontSize="10"
          fontFamily="monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {((bins[idx].min + bins[idx].max) / 2).toFixed(1)}%
        </text>
      ))}
    </svg>
  );
}

function MonthlyHeatmap({ monthlyReturns }: { monthlyReturns: Map<string, number> }) {
  if (monthlyReturns.size === 0) return <EmptyState label="No monthly data" />;

  // Build year-month grid
  const allKeys = Array.from(monthlyReturns.keys()).sort();
  const years = [...new Set(allKeys.map((k) => k.slice(0, 4)))].sort();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const maxAbs = Math.max(...Array.from(monthlyReturns.values()).map(Math.abs), 1);

  // Design-token aware heatmap. Chartreuse `--up-500` for positive months,
  // coral `--down-500` for negatives; intensity is the same 0.15 → 0.70
  // ramp as before, just composed from the tokens' literal RGB.
  const upHex = getTokenVar("--up-500", "#a8d04d");
  const downHex = getTokenVar("--down-500", "#e07856");

  function cellColor(val: number): string {
    const intensity = Math.min(Math.abs(val) / maxAbs, 1);
    const alpha = 0.15 + intensity * 0.55;
    if (val > 0) return rgbaFromHex(upHex, alpha);
    if (val < 0) return rgbaFromHex(downHex, alpha);
    // 2026-04-21 polish — scratch (exactly-zero return) months must be
    // visually distinct from *losing* months. Before this change a 0.0%
    // month painted with no background and read as "no data" (same as
    // undefined cells), which is misleading. Ink-tinted neutral plate
    // signals "traded, broke even."
    return "rgba(236, 230, 210, 0.05)";
  }

  return (
    <div className="overflow-x-auto">
      {/* 2026-04-21 polish — fixed-layout table forces equal column widths
          so Jan/Feb/...Dec cells line up on a pixel grid regardless of the
          contents. Previously a +10.0% in March made that column wider
          than October's +1.0%. */}
      <table
        className="w-full border-collapse"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "64px" }} />
          {months.map((m) => (
            <col key={m} style={{ width: "auto" }} />
          ))}
          <col style={{ width: "72px" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left">
              <span className="t-label">Year</span>
            </th>
            {months.map((m) => (
              <th key={m} className="px-1 py-1.5 text-center">
                <span className="t-label">{m}</span>
              </th>
            ))}
            <th className="px-2 py-1.5 text-center">
              <span className="t-label">YTD</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            // YTD must COMPOUND monthly returns — arithmetic summation is
            // wrong (e.g. Jan +10%, Feb -10% sums to 0 but compounded is
            // -1%). Product of (1 + r/100), minus 1, scaled to a %.
            const ytd =
              (months.reduce((p, _, mi) => {
                const key = `${year}-${String(mi + 1).padStart(2, "0")}`;
                const m = monthlyReturns.get(key);
                if (m === undefined) return p; // skip months with no data
                return p * (1 + m / 100);
              }, 1) - 1) * 100;
            return (
              <tr key={year}>
                <td className="px-2 py-1.5 font-mono tabular-nums text-body-sm text-ink-900">
                  {year}
                </td>
                {months.map((_, mi) => {
                  const key = `${year}-${String(mi + 1).padStart(2, "0")}`;
                  const val = monthlyReturns.get(key);
                  return (
                    <td key={mi} className="px-1 py-1 text-center">
                      {val !== undefined ? (
                        <span
                          className="inline-block w-full rounded-[3px] px-1 py-1 font-mono tabular-nums text-label"
                          title={val === 0 ? "Break-even month" : undefined}
                          style={{
                            backgroundColor: cellColor(val),
                            color:
                              val === 0
                                ? "var(--fg-muted)"
                                : Math.abs(val) > maxAbs * 0.3
                                  ? "var(--ink-1000)"
                                  : "var(--fg)",
                          }}
                        >
                          {val > 0 ? "+" : val < 0 ? "" : ""}{val.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="t-meta opacity-40">&mdash;</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-center">
                  <span
                    className={cn(
                      "t-num-md tabular-nums",
                      ytd > 0 ? "text-[var(--profit)]" : ytd < 0 ? "text-[var(--loss)]" : "text-fg-muted",
                    )}
                  >
                    {ytd > 0 ? "+" : ""}{ytd.toFixed(1)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  // Italic serif + warm muted matches the editorial voice used across the
  // app so partial-empty states (some charts populated, some not) still
  // read consistently.
  return (
    <div className="flex h-32 items-center justify-center px-4 text-center">
      <p className="font-display italic text-body-sm text-fg-muted leading-snug">
        {label}
      </p>
    </div>
  );
}

// ─── Section Card ───────────────────────────────────────────

function SectionCard({
  title,
  eyebrow,
  icon: Icon,
  value,
  valueTone,
  children,
}: {
  title: string;
  /** Tracked-caps tag above the serif title (e.g. "§ DRAWDOWN"). */
  eyebrow?: string;
  icon: React.ElementType;
  /** Optional last-value chip (right-aligned in the header). Accepts a
   *  ready-formatted string so SVG charts can surface the most recent
   *  data-point as a crosshair-style readout. */
  value?: string;
  /** Tones the value chip for profit/loss/neutral semantics. */
  valueTone?: "profit" | "loss" | "neutral";
  children: React.ReactNode;
}) {
  // 2026-04-21: lifted to serif-italic `.t-section-display` so every
  // analytics card shares the editorial voice the dashboard hero set.
  // Eyebrow chip is optional and prints above the title as `§ LABEL`
  // when supplied — matches the page-level header pattern.
  const toneClass =
    valueTone === "profit"
      ? "text-[var(--profit)]"
      : valueTone === "loss"
        ? "text-[var(--loss)]"
        : "text-fg";
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
          <div className="flex flex-col gap-0.5 min-w-0">
            {eyebrow ? (
              <span className="t-label">{eyebrow}</span>
            ) : null}
            <h2 className="t-section-display text-ink-1000 truncate">{title}</h2>
          </div>
        </div>
        {value ? (
          <span
            aria-label={`Current value ${value}`}
            className={cn("t-num-md shrink-0 tabular-nums", toneClass)}
          >
            {value}
          </span>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Trade Stats Table ──────────────────────────────────────

function TradeStatsTable({ stats }: { stats: ReturnType<typeof computeTradeStats> }) {
  // BUG-034 — "1 scratch" trade used to show
  //   Win Rate 0.0% · Profit Factor 0.00 · Avg Loss -$0.00
  // all three are wrong:
  //   · 0 decided trades → win-rate denominator is 0, not a 0 %.
  //   · Profit factor 0/0 is undefined, not 0.
  //   · There was no losing trade, so "-$0.00" puts a negative sign on a
  //     zero average that doesn't exist.
  // Render "n/a" in all three cases; keep the scratch count as context.
  const winRateLabel =
    stats.winRate == null
      ? stats.scratches > 0
        ? `n/a (${stats.scratches} scratch${stats.scratches === 1 ? "" : "es"})`
        : "n/a"
      : stats.scratches > 0
        ? `${stats.winRate.toFixed(1)}% (${stats.scratches} scratch${stats.scratches === 1 ? "" : "es"})`
        : `${stats.winRate.toFixed(1)}%`;

  const profitFactorLabel =
    stats.profitFactor == null
      ? "n/a"
      : stats.profitFactor === Infinity
        ? "Inf"
        : stats.profitFactor.toFixed(2);

  const avgWinLabel = stats.avgWin == null ? "n/a" : `$${stats.avgWin.toFixed(2)}`;
  const avgLossLabel = stats.avgLoss == null ? "n/a" : `-$${stats.avgLoss.toFixed(2)}`;

  // 2026-04-21 polish — tone hints drive per-row color so losses render
  // in coral, wins in chartreuse, and neutral metadata stays fg-muted.
  // "neutral" leaves the value in the default fg color so counts + hold
  // times don't read as profit/loss.
  type Tone = "profit" | "loss" | "neutral";
  const rows: { label: string; value: string; tone: Tone }[] = [
    { label: "Total Trades",    value: String(stats.totalTrades),                          tone: "neutral" },
    { label: "Win Rate",        value: winRateLabel,                                       tone: "neutral" },
    { label: "Profit Factor",   value: profitFactorLabel,                                  tone: "neutral" },
    { label: "Avg Win",         value: avgWinLabel,                                        tone: stats.avgWin == null ? "neutral" : "profit" },
    { label: "Avg Loss",        value: avgLossLabel,                                       tone: stats.avgLoss == null ? "neutral" : "loss" },
    { label: "Largest Win",     value: `+$${(stats.largestWin ?? 0).toFixed(2)}`,          tone: stats.largestWin > 0 ? "profit" : "neutral" },
    { label: "Largest Loss",    value: `-$${Math.abs(stats.largestLoss ?? 0).toFixed(2)}`, tone: stats.largestLoss < 0 ? "loss" : "neutral" },
    { label: "Avg Hold Time",   value: formatDuration(stats.avgHoldMs),                    tone: "neutral" },
    { label: "Max Hold Time",   value: formatDuration(stats.maxHoldMs),                    tone: "neutral" },
    { label: "Max Consec. Wins",   value: String(stats.maxConsecWins),                     tone: stats.maxConsecWins > 0 ? "profit" : "neutral" },
    { label: "Max Consec. Losses", value: String(stats.maxConsecLosses),                   tone: stats.maxConsecLosses > 0 ? "loss" : "neutral" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
      {rows.map(({ label, value, tone }) => (
        <div key={label} className="flex items-baseline justify-between py-2 border-b border-border-hair last:border-0">
          {/* Tracked-caps eyebrow for the label — signature metadata voice */}
          <span className="t-label">{label}</span>
          <span
            className={cn(
              "t-num-md tabular-nums",
              tone === "profit" && "text-[var(--profit)]",
              tone === "loss" && "text-[var(--loss)]",
              tone === "neutral" && "text-fg",
            )}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Range selector ─────────────────────────────────────────
// Matches the radio-group pattern used on the strategy EquityPanel. Keys
// are UI labels; values are the `period` strings the backend accepts
// (see `backend/api/routes/portfolio.py` — 7d / 30d / 90d / ytd / 1y / all).
type AnalyticsRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
const RANGES: AnalyticsRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];
const RANGE_TO_PERIOD: Record<AnalyticsRange, string> = {
  "1W": "7d",
  "1M": "30d",
  "3M": "90d",
  YTD: "ytd",
  "1Y": "1y",
  ALL: "all",
};

// Pure presentational; mirrors the chip-style radiogroup on the strategy
// detail EquityPanel so the visual language is consistent across pages.
function RangeSelector({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Analytics range"
      className="flex items-center gap-1 rounded-md border border-border bg-bg p-0.5"
    >
      {RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            data-range={r}
            data-testid={`analytics-range-${r}`}
            onClick={() => onChange(r)}
            className={cn(
              "font-mono text-label px-2.5 py-1 rounded transition-colors",
              active
                ? "bg-bg-elev-2 text-fg"
                : "text-fg-muted hover:text-fg"
            )}
            style={{ letterSpacing: "0.04em" }}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<TradeHistoryEntry[]>([]);
  // Default to 1M so the initial paint matches the prior (hardcoded-30d)
  // behavior — users who never touch the selector see no regression.
  const [range, setRange] = useState<AnalyticsRange>("1M");

  // Live account equity from the dashboard polling pipeline. `null` until
  // the first poll resolves; callers treat `null` as "not ready yet."
  const liveEquity = useAccountEquity();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [perfRes, tradesRes] = await Promise.allSettled([
          getPortfolioPerformance(RANGE_TO_PERIOD[range]),
          getTradeHistory(5000),
        ]);
        if (cancelled) return;
        if (perfRes.status === "fulfilled" && Array.isArray(perfRes.value.equity_curve)) {
          setEquityCurve(
            perfRes.value.equity_curve.filter((point) => (
              typeof point?.date === "string" &&
              Number.isFinite(Number(point.cumulative_pnl)) &&
              (point.value === undefined || Number.isFinite(Number(point.value)))
            )),
          );
        }
        if (tradesRes.status === "fulfilled") {
          const raw = tradesRes.value;
          const wrapped = raw as { trades?: TradeHistoryEntry[] };
          const tradeList = Array.isArray(raw) ? raw : Array.isArray(wrapped.trades) ? wrapped.trades : [];
          setTrades(tradeList);
        }
      } catch {
        // silently handle
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [range]);

  // `baseEquity` is the STARTING equity of the curve (equity level at
  // the curve's first point). We derive it from the live account equity
  // (current) minus the total cumulative P&L, so every point can then be
  // scaled as `baseEquity + cumulative_pnl_at_point`. This replaces the
  // hardcoded $100k constant that used to anchor every chart.
  const baseEquity = useMemo(() => {
    if (equityCurve.length === 0) {
      return liveEquity ?? 0;
    }
    const current = liveEquity ?? 0;
    if (current > 0) {
      return startingEquity(equityCurve, current);
    }
    // No live equity yet — use helper's internal derivation (first
    // point's `value` if present, else fallback derived from a 0 base
    // which will flow through until the store hydrates).
    return startingEquity(equityCurve, 0);
  }, [liveEquity, equityCurve]);

  // Ready when either (a) we have a positive baseEquity, or (b) the
  // curve is empty anyway (nothing to scale). Prevents infinite skeleton
  // on brand-new accounts where neither store nor curve is populated.
  const equityReady =
    baseEquity > 0 ||
    equityCurve.length === 0 ||
    equityCurve.some((p) => typeof p.value === "number" && p.value > 0);

  const dailyReturns = useMemo(() => computeDailyReturns(equityCurve, baseEquity), [equityCurve, baseEquity]);
  const drawdownData = useMemo(() => computeDrawdown(equityCurve, baseEquity), [equityCurve, baseEquity]);
  const rollingSharpe = useMemo(() => computeRollingSharpe(dailyReturns), [dailyReturns]);
  const histogram = useMemo(() => computeHistogram(dailyReturns), [dailyReturns]);
  const monthlyReturns = useMemo(() => computeMonthlyReturns(equityCurve, baseEquity), [equityCurve, baseEquity]);
  const tradeStats = useMemo(() => computeTradeStats(trades), [trades]);
  // closedTradesCount lives here (not after the early return below) so the
  // Rules of Hooks are preserved regardless of the loading branch.
  const closedTradesCount = tradeStats.totalTrades;

  // Show skeleton while data is loading OR while we still have no usable
  // equity reference (live store + curve both missing). Keeps the
  // returns/drawdown from painting with a bogus 0 base.
  if (loading || !equityReady) {
    return (
      <ScrollArea className="h-full">
        <DashboardPageLayout
          eyebrow="§ ANALYTICS"
          title="Portfolio analytics"
          actions={<RangeSelector value={range} onChange={setRange} />}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
          </div>
          <div className="h-[200px] animate-pulse rounded-lg bg-bg-elev-1" />
        </DashboardPageLayout>
      </ScrollArea>
    );
  }

  // Global-empty: every chart/table is empty. Collapse into a single
  // editorial card explaining *why* instead of 4 "No drawdown data" pills.
  const allEmpty =
    drawdownData.length === 0 &&
    rollingSharpe.length === 0 &&
    histogram.length === 0 &&
    monthlyReturns.size === 0 &&
    closedTradesCount === 0;

  if (allEmpty) {
    return (
      <ScrollArea className="h-full">
        <DashboardPageLayout
          eyebrow="§ ANALYTICS"
          title="Portfolio analytics"
          actions={<RangeSelector value={range} onChange={setRange} />}
        >
          <div className="rounded-xl border border-border bg-[var(--panel)] px-8 py-12">
            <div className="flex flex-col gap-4 max-w-[640px]">
              {/* Editorial empty-state uses the token ladder:
                  tracked-caps eyebrow → serif italic headline → body copy
                  → in-line CTA linking to /trade. Matches the voice used
                  on the alerts/reports empty states. */}
              <span className="t-label">§ AWAITING DATA</span>
              <p className="t-section-display">
                Analytics become available after your first closed trades.
              </p>
              <p className="font-sans text-body-sm leading-relaxed text-fg-muted">
                Today: {closedTradesCount} closed trades. The drawdown, returns,
                monthly heatmap and trade stats will appear here as trades
                accumulate.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["Drawdown", "Unlocks after equity history has at least two points."],
                  ["Exposure by factor", "Requires live positions with sector or strategy tags."],
                  ["Strategy attribution", "Requires closed trades with strategy labels."],
                  ["Trade expectancy", "Requires wins and losses, not just open orders."],
                  ["Calendar P/L", "Requires dated closed-trade or equity snapshots."],
                  ["Execution quality", "Requires fills, limits, and quote-at-fill context."],
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-md border border-border-hair bg-bg px-3 py-3">
                    <p className="t-label text-fg-hint">{label}</p>
                    <p className="mt-1 text-label leading-snug text-fg-muted">{detail}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {/* BUG-analytics-empty-cta — direct link to /trade mirrors
                    the dashboard's "Place your first trade" pattern so the
                    empty state always gives the user a concrete next step
                    instead of being a dead end. */}
                <Link
                  href="/trade"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border border-border-strong",
                    "bg-transparent px-4 py-2 font-sans text-body-sm font-medium",
                    "text-fg hover:bg-bg-elev-1 hover:border-brand transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  Place your first trade
                  <span aria-hidden>&rarr;</span>
                </Link>
                <Link
                  href="/strategies"
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-border-hair",
                    "bg-bg px-4 font-sans text-body-sm font-medium text-fg-muted",
                    "transition-colors hover:border-brand hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  Run backtest
                </Link>
                <Link
                  href="/reports"
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-border-hair",
                    "bg-bg px-4 font-sans text-body-sm font-medium text-fg-muted",
                    "transition-colors hover:border-brand hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  View reports
                </Link>
              </div>
            </div>
          </div>
        </DashboardPageLayout>
      </ScrollArea>
    );
  }

  // Round-8 killer-move 2: hero KpiTile strip for Analytics. The page
  // had no clear hero — every chart card had a last-value chip and they
  // competed equally for attention. This 4-tile strip gives a 3-second
  // glance answer: "how am I doing risk-adjusted?" before drilling into
  // the charts below. Sourced from already-computed series so no extra
  // fetch.
  const heroSummary = (() => {
    const latestDd = drawdownData[drawdownData.length - 1]?.dd;
    const latestSharpe = rollingSharpe[rollingSharpe.length - 1]?.sharpe;
    // Build-fix: ``dailyReturns`` is ``{date, ret}[]`` where ``ret`` is a
    // FRACTION (0.012 = +1.2%). Compound them through the period then
    // convert to a percentage at the end.
    const totalReturn = dailyReturns.length > 0
      ? (dailyReturns.reduce((acc, r) => acc * (1 + r.ret), 1) - 1) * 100
      : null;
    const winRate = tradeStats.winRate;
    return { latestDd, latestSharpe, totalReturn, winRate };
  })();

  return (
    <ScrollArea className="h-full">
      <DashboardPageLayout
        eyebrow="§ ANALYTICS"
        title="Portfolio analytics"
        actions={<RangeSelector value={range} onChange={setRange} />}
      >
        {/* Round-8 killer-move 2: hero KpiTile strip. Anchors the page
            in 3 seconds before the user dives into the four charts below.
            Tone-coded so positive returns / rolling Sharpe ≥ 1 read
            green, drawdown reads coral. Hidden when no data exists
            (covered above by the empty-state branch). */}
        <div
          data-slot="analytics-hero"
          className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
          aria-label="Portfolio analytics summary"
        >
          <div className="rounded-lg border border-border bg-[var(--panel)] px-3 py-2.5">
            <p className="t-label mb-1">Total return</p>
            <p
              className={cn(
                "t-num-lg tabular-nums",
                heroSummary.totalReturn != null && heroSummary.totalReturn >= 0
                  ? "text-[var(--profit)]"
                  : heroSummary.totalReturn != null
                    ? "text-[var(--loss)]"
                    : "text-ink-1000",
              )}
            >
              {heroSummary.totalReturn != null
                ? `${heroSummary.totalReturn >= 0 ? "+" : ""}${heroSummary.totalReturn.toFixed(2)}%`
                : "—"}
            </p>
            <p className="t-meta u-muted">period selected</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--panel)] px-3 py-2.5">
            <p className="t-label mb-1">Rolling Sharpe (30d)</p>
            <p
              className={cn(
                "t-num-lg tabular-nums",
                heroSummary.latestSharpe != null && heroSummary.latestSharpe >= 1
                  ? "text-[var(--profit)]"
                  : "text-ink-1000",
              )}
            >
              {heroSummary.latestSharpe != null
                ? heroSummary.latestSharpe.toFixed(2)
                : "—"}
            </p>
            <p className="t-meta u-muted">latest 30-day window</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--panel)] px-3 py-2.5">
            <p className="t-label mb-1">Max drawdown</p>
            <p
              className={cn(
                "t-num-lg tabular-nums",
                heroSummary.latestDd != null && heroSummary.latestDd < 0
                  ? "text-[var(--loss)]"
                  : "text-ink-1000",
              )}
            >
              {heroSummary.latestDd != null
                ? `${heroSummary.latestDd.toFixed(2)}%`
                : "—"}
            </p>
            <p className="t-meta u-muted">deepest underwater equity</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--panel)] px-3 py-2.5">
            <p className="t-label mb-1">Win rate</p>
            <p className="t-num-lg tabular-nums text-ink-1000">
              {heroSummary.winRate != null
                ? `${heroSummary.winRate.toFixed(0)}%`
                : "—"}
            </p>
            <p className="t-meta u-muted">{closedTradesCount} closed trades</p>
          </div>
        </div>

        {/* Slice-10 / BWD-1 (Tastytrade signature): beta-weighted delta
            hero strip. Surfaces SPY-equivalent directional exposure as
            the primary risk metric — a $200 AAPL delta + $200 TSLA
            delta isn't 400 SPY-equivalent units; it's
            (200×1.2) + (200×2.0) = 640 because TSLA moves at 2× SPY.
            BWD makes that math glanceable so a trader can read "if SPY
            drops 1%, my book drops X%" at a glance. Per-position table
            below ranks contributors so the user can see WHICH symbol
            is driving the book's beta. */}
        <BetaWeightedDeltaCard />

        {/* Row 1: Drawdown + Rolling Sharpe */}
        {/* 4-col at 2xl (1536+) matches the dashboard hero layout — all
            four charts line up on wide monitors while staying stacked on
            laptop widths. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(() => {
            // Last-value chips surface the most recent data-point as a
            // TradingView-style crosshair readout. Cheap (last element
            // lookup) and valuable for "where are we now?" glance-value.
            const latestDd = drawdownData[drawdownData.length - 1]?.dd;
            const latestSharpe = rollingSharpe[rollingSharpe.length - 1]?.sharpe;
            // Drawdown tone: non-zero dd is always a loss (<= 0), so any
            // print below zero is coral; flat peak reads neutral.
            const ddLabel = latestDd === undefined
              ? undefined
              : `${(latestDd * 100).toFixed(2)}%`;
            const ddTone: "loss" | "neutral" = (latestDd ?? 0) < 0 ? "loss" : "neutral";
            // Sharpe tone: positive is profit, negative is loss.
            const sharpeLabel = latestSharpe === undefined
              ? undefined
              : latestSharpe.toFixed(2);
            const sharpeTone: "profit" | "loss" | "neutral" =
              (latestSharpe ?? 0) > 0
                ? "profit"
                : (latestSharpe ?? 0) < 0
                  ? "loss"
                  : "neutral";
            return (
              <>
                <SectionCard
                  title="Underwater equity"
                  eyebrow="§ DRAWDOWN"
                  icon={TrendingDown}
                  value={ddLabel}
                  valueTone={ddTone}
                >
                  <DrawdownChart data={drawdownData} />
                </SectionCard>
                <SectionCard
                  title="30-day rolling Sharpe"
                  eyebrow="§ RISK-ADJUSTED"
                  icon={Activity}
                  value={sharpeLabel}
                  valueTone={sharpeTone}
                >
                  <RollingSharpeChart data={rollingSharpe} />
                </SectionCard>
              </>
            );
          })()}
        </div>

        {/* Row 2: Distribution + Trade Stats */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(() => {
            // Distribution legend: mean ± std of daily returns, in %.
            const returnsPct = dailyReturns.map((d) => d.ret * 100);
            const mean =
              returnsPct.length > 0
                ? returnsPct.reduce((s, v) => s + v, 0) / returnsPct.length
                : 0;
            const std =
              returnsPct.length > 1
                ? Math.sqrt(
                    returnsPct.reduce((s, v) => s + (v - mean) ** 2, 0) /
                      (returnsPct.length - 1),
                  )
                : 0;
            const distLabel =
              returnsPct.length > 0
                ? `${mean >= 0 ? "+" : ""}${mean.toFixed(2)}% ± ${std.toFixed(2)}%`
                : undefined;
            return (
              <>
                <SectionCard
                  title="Daily return distribution"
                  eyebrow="§ HISTOGRAM"
                  icon={BarChart3}
                  value={distLabel}
                  valueTone="neutral"
                >
                  <ReturnDistribution bins={histogram} dailyReturns={dailyReturns} />
                </SectionCard>
                <SectionCard
                  title="Trade statistics"
                  eyebrow="§ EXECUTION"
                  icon={Table2}
                  value={`${tradeStats.totalTrades} trades`}
                  valueTone="neutral"
                >
                  <TradeStatsTable stats={tradeStats} />
                </SectionCard>
              </>
            );
          })()}
        </div>

        {/* Row 3: Monthly Heatmap */}
        <SectionCard
          title="Monthly returns"
          eyebrow="§ HEATMAP"
          icon={Calendar}
        >
          <MonthlyHeatmap monthlyReturns={monthlyReturns} />
        </SectionCard>
      </DashboardPageLayout>
    </ScrollArea>
  );
}

/**
 * Slice-10 / BWD-1 (2026 design brief, Tastytrade signature):
 * Beta-weighted-delta hero card. Renders the SPY-equivalent
 * directional exposure number plus a per-position attribution table
 * sorted by absolute BWD contribution, so the user can see at a
 * glance which positions drive their book's beta.
 */
function BetaWeightedDeltaCard() {
  const [greeks, setGreeks] = useState<import("@/types").PortfolioGreeks | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/api")
      .then((m) => m.getPortfolioGreeks())
      .then((g) => {
        if (!cancelled) setGreeks(g);
      })
      .catch(() => {
        // Leave greeks null — card hides itself.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!greeks) return null;
  // Round-15 / persona-7 P0 + Round-24 contract fix: when the backend
  // serves ``is_demo: true`` the greeks are zero/synthetic — render a
  // "data unavailable" affordance instead of treating a flat-delta
  // book as real (actionably wrong on options risk metrics).
  if (greeks.isDemo) {
    return (
      <div className="rounded-xl border border-[color:var(--warn)]/30 bg-[color:var(--warn)]/5 px-4 py-3">
        <div className="t-label text-[color:var(--warn)] mb-1">§ BETA-WEIGHTED DELTA</div>
        <p className="t-meta italic text-fg-muted">
          Greek aggregates are temporarily unavailable. Showing no data
          rather than zeros — refresh after upstream recovery.
        </p>
      </div>
    );
  }
  if (
    greeks.netDelta === 0 &&
    greeks.betaWeightedDelta === 0 &&
    (!greeks.byPosition || greeks.byPosition.length === 0)
  ) {
    return null;
  }
  const bwd = greeks.betaWeightedDelta;
  const tone =
    bwd > 0
      ? "text-[var(--profit)]"
      : bwd < 0
        ? "text-[var(--loss)]"
        : "text-ink-1000";
  const ranked = (greeks.byPosition ?? [])
    .map(
      (p) =>
        p as unknown as {
          symbol: string;
          quantity: number;
          delta: number;
          beta?: number;
          beta_weighted_delta?: number;
        },
    )
    .filter((p) => Math.abs(p.delta ?? 0) > 0.5)
    .sort(
      (a, b) =>
        Math.abs(b.beta_weighted_delta ?? b.delta * (b.beta ?? 1)) -
        Math.abs(a.beta_weighted_delta ?? a.delta * (a.beta ?? 1)),
    );
  return (
    <section
      data-slot="bwd-card"
      className="mt-4 rounded-lg border border-border bg-[var(--panel)] p-4"
      aria-label="Portfolio beta-weighted delta"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-3">
        <div>
          <p className="t-label mb-1">Beta-weighted delta · SPY equivalent</p>
          <p className={cn("t-num-lg tabular-nums font-medium", tone)}>
            {bwd > 0 ? "+" : ""}
            {bwd.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="t-label mb-1">Net delta · raw</p>
          <p className="font-mono tabular-nums text-[18px] text-ink-1000">
            {greeks.netDelta > 0 ? "+" : ""}
            {greeks.netDelta.toFixed(2)}
          </p>
        </div>
        <p className="t-meta u-muted italic ml-auto max-w-[42ch]">
          Sums each position&apos;s delta times its symbol-to-SPY beta. Reads
          as &ldquo;if SPY drops 1%, my book moves X% in equivalent dollar
          terms.&rdquo;
        </p>
      </div>
      {ranked.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--panel)] border-b border-border-hair">
                <th className="t-label text-left px-2 py-1.5">Symbol</th>
                <th className="t-label text-right px-2 py-1.5">Qty</th>
                <th className="t-label text-right px-2 py-1.5">δ</th>
                <th className="t-label text-right px-2 py-1.5">β to SPY</th>
                <th className="t-label text-right px-2 py-1.5">
                  BWD contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 8).map((p) => {
                const contrib =
                  p.beta_weighted_delta ?? p.delta * (p.beta ?? 1);
                const cTone =
                  contrib > 0
                    ? "text-[var(--profit)]"
                    : contrib < 0
                      ? "text-[var(--loss)]"
                      : "text-ink-1000";
                return (
                  <tr key={p.symbol} className="border-b border-border-hair">
                    <td className="px-2 py-1.5 font-mono text-label text-ink-1000">
                      {p.symbol}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-label tabular-nums">
                      {p.quantity}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-label tabular-nums">
                      {p.delta?.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-label tabular-nums u-muted">
                      {(p.beta ?? 1).toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-label tabular-nums",
                        cTone,
                      )}
                    >
                      {contrib > 0 ? "+" : ""}
                      {contrib.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
