"use client";

import { useState, useMemo } from "react";
import { Play, BarChart3, TrendingUp, TrendingDown, GitCompareArrows, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, safeNum } from "@/lib/utils";
import { getBars } from "@/lib/api";
import type { OHLCVBar } from "@/types";

/**
 * SVG `fill` / `stroke` don't resolve CSS vars, so read the tokens off
 * :root and return concrete strings. Fallbacks match the tokens' hex so
 * pre-hydration paints still look correct.
 */
function getTokenVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}
function tokenRgba(name: string, alpha: number, fallbackHex: string): string {
  const raw = getTokenVar(name, fallbackHex).trim();
  const hex = raw.startsWith("#") ? raw : fallbackHex;
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Types ─────────────────────────────────────────────────

interface TradeRecord {
  entryBar: number;
  exitBar: number;
  pnl: number;
}

interface BacktestResult {
  totalReturn: number;
  totalReturnPct: number;
  trades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  sharpe: number;
  equityCurve: number[];
  drawdownCurve: number[];
  // Enhanced metrics
  profitFactor: number;
  calmarRatio: number;
  avgTradeDuration: number; // bars
  exposureTimePct: number;  // % of time in market
  benchmarkCurve: number[]; // SPY buy-and-hold equity curve
  label?: string;           // label for compare mode
}

function emptyResult(capital: number): BacktestResult {
  return {
    totalReturn: 0, totalReturnPct: 0, trades: 0, wins: 0, losses: 0,
    maxDrawdown: 0, sharpe: 0, equityCurve: [capital], drawdownCurve: [0],
    profitFactor: 0, calmarRatio: 0, avgTradeDuration: 0, exposureTimePct: 0,
    benchmarkCurve: [capital],
  };
}

// ─── Transaction Cost Helpers ──────────────────────────────

function applyBuyCosts(price: number, shares: number, commission: number, slippagePct: number): { effectivePrice: number; totalCost: number } {
  const slippage = price * (slippagePct / 100);
  const effectivePrice = price + slippage;
  const totalCost = shares * effectivePrice + commission;
  return { effectivePrice, totalCost };
}

function applySellProceeds(price: number, shares: number, commission: number, slippagePct: number): { effectivePrice: number; totalProceeds: number } {
  const slippage = price * (slippagePct / 100);
  const effectivePrice = price - slippage;
  const totalProceeds = shares * effectivePrice - commission;
  return { effectivePrice, totalProceeds };
}

// ─── Enhanced Metrics Calculator ───────────────────────────

function computeEnhancedMetrics(
  tradeRecords: TradeRecord[],
  equityCurve: number[],
  totalBars: number,
  initialCapital: number,
): { profitFactor: number; calmarRatio: number; avgTradeDuration: number; exposureTimePct: number; drawdownCurve: number[] } {
  // Profit Factor — break-even trades (pnl === 0) are scratches and
  // don't contribute to gross profits OR gross losses. Matches backend
  // `hit_rate` semantics and analytics/page.tsx.
  const grossProfits = tradeRecords.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(tradeRecords.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : (grossProfits > 0 ? Infinity : 0);

  // Drawdown curve
  let peak = initialCapital;
  const drawdownCurve = equityCurve.map(eq => {
    if (eq > peak) peak = eq;
    return peak > 0 ? (eq - peak) / peak * 100 : 0;
  });

  const maxDd = Math.abs(Math.min(...drawdownCurve));

  // Calmar Ratio: annualized return / max drawdown
  const totalReturnPct = ((equityCurve[equityCurve.length - 1] - initialCapital) / initialCapital) * 100;
  const annualizedReturn = totalBars > 0 ? totalReturnPct * (252 / totalBars) : 0;
  const calmarRatio = maxDd > 0 ? annualizedReturn / maxDd : 0;

  // Average trade duration (bars held)
  const avgTradeDuration = tradeRecords.length > 0
    ? tradeRecords.reduce((s, t) => s + (t.exitBar - t.entryBar), 0) / tradeRecords.length
    : 0;

  // Exposure time (% of bars in market)
  const barsInMarket = tradeRecords.reduce((s, t) => s + (t.exitBar - t.entryBar), 0);
  const exposureTimePct = totalBars > 0 ? (barsInMarket / totalBars) * 100 : 0;

  return { profitFactor, calmarRatio, avgTradeDuration, exposureTimePct, drawdownCurve };
}

// ─── Backtest Engines ─────────────────────────────────────

function runSmaBacktest(bars: OHLCVBar[], fastPeriod: number, slowPeriod: number, initialCapital: number, commission: number, slippagePct: number): BacktestResult {
  if (bars.length < slowPeriod + 10) return emptyResult(initialCapital);

  const closes = bars.map(b => b.close);
  const sma = (data: number[], period: number, idx: number) => {
    if (idx < period - 1) return 0;
    let sum = 0;
    for (let i = idx - period + 1; i <= idx; i++) sum += data[i];
    return sum / period;
  };

  let capital = initialCapital;
  let position = 0;
  let entryPrice = 0;
  let entryBar = 0;
  let trades = 0, wins = 0, losses = 0;
  const equityCurve: number[] = [capital];
  let peak = capital;
  let maxDd = 0;
  const returns: number[] = [];
  const tradeRecords: TradeRecord[] = [];

  for (let i = slowPeriod; i < closes.length; i++) {
    const fastSma = sma(closes, fastPeriod, i);
    const slowSma = sma(closes, slowPeriod, i);
    const prevFast = sma(closes, fastPeriod, i - 1);
    const prevSlow = sma(closes, slowPeriod, i - 1);

    if (prevFast <= prevSlow && fastSma > slowSma && position === 0) {
      const { effectivePrice, totalCost } = applyBuyCosts(closes[i], Math.floor(capital / (closes[i] * (1 + slippagePct / 100) + commission / Math.max(Math.floor(capital / closes[i]), 1))), commission, slippagePct);
      position = Math.floor((capital - commission) / (closes[i] * (1 + slippagePct / 100)));
      if (position <= 0) { position = 0; continue; }
      entryPrice = effectivePrice;
      entryBar = i;
      capital -= position * effectivePrice + commission;
    } else if (prevFast >= prevSlow && fastSma < slowSma && position > 0) {
      const { effectivePrice, totalProceeds } = applySellProceeds(closes[i], position, commission, slippagePct);
      const pnl = totalProceeds - (position * entryPrice);
      capital += totalProceeds;
      trades++;
      if (pnl > 0) wins++; else if (pnl < 0) losses++;
      tradeRecords.push({ entryBar, exitBar: i, pnl });
      position = 0;
    }

    const equity = capital + position * closes[i];
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    if (equityCurve.length > 1) {
      returns.push((equity - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2]);
    }
  }

  if (position > 0) {
    const { totalProceeds } = applySellProceeds(closes[closes.length - 1], position, commission, slippagePct);
    const pnl = totalProceeds - position * entryPrice;
    capital += totalProceeds;
    tradeRecords.push({ entryBar, exitBar: closes.length - 1, pnl });
    trades++; if (pnl > 0) wins++; else if (pnl < 0) losses++;
    position = 0;
  }

  const totalReturn = capital - initialCapital;
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

  const enhanced = computeEnhancedMetrics(tradeRecords, equityCurve, closes.length - slowPeriod, initialCapital);

  return {
    totalReturn, totalReturnPct: (totalReturn / initialCapital) * 100,
    trades, wins, losses, maxDrawdown: maxDd * 100,
    sharpe: Math.round(sharpe * 100) / 100,
    equityCurve,
    ...enhanced,
    benchmarkCurve: [],
  };
}

function runMacdBacktest(bars: OHLCVBar[], initialCapital: number, commission: number, slippagePct: number): BacktestResult {
  if (bars.length < 35) return emptyResult(initialCapital);

  const closes = bars.map(b => b.close);
  const ema = (data: number[], period: number): number[] => {
    const result: number[] = [data[0]];
    const k = 2 / (period + 1);
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);

  let capital = initialCapital;
  let position = 0;
  let entryPrice = 0;
  let entryBar = 0;
  let trades = 0, wins = 0, losses = 0;
  const equityCurve: number[] = [capital];
  let peak = capital;
  let maxDd = 0;
  const returns: number[] = [];
  const tradeRecords: TradeRecord[] = [];

  for (let i = 27; i < closes.length; i++) {
    const macdPrev = macdLine[i - 1] - signalLine[i - 1];
    const macdCurr = macdLine[i] - signalLine[i];

    if (macdPrev <= 0 && macdCurr > 0 && position === 0) {
      position = Math.floor((capital - commission) / (closes[i] * (1 + slippagePct / 100)));
      if (position <= 0) { position = 0; continue; }
      const { effectivePrice } = applyBuyCosts(closes[i], position, commission, slippagePct);
      entryPrice = effectivePrice;
      entryBar = i;
      capital -= position * effectivePrice + commission;
    } else if (macdPrev >= 0 && macdCurr < 0 && position > 0) {
      const { totalProceeds } = applySellProceeds(closes[i], position, commission, slippagePct);
      const pnl = totalProceeds - position * entryPrice;
      capital += totalProceeds;
      trades++;
      if (pnl > 0) wins++; else if (pnl < 0) losses++;
      tradeRecords.push({ entryBar, exitBar: i, pnl });
      position = 0;
    }

    const equity = capital + position * closes[i];
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    if (equityCurve.length > 1) {
      returns.push((equity - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2]);
    }
  }

  if (position > 0) {
    const { totalProceeds } = applySellProceeds(closes[closes.length - 1], position, commission, slippagePct);
    const pnl = totalProceeds - position * entryPrice;
    capital += totalProceeds;
    tradeRecords.push({ entryBar, exitBar: closes.length - 1, pnl });
    trades++; if (pnl > 0) wins++; else if (pnl < 0) losses++;
    position = 0;
  }

  const totalReturn = capital - initialCapital;
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;

  const enhanced = computeEnhancedMetrics(tradeRecords, equityCurve, closes.length - 27, initialCapital);

  return {
    totalReturn, totalReturnPct: (totalReturn / initialCapital) * 100,
    trades, wins, losses, maxDrawdown: maxDd * 100,
    sharpe: Math.round((stdRet > 0 ? meanRet / stdRet * Math.sqrt(252) : 0) * 100) / 100,
    equityCurve,
    ...enhanced,
    benchmarkCurve: [],
  };
}

function runRsiBacktest(bars: OHLCVBar[], period: number, oversold: number, overbought: number, capital: number, commission: number, slippagePct: number): BacktestResult {
  if (bars.length < period + 10) return emptyResult(capital);

  const closes = bars.map(b => b.close);
  let cash = capital, position = 0, entryPrice = 0, entryBar = 0;
  let trades = 0, wins = 0, losses = 0;
  const equityCurve = [capital];
  let peak = capital, maxDd = 0;
  const returns: number[] = [];
  const tradeRecords: TradeRecord[] = [];

  for (let i = period; i < closes.length; i++) {
    let gains = 0, loss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff; else loss -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = loss / period;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));

    if (rsi < oversold && position === 0) {
      position = Math.floor((cash - commission) / (closes[i] * (1 + slippagePct / 100)));
      if (position <= 0) { position = 0; continue; }
      const { effectivePrice } = applyBuyCosts(closes[i], position, commission, slippagePct);
      entryPrice = effectivePrice;
      entryBar = i;
      cash -= position * effectivePrice + commission;
    } else if (rsi > overbought && position > 0) {
      const { totalProceeds } = applySellProceeds(closes[i], position, commission, slippagePct);
      const pnl = totalProceeds - position * entryPrice;
      cash += totalProceeds;
      trades++; if (pnl > 0) wins++; else if (pnl < 0) losses++;
      tradeRecords.push({ entryBar, exitBar: i, pnl });
      position = 0;
    }

    const equity = cash + position * closes[i];
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    if (equityCurve.length > 1) returns.push((equity - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2]);
  }

  if (position > 0) {
    const { totalProceeds } = applySellProceeds(closes[closes.length - 1], position, commission, slippagePct);
    const pnl = totalProceeds - position * entryPrice;
    cash += totalProceeds;
    tradeRecords.push({ entryBar, exitBar: closes.length - 1, pnl });
    trades++; if (pnl > 0) wins++; else if (pnl < 0) losses++;
    position = 0;
  }

  const totalReturn = cash - capital;
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;

  const enhanced = computeEnhancedMetrics(tradeRecords, equityCurve, closes.length - period, capital);

  return {
    totalReturn, totalReturnPct: (totalReturn / capital) * 100,
    trades, wins, losses, maxDrawdown: maxDd * 100,
    sharpe: Math.round((stdRet > 0 ? meanRet / stdRet * Math.sqrt(252) : 0) * 100) / 100,
    equityCurve,
    ...enhanced,
    benchmarkCurve: [],
  };
}

// ─── Benchmark (SPY Buy-and-Hold) ──────────────────────────

function computeBenchmarkCurve(spyBars: OHLCVBar[], initialCapital: number, startIdx: number): number[] {
  if (spyBars.length === 0) return [initialCapital];
  const sliced = spyBars.slice(startIdx);
  if (sliced.length === 0) return [initialCapital];
  const startPrice = sliced[0].close;
  return sliced.map(b => initialCapital * (b.close / startPrice));
}

// ─── SVG Components ────────────────────────────────────────

function EquityCurveSvg({
  result,
  resultB,
}: {
  result: BacktestResult;
  resultB?: BacktestResult | null;
}) {
  const data = result.equityCurve;
  if (data.length < 2) return null;

  const w = 600, h = 140;
  const startVal = data[0];
  const allValues = [...data, ...(result.benchmarkCurve ?? []), ...(resultB?.equityCurve ?? [])];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const toPoint = (v: number, i: number, total: number) => {
    const x = (i / (total - 1)) * w;
    const y = h - ((v - min) / range) * (h - 10) - 5;
    return { x, y };
  };

  // Main equity curve
  const points = data.map((v, i) => toPoint(v, i, data.length));
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");

  // Area fill: green above start, red below start
  const startY = h - ((startVal - min) / range) * (h - 10) - 5;

  // Create clipping path split at start value
  const areaPathAbove = `M${points[0].x},${points[0].y} ${points.map(p => `L${p.x},${Math.min(p.y, startY)}`).join(" ")} L${points[points.length - 1].x},${startY} L${points[0].x},${startY} Z`;
  const areaPathBelow = `M${points[0].x},${startY} ${points.map(p => `L${p.x},${Math.max(p.y, startY)}`).join(" ")} L${points[points.length - 1].x},${startY} Z`;

  // Full area for gradient
  const fullAreaPath = `M${points[0].x},${points[0].y} ${points.map(p => `L${p.x},${p.y}`).join(" ")} L${points[points.length - 1].x},${h} L${points[0].x},${h} Z`;

  const isUp = data[data.length - 1] >= startVal;

  // Benchmark curve (SPY)
  const bench = result.benchmarkCurve ?? [];
  const benchPolyline = bench.length > 1
    ? bench.map((v, i) => { const p = toPoint(v, i, bench.length); return `${p.x},${p.y}`; }).join(" ")
    : null;

  // Compare mode curve B
  const curveB = resultB?.equityCurve ?? [];
  const curveBPolyline = curveB.length > 1
    ? curveB.map((v, i) => { const p = toPoint(v, i, curveB.length); return `${p.x},${p.y}`; }).join(" ")
    : null;

  // Drawdown sub-chart
  const ddData = result.drawdownCurve;
  const ddH = 40;
  const ddMin = Math.min(...ddData, 0);
  const ddRange = Math.abs(ddMin) || 1;

  const ddPoints = ddData.map((v, i) => {
    const x = (i / (ddData.length - 1)) * w;
    const y = (Math.abs(v) / ddRange) * (ddH - 4) + 2;
    return { x, y };
  });
  const ddAreaPath = `M${ddPoints[0].x},0 ${ddPoints.map(p => `L${p.x},${p.y}`).join(" ")} L${ddPoints[ddPoints.length - 1].x},0 Z`;

  // Token-derived fills / strokes. Profit-tint for "above start",
  // loss-tint for "below start"; amber for the Strategy-B compare line.
  const profitFill = tokenRgba("--up-500", 0.12, "#a8d04d");
  const lossFill = tokenRgba("--down-500", 0.12, "#e07856");
  const lossStroke = getTokenVar("--down-500", "#e07856");
  const ddFill = tokenRgba("--down-500", 0.2, "#e07856");
  const amber = getTokenVar("--amber-500", "#d9a441");

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[140px] rounded border border-border bg-[var(--panel)]" preserveAspectRatio="none">
        {/* Profit area (above start) */}
        <path d={areaPathAbove} fill={profitFill} />
        {/* Loss area (below start) */}
        <path d={areaPathBelow} fill={lossFill} />
        {/* Start line */}
        <line x1={0} y1={startY} x2={w} y2={startY} stroke="var(--muted-foreground)" strokeWidth="0.5" strokeDasharray="4 2" opacity={0.4} />
        {/* Benchmark curve */}
        {benchPolyline && (
          <polyline points={benchPolyline} fill="none" stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="3 2" opacity={0.6} />
        )}
        {/* Compare B curve */}
        {curveBPolyline && (
          <polyline points={curveBPolyline} fill="none" stroke={amber} strokeWidth="1.5" opacity={0.8} />
        )}
        {/* Main equity curve */}
        <polyline points={polyline} fill="none" stroke={isUp ? "var(--profit)" : "var(--loss)"} strokeWidth="1.5" />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 rounded" style={{ background: isUp ? "var(--profit)" : "var(--loss)" }} />
          <span className="text-label text-muted-foreground">{result.label ?? "Strategy"}</span>
        </div>
        {benchPolyline && (
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-4 rounded border-t border-dashed border-muted-foreground" />
            <span className="text-label text-muted-foreground">SPY Buy & Hold</span>
          </div>
        )}
        {curveBPolyline && resultB && (
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-4 rounded" style={{ background: amber }} />
            <span className="text-label text-muted-foreground">{resultB.label ?? "Strategy B"}</span>
          </div>
        )}
      </div>

      {/* Drawdown sub-chart */}
      {ddData.length > 1 && Math.abs(ddMin) > 0.01 && (
        <div>
          <p className="text-label uppercase tracking-wider text-muted-foreground font-semibold mb-0.5 px-1">Drawdown</p>
          <svg viewBox={`0 0 ${w} ${ddH}`} className="w-full h-[40px] rounded border border-border bg-[var(--panel)]" preserveAspectRatio="none">
            <path d={ddAreaPath} fill={ddFill} />
            <polyline
              points={ddPoints.map(p => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={lossStroke} strokeWidth="1" opacity={0.7}
            />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
      <p className="text-label uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
      {sub && <p className="text-label text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

// ─── Comparison Table ───────────────────────────────────────

function ComparisonTable({ a, b }: { a: BacktestResult; b: BacktestResult }) {
  // Win-rate denominator is (wins + losses) — scratches excluded from both.
  const winRateA = (a.wins + a.losses) > 0 ? ((a.wins / (a.wins + a.losses)) * 100).toFixed(0) : "0";
  const winRateB = (b.wins + b.losses) > 0 ? ((b.wins / (b.wins + b.losses)) * 100).toFixed(0) : "0";
  const rows: { label: string; valA: string; valB: string; highlight: "higher" | "lower" | "none" }[] = [
    { label: "Total Return", valA: `${(a.totalReturnPct ?? 0) >= 0 ? "+" : ""}${(a.totalReturnPct ?? 0).toFixed(1)}%`, valB: `${(b.totalReturnPct ?? 0) >= 0 ? "+" : ""}${(b.totalReturnPct ?? 0).toFixed(1)}%`, highlight: "higher" },
    { label: "Sharpe Ratio", valA: (a.sharpe ?? 0).toFixed(2), valB: (b.sharpe ?? 0).toFixed(2), highlight: "higher" },
    { label: "Max Drawdown", valA: `-${(a.maxDrawdown ?? 0).toFixed(1)}%`, valB: `-${(b.maxDrawdown ?? 0).toFixed(1)}%`, highlight: "lower" },
    { label: "Win Rate", valA: `${winRateA}%`, valB: `${winRateB}%`, highlight: "higher" },
    { label: "Profit Factor", valA: a.profitFactor === Infinity ? "Inf" : (a.profitFactor ?? 0).toFixed(2), valB: b.profitFactor === Infinity ? "Inf" : (b.profitFactor ?? 0).toFixed(2), highlight: "higher" },
    { label: "Calmar Ratio", valA: (a.calmarRatio ?? 0).toFixed(2), valB: (b.calmarRatio ?? 0).toFixed(2), highlight: "higher" },
    { label: "Trades", valA: String(a.trades), valB: String(b.trades), highlight: "none" },
    { label: "Avg Duration", valA: `${(a.avgTradeDuration ?? 0).toFixed(0)} bars`, valB: `${(b.avgTradeDuration ?? 0).toFixed(0)} bars`, highlight: "none" },
    { label: "Exposure", valA: `${(a.exposureTimePct ?? 0).toFixed(0)}%`, valB: `${(b.exposureTimePct ?? 0).toFixed(0)}%`, highlight: "none" },
  ];

  function getBetter(valA: string, valB: string, highlight: "higher" | "lower" | "none"): "a" | "b" | "none" {
    if (highlight === "none") return "none";
    const nA = parseFloat(valA.replace(/[^0-9.\-]/g, "")) || 0;
    const nB = parseFloat(valB.replace(/[^0-9.\-]/g, "")) || 0;
    if (nA === nB) return "none";
    if (highlight === "higher") return nA > nB ? "a" : "b";
    return nA < nB ? "a" : "b";
  }

  return (
    <div className="rounded-lg border border-border bg-[var(--panel)] overflow-hidden">
      <div className="grid grid-cols-3 gap-0 text-label uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
        <div className="px-3 py-2">Metric</div>
        <div className="px-3 py-2 text-center" style={{ color: "var(--profit)" }}>{a.label ?? "A"}</div>
        <div className="px-3 py-2 text-center" style={{ color: "var(--amber-500)" }}>{b.label ?? "B"}</div>
      </div>
      {rows.map(({ label, valA, valB, highlight }) => {
        const better = getBetter(valA, valB, highlight);
        return (
          <div key={label} className="grid grid-cols-3 gap-0 border-b border-border/50 last:border-0">
            <div className="px-3 py-1.5 text-xs text-muted-foreground">{label}</div>
            <div className={cn("px-3 py-1.5 text-xs font-medium tabular-nums text-center", better === "a" ? "text-[var(--profit)]" : "text-foreground")}>{valA}</div>
            <div className={cn("px-3 py-1.5 text-xs font-medium tabular-nums text-center", better === "b" ? "text-[var(--profit)]" : "text-foreground")}>{valB}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function BacktestPanel() {
  const [symbol, setSymbol] = useState("SPY");
  const [strategy, setStrategy] = useState<"sma-cross" | "rsi" | "macd">("sma-cross");
  const [fastPeriod, setFastPeriod] = useState(10);
  const [slowPeriod, setSlowPeriod] = useState(50);
  const [capital, setCapital] = useState(100000);
  const [commission, setCommission] = useState(0);
  const [slippagePct, setSlippagePct] = useState(0.01);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [resultA, setResultA] = useState<BacktestResult | null>(null);
  const [resultB, setResultB] = useState<BacktestResult | null>(null);
  const [compareStep, setCompareStep] = useState<"idle" | "a-done">("idle");

  const buildLabel = () => {
    if (strategy === "sma-cross") return `SMA ${fastPeriod}/${slowPeriod}`;
    if (strategy === "rsi") return `RSI 14`;
    return "MACD 12/26";
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      const bars = await getBars(symbol, "D", 500);

      let res: BacktestResult;
      if (strategy === "sma-cross") {
        res = runSmaBacktest(bars, fastPeriod, slowPeriod, capital, commission, slippagePct);
      } else if (strategy === "rsi") {
        res = runRsiBacktest(bars, 14, 30, 70, capital, commission, slippagePct);
      } else {
        res = runMacdBacktest(bars, capital, commission, slippagePct);
      }

      // Fetch SPY benchmark if symbol is not already SPY
      try {
        const spyBars = symbol.toUpperCase() === "SPY" ? bars : await getBars("SPY", "D", 500);
        // Align benchmark to same length as equity curve
        const benchStart = Math.max(0, spyBars.length - res.equityCurve.length);
        res.benchmarkCurve = computeBenchmarkCurve(spyBars, capital, benchStart);
        // Trim to same length
        if (res.benchmarkCurve.length > res.equityCurve.length) {
          res.benchmarkCurve = res.benchmarkCurve.slice(0, res.equityCurve.length);
        } else if (res.benchmarkCurve.length < res.equityCurve.length) {
          const pad = Array(res.equityCurve.length - res.benchmarkCurve.length).fill(res.benchmarkCurve[0] ?? capital);
          res.benchmarkCurve = [...pad, ...res.benchmarkCurve];
        }
      } catch {
        res.benchmarkCurve = [];
      }

      res.label = buildLabel();

      if (compareMode) {
        if (compareStep === "idle") {
          setResultA(res);
          setResultB(null);
          setCompareStep("a-done");
          setResult(res);
        } else {
          setResultB(res);
          setCompareStep("idle");
          setResult(resultA); // keep A as primary
        }
      } else {
        setResult(res);
        setResultA(null);
        setResultB(null);
      }
    } catch {
      if (!compareMode) setResult(null);
    }
    setRunning(false);
  };

  const resetCompare = () => {
    setResultA(null);
    setResultB(null);
    setCompareStep("idle");
  };

  const activeResult = compareMode && resultA ? resultA : result;

  return (
    <div className="space-y-4">
      {/* Compare mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setCompareMode(!compareMode); resetCompare(); }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-label font-medium transition-colors border",
              compareMode
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-[var(--panel)] text-muted-foreground border-border hover:text-foreground"
            )}
          >
            <GitCompareArrows className="h-3 w-3" />
            Compare Mode
          </button>
          {compareMode && compareStep === "a-done" && (
            <span className="text-label text-primary animate-pulse">Strategy A saved. Configure B and run again.</span>
          )}
        </div>
        {compareMode && (resultA || resultB) && (
          <button onClick={resetCompare} className="flex items-center gap-1 text-label text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        )}
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor="backtest-symbol" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Symbol</label>
          <input id="backtest-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs text-foreground" />
        </div>
        <div>
          <label htmlFor="backtest-strategy" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Strategy</label>
          <select id="backtest-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as any)} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs text-foreground">
            <option value="sma-cross">SMA Crossover</option>
            <option value="rsi">RSI Mean Reversion</option>
            <option value="macd">MACD Signal</option>
          </select>
        </div>
        {strategy === "sma-cross" && (
          <>
            <div>
              <label htmlFor="backtest-fast-sma" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Fast SMA</label>
              <input id="backtest-fast-sma" type="number" value={fastPeriod} onChange={(e) => setFastPeriod(Math.max(1, Math.floor(safeNum(e.target.value, 10))))} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
            </div>
            <div>
              <label htmlFor="backtest-slow-sma" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Slow SMA</label>
              <input id="backtest-slow-sma" type="number" value={slowPeriod} onChange={(e) => setSlowPeriod(Math.max(1, Math.floor(safeNum(e.target.value, 50))))} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
            </div>
          </>
        )}
        {strategy === "rsi" && (
          <div>
            <label htmlFor="backtest-rsi-period" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">RSI Period</label>
            <input id="backtest-rsi-period" type="number" value={14} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground opacity-50" disabled />
            <p className="text-label text-muted-foreground mt-0.5">Buy RSI&lt;30, Sell RSI&gt;70</p>
          </div>
        )}
        {strategy === "macd" && (
          <div>
            <label className="text-label uppercase tracking-wider text-muted-foreground font-semibold">MACD</label>
            <p className="text-label text-muted-foreground mt-2">12/26 EMA crossover</p>
          </div>
        )}
        <div>
          <label htmlFor="backtest-capital" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Capital ($)</label>
          <input id="backtest-capital" type="number" value={capital} onChange={(e) => setCapital(Math.max(1, Math.floor(safeNum(e.target.value, 100000))))} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
        </div>
        <div>
          <label htmlFor="backtest-commission" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Commission ($)</label>
          <input id="backtest-commission" type="number" value={commission} onChange={(e) => setCommission(safeNum(e.target.value, 0))} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
        </div>
        <div>
          <label htmlFor="backtest-slippage" className="text-label uppercase tracking-wider text-muted-foreground font-semibold">Slippage (%)</label>
          <input id="backtest-slippage" type="number" step="0.01" value={slippagePct} onChange={(e) => setSlippagePct(safeNum(e.target.value, 0))} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
        </div>
      </div>

      <Button onClick={handleRun} disabled={running} size="sm" className="gap-1.5">
        <Play className="h-3 w-3" />
        {running
          ? "Running..."
          : compareMode
            ? compareStep === "idle"
              ? "Run Strategy A"
              : "Run Strategy B"
            : "Run Backtest"
        }
      </Button>

      {/* Results */}
      {activeResult && (
        <div className="space-y-3">
          {/* Primary metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Total Return"
              value={`${activeResult.totalReturn >= 0 ? "+" : ""}${formatCurrency(activeResult.totalReturn)}`}
              sub={`${(activeResult.totalReturnPct ?? 0) >= 0 ? "+" : ""}${(activeResult.totalReturnPct ?? 0).toFixed(1)}%`}
              color={activeResult.totalReturn >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"}
            />
            <MetricCard
              label="Win Rate"
              value={(() => {
                // Scratches (pnl === 0) are excluded from both wins and
                // losses — denominator is decided trades only so a scratch
                // doesn't pull the rate down.
                const decided = activeResult.wins + activeResult.losses;
                return `${decided > 0 ? ((activeResult.wins / decided) * 100).toFixed(0) : 0}%`;
              })()}
              sub={(() => {
                const scratches = Math.max(
                  activeResult.trades - activeResult.wins - activeResult.losses,
                  0,
                );
                const base = `${activeResult.wins}W / ${activeResult.losses}L (${activeResult.trades} trades)`;
                return scratches > 0 ? `${base} — ${scratches} scratch` : base;
              })()}
            />
            <MetricCard
              label="Max Drawdown"
              value={`-${(activeResult.maxDrawdown ?? 0).toFixed(1)}%`}
              color="text-[var(--loss)]"
            />
            <MetricCard
              label="Sharpe Ratio"
              value={(activeResult.sharpe ?? 0).toFixed(2)}
            />
          </div>

          {/* Extended metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard
              label="Profit Factor"
              value={activeResult.profitFactor === Infinity ? "Inf" : (activeResult.profitFactor ?? 0).toFixed(2)}
            />
            <MetricCard
              label="Calmar Ratio"
              value={(activeResult.calmarRatio ?? 0).toFixed(2)}
            />
            <MetricCard
              label="# Trades"
              value={String(activeResult.trades)}
            />
            <MetricCard
              label="Avg Duration"
              value={`${(activeResult.avgTradeDuration ?? 0).toFixed(0)} bars`}
            />
            <MetricCard
              label="Exposure"
              value={`${(activeResult.exposureTimePct ?? 0).toFixed(0)}%`}
              sub="time in market"
            />
          </div>

          {/* Equity Curve */}
          <div>
            <p className="text-label uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Equity Curve</p>
            <EquityCurveSvg result={activeResult} resultB={compareMode ? resultB : null} />
          </div>

          {/* Comparison table */}
          {compareMode && resultA && resultB && (
            <div>
              <p className="text-label uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Side-by-Side Comparison</p>
              <ComparisonTable a={resultA} b={resultB} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
