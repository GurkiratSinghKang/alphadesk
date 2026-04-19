"use client";

import { useState, useEffect, useMemo } from "react";
import { TrendingDown, BarChart3, Activity, Calendar, Table2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DashboardPageLayout } from "@/components/layouts";
import { getPortfolioPerformance, getTradeHistory, type TradeHistoryEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountEquity, equityAtPoint, startingEquity } from "@/lib/accountEquity";

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
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
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
  // Group by month, compute return for each month
  const monthly = new Map<string, { first: number; last: number }>();
  for (const pt of curve) {
    const key = pt.date.slice(0, 7); // YYYY-MM
    const entry = monthly.get(key);
    const equity = equityAtPoint(pt, baseEquity);
    if (!entry) {
      monthly.set(key, { first: equity, last: equity });
    } else {
      entry.last = equity;
    }
  }
  const returns = new Map<string, number>();
  for (const [key, val] of monthly) {
    returns.set(key, val.first > 0 ? ((val.last - val.first) / val.first) * 100 : 0);
  }
  return returns;
}

function computeTradeStats(trades: TradeHistoryEntry[]) {
  // Normalize field names: accept both snake_case and camelCase from API
  const normalized = trades.map((t: any) => ({
    ...t,
    exit_price: t.exit_price ?? t.exitPrice ?? null,
    entry_price: t.entry_price ?? t.entryPrice ?? 0,
    pnl: t.pnl ?? t.realizedPnl ?? null,
    entry_time: t.entry_time ?? t.entryTime ?? "",
    exit_time: t.exit_time ?? t.exitTime ?? null,
    status: t.status ?? "open",
  }));

  // Filter for closed trades: has exit_price or status indicates closed
  const closed = normalized.filter(
    (t) => (t.exit_price !== null && t.pnl !== null) || t.status === "closed"
  );
  if (closed.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, scratches: 0, winRate: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
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
    winRate: decidedCount > 0 ? (wins.length / decidedCount) * 100 : 0,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? totalWin / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
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
  const w = 600, h = 200, px = 40, py = 20;
  const minDD = Math.min(...data.map((d) => d.dd));
  const yScale = (v: number) => py + ((0 - v) / (0 - minDD || 1)) * (h - 2 * py);
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
          <line x1={px} y1={yScale(t)} x2={w - px} y2={yScale(t)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4 4" />
          <text x={px - 4} y={yScale(t) + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="9" fontFamily="monospace">
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
        <text key={idx} x={xScale(idx)} y={h - 2} textAnchor="middle" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace">
          {data[idx]?.date?.slice(5) ?? ""}
        </text>
      ))}
    </svg>
  );
}

function RollingSharpeChart({ data }: { data: { date: string; sharpe: number }[] }) {
  if (data.length === 0) return <EmptyState label="Not enough data for rolling Sharpe (need 30+ days)" />;
  const w = 600, h = 200, px = 40, py = 20;
  const values = data.map((d) => d.sharpe);
  const minV = Math.min(...values, -1);
  const maxV = Math.max(...values, 1);
  const range = maxV - minV || 1;
  const yScale = (v: number) => py + ((maxV - v) / range) * (h - 2 * py);
  const xScale = (i: number) => px + (i / (data.length - 1 || 1)) * (w - 2 * px);

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"}${(xScale(i) ?? 0).toFixed(1)},${(yScale(d.sharpe) ?? 0).toFixed(1)}`).join(" ");

  const yTicks = [maxV, (maxV + minV) / 2, minV];
  const zeroY = yScale(0);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={px} y1={yScale(t)} x2={w - px} y2={yScale(t)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4 4" />
          <text x={px - 4} y={yScale(t) + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="9" fontFamily="monospace">
            {(t ?? 0).toFixed(1)}
          </text>
        </g>
      ))}
      {/* Zero line */}
      {minV < 0 && maxV > 0 && (
        <line x1={px} y1={zeroY} x2={w - px} y2={zeroY} stroke="var(--muted-foreground)" strokeWidth="0.5" strokeDasharray="2 2" />
      )}
      <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
      {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
        <text key={idx} x={xScale(idx)} y={h - 2} textAnchor="middle" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace">
          {data[idx]?.date?.slice(5) ?? ""}
        </text>
      ))}
    </svg>
  );
}

function ReturnDistribution({ bins, dailyReturns }: { bins: { min: number; max: number; count: number }[]; dailyReturns: { ret: number }[] }) {
  if (bins.length === 0) return <EmptyState label="No return data" />;
  const w = 600, h = 200, px = 40, py = 20;
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
    const normY = py + ((maxCount - density) / maxCount) * (h - 2 * py);
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

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Bars */}
      {bins.map((b, i) => {
        const barH = (b.count / maxCount) * (h - 2 * py);
        const x = px + i * barW;
        const y = h - py - barH;
        const midVal = (b.min + b.max) / 2;
        return (
          <rect key={i} x={x + 1} y={y} width={Math.max(barW - 2, 1)} height={barH}
            fill={midVal >= 0 ? upFill : downFill}
            rx="1"
          />
        );
      })}
      {/* Normal curve overlay */}
      <path d={normalPoints} fill="none" stroke="var(--chart-4)" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* X-axis labels */}
      {[0, Math.floor(bins.length / 2), bins.length - 1].map((idx) => (
        <text key={idx} x={px + idx * barW + barW / 2} y={h - 2} textAnchor="middle" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace">
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
    return "var(--panel)";
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-muted-foreground font-medium">Year</th>
            {months.map((m) => (
              <th key={m} className="px-1 py-1 text-center text-muted-foreground font-medium">{m}</th>
            ))}
            <th className="px-2 py-1 text-center text-muted-foreground font-medium">YTD</th>
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
                <td className="px-2 py-1 text-foreground font-medium tabular-nums">{year}</td>
                {months.map((_, mi) => {
                  const key = `${year}-${String(mi + 1).padStart(2, "0")}`;
                  const val = monthlyReturns.get(key);
                  return (
                    <td key={mi} className="px-1 py-1 text-center">
                      {val !== undefined ? (
                        <span
                          className="inline-block w-full rounded px-1 py-0.5 tabular-nums font-medium"
                          style={{ backgroundColor: cellColor(val), color: Math.abs(val) > maxAbs * 0.3 ? "var(--ink-1000)" : "var(--fg)" }}
                        >
                          {(val ?? 0) >= 0 ? "+" : ""}{(val ?? 0).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">--</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-center">
                  <span className={cn("tabular-nums font-semibold", ytd >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {(ytd ?? 0) >= 0 ? "+" : ""}{(ytd ?? 0).toFixed(1)}%
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
      <p className="font-display italic text-[13px] text-fg-muted leading-snug">
        {label}
      </p>
    </div>
  );
}

// ─── Section Card ───────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Trade Stats Table ──────────────────────────────────────

function TradeStatsTable({ stats }: { stats: ReturnType<typeof computeTradeStats> }) {
  // Surface scratches alongside win-rate so traders can see when the
  // denominator is smaller than totalTrades — e.g. "54% (3 scratches)".
  const winRateLabel =
    stats.scratches > 0
      ? `${(stats.winRate ?? 0).toFixed(1)}% (${stats.scratches} scratch${stats.scratches === 1 ? "" : "es"})`
      : `${(stats.winRate ?? 0).toFixed(1)}%`;

  const rows: [string, string][] = [
    ["Total Trades", String(stats.totalTrades)],
    ["Win Rate", winRateLabel],
    ["Profit Factor", stats.profitFactor === Infinity ? "Inf" : (stats.profitFactor ?? 0).toFixed(2)],
    ["Avg Win", `$${(stats.avgWin ?? 0).toFixed(2)}`],
    ["Avg Loss", `-$${(stats.avgLoss ?? 0).toFixed(2)}`],
    ["Largest Win", `$${(stats.largestWin ?? 0).toFixed(2)}`],
    ["Largest Loss", `$${Math.abs(stats.largestLoss ?? 0).toFixed(2)}`],
    ["Avg Hold Time", formatDuration(stats.avgHoldMs)],
    ["Max Hold Time", formatDuration(stats.maxHoldMs)],
    ["Max Consec. Wins", String(stats.maxConsecWins)],
    ["Max Consec. Losses", String(stats.maxConsecLosses)],
  ];

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/50">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-xs font-medium text-foreground tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<TradeHistoryEntry[]>([]);

  // Live account equity from the dashboard polling pipeline. `null` until
  // the first poll resolves; callers treat `null` as "not ready yet."
  const liveEquity = useAccountEquity();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [perfRes, tradesRes] = await Promise.allSettled([
          getPortfolioPerformance(),
          getTradeHistory(5000),
        ]);
        if (cancelled) return;
        if (perfRes.status === "fulfilled" && Array.isArray(perfRes.value.equity_curve)) {
          setEquityCurve(perfRes.value.equity_curve);
        }
        if (tradesRes.status === "fulfilled") {
          const raw = tradesRes.value;
          const tradeList = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.trades) ? (raw as any).trades : [];
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
  }, []);

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
        <DashboardPageLayout eyebrow="§ ANALYTICS" title="Portfolio analytics">
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
        >
          <div className="rounded-xl border border-border bg-[var(--panel)] px-8 py-12">
            <div className="flex flex-col gap-3 max-w-[640px]">
              <p
                className="font-sans font-semibold text-[10.5px] uppercase text-fg-muted"
                style={{ letterSpacing: "0.14em" }}
              >
                Awaiting data
              </p>
              <p className="font-display italic text-[20px] leading-snug text-fg">
                Analytics become available after your first closed trades.
              </p>
              <p className="font-sans text-[13px] leading-relaxed text-fg-muted">
                Today: {closedTradesCount} closed trades. The drawdown, returns,
                monthly heatmap and trade stats will appear here as trades
                accumulate.
              </p>
            </div>
          </div>
        </DashboardPageLayout>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <DashboardPageLayout
        eyebrow="§ ANALYTICS"
        title="Portfolio analytics"
      >
        {/* Row 1: Drawdown + Rolling Sharpe */}
        {/* Viewport audit r5 #6: with DashboardPageLayout now lifted to
            1480/1680 max-w at 2xl, a 4-col lay-out fits on 1920+/4K — quant
            users can see all four charts side-by-side. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <SectionCard title="Underwater equity (drawdown)" icon={TrendingDown}>
            <DrawdownChart data={drawdownData} />
          </SectionCard>
          <SectionCard title="30-day rolling Sharpe ratio" icon={Activity}>
            <RollingSharpeChart data={rollingSharpe} />
          </SectionCard>
        </div>

        {/* Row 2: Distribution + Trade Stats */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <SectionCard title="Daily return distribution" icon={BarChart3}>
            <ReturnDistribution bins={histogram} dailyReturns={dailyReturns} />
          </SectionCard>
          <SectionCard title="Trade statistics" icon={Table2}>
            <TradeStatsTable stats={tradeStats} />
          </SectionCard>
        </div>

        {/* Row 3: Monthly Heatmap */}
        <SectionCard title="Monthly returns heatmap" icon={Calendar}>
          <MonthlyHeatmap monthlyReturns={monthlyReturns} />
        </SectionCard>
      </DashboardPageLayout>
    </ScrollArea>
  );
}
