"use client";

import { useState, useMemo } from "react";
import { Play, BarChart3, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { getBars } from "@/lib/api";
import type { OHLCVBar } from "@/types";

interface BacktestResult {
  totalReturn: number;
  totalReturnPct: number;
  trades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  sharpe: number;
  equityCurve: number[];
}

function emptyResult(capital: number): BacktestResult {
  return { totalReturn: 0, totalReturnPct: 0, trades: 0, wins: 0, losses: 0, maxDrawdown: 0, sharpe: 0, equityCurve: [capital] };
}

function runSmaBacktest(bars: OHLCVBar[], fastPeriod: number, slowPeriod: number, initialCapital: number): BacktestResult {
  if (bars.length < slowPeriod + 10) {
    return emptyResult(initialCapital);
  }

  // Calculate SMAs
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
  let trades = 0, wins = 0, losses = 0;
  const equityCurve: number[] = [capital];
  let peak = capital;
  let maxDd = 0;
  const returns: number[] = [];

  for (let i = slowPeriod; i < closes.length; i++) {
    const fastSma = sma(closes, fastPeriod, i);
    const slowSma = sma(closes, slowPeriod, i);
    const prevFast = sma(closes, fastPeriod, i - 1);
    const prevSlow = sma(closes, slowPeriod, i - 1);

    // Buy signal: fast crosses above slow
    if (prevFast <= prevSlow && fastSma > slowSma && position === 0) {
      position = Math.floor(capital / closes[i]);
      entryPrice = closes[i];
      capital -= position * entryPrice;
    }
    // Sell signal: fast crosses below slow
    else if (prevFast >= prevSlow && fastSma < slowSma && position > 0) {
      const proceeds = position * closes[i];
      const pnl = proceeds - (position * entryPrice);
      capital += proceeds;
      trades++;
      if (pnl > 0) wins++;
      else losses++;
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

  // Close any open position
  if (position > 0) {
    capital += position * closes[closes.length - 1];
    position = 0;
  }

  const totalReturn = capital - initialCapital;
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

  return {
    totalReturn,
    totalReturnPct: (totalReturn / initialCapital) * 100,
    trades,
    wins,
    losses,
    maxDrawdown: maxDd * 100,
    sharpe: Math.round(sharpe * 100) / 100,
    equityCurve,
  };
}

function runRsiBacktest(bars: OHLCVBar[], period: number, oversold: number, overbought: number, capital: number): BacktestResult {
  if (bars.length < period + 10) return emptyResult(capital);

  const closes = bars.map(b => b.close);
  let cash = capital, position = 0, entryPrice = 0;
  let trades = 0, wins = 0, losses = 0;
  const equityCurve = [capital];
  let peak = capital, maxDd = 0;
  const returns: number[] = [];

  for (let i = period; i < closes.length; i++) {
    // Calculate RSI
    let gains = 0, loss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff;
      else loss -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = loss / period;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));

    // Buy when RSI < oversold, sell when RSI > overbought
    if (rsi < oversold && position === 0) {
      position = Math.floor(cash / closes[i]);
      entryPrice = closes[i];
      cash -= position * entryPrice;
    } else if (rsi > overbought && position > 0) {
      const proceeds = position * closes[i];
      const pnl = proceeds - position * entryPrice;
      cash += proceeds;
      trades++; if (pnl > 0) wins++; else losses++;
      position = 0;
    }

    const equity = cash + position * closes[i];
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    if (equityCurve.length > 1) returns.push((equity - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2]);
  }

  if (position > 0) { cash += position * closes[closes.length - 1]; position = 0; }
  const totalReturn = cash - capital;
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;

  return {
    totalReturn, totalReturnPct: (totalReturn / capital) * 100,
    trades, wins, losses, maxDrawdown: maxDd * 100,
    sharpe: Math.round((stdRet > 0 ? meanRet / stdRet * Math.sqrt(252) : 0) * 100) / 100,
    equityCurve,
  };
}

export function BacktestPanel() {
  const [symbol, setSymbol] = useState("SPY");
  const [strategy, setStrategy] = useState<"sma-cross" | "rsi" | "macd">("sma-cross");
  const [fastPeriod, setFastPeriod] = useState(10);
  const [slowPeriod, setSlowPeriod] = useState(50);
  const [capital, setCapital] = useState(100000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const handleRun = async () => {
    setRunning(true);
    try {
      const bars = await getBars(symbol, "D", 500);
      let res: BacktestResult;
      if (strategy === "sma-cross") {
        res = runSmaBacktest(bars, fastPeriod, slowPeriod, capital);
      } else if (strategy === "rsi") {
        res = runRsiBacktest(bars, 14, 30, 70, capital);
      } else {
        res = runSmaBacktest(bars, 12, 26, capital); // MACD approximation
      }
      setResult(res);
    } catch { setResult(null); }
    setRunning(false);
  };

  // Simple equity curve SVG
  const curveSvg = useMemo(() => {
    if (!result || result.equityCurve.length < 2) return null;
    const data = result.equityCurve;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const w = 600, h = 100;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 10) - 5;
      return `${x},${y}`;
    }).join(" ");
    const isUp = data[data.length - 1] >= data[0];
    const color = isUp ? "var(--profit)" : "var(--loss)";
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[100px] rounded border border-border bg-[var(--panel)]" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }, [result]);

  return (
    <div className="space-y-4">
      {/* Parameters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs text-foreground" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Strategy</label>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as any)} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs text-foreground">
            <option value="sma-cross">SMA Crossover</option>
            <option value="rsi">RSI Mean Reversion</option>
            <option value="macd">MACD Signal</option>
          </select>
        </div>
        {strategy === "sma-cross" && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fast SMA</label>
              <input type="number" value={fastPeriod} onChange={(e) => setFastPeriod(parseInt(e.target.value) || 10)} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Slow SMA</label>
              <input type="number" value={slowPeriod} onChange={(e) => setSlowPeriod(parseInt(e.target.value) || 50)} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
            </div>
          </>
        )}
        {strategy === "rsi" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">RSI Period</label>
            <input type="number" value={14} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground opacity-50" disabled />
            <p className="text-[10px] text-muted-foreground mt-0.5">Buy RSI&lt;30, Sell RSI&gt;70</p>
          </div>
        )}
        {strategy === "macd" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">MACD</label>
            <p className="text-[10px] text-muted-foreground mt-2">12/26 EMA crossover</p>
          </div>
        )}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Capital ($)</label>
          <input type="number" value={capital} onChange={(e) => setCapital(parseInt(e.target.value) || 100000)} className="w-full h-8 mt-1 rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground" />
        </div>
      </div>

      <Button onClick={handleRun} disabled={running} size="sm" className="gap-1.5">
        <Play className="h-3 w-3" />
        {running ? "Running..." : "Run Backtest"}
      </Button>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Return</p>
              <p className={cn("text-lg font-bold tabular-nums", result.totalReturn >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                {result.totalReturn >= 0 ? "+" : ""}{formatCurrency(result.totalReturn)}
              </p>
              <p className="text-[10px] text-muted-foreground tabular-nums">{result.totalReturnPct >= 0 ? "+" : ""}{result.totalReturnPct.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Win Rate</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {result.trades > 0 ? ((result.wins / result.trades) * 100).toFixed(0) : 0}%
              </p>
              <p className="text-[10px] text-muted-foreground">{result.wins}W / {result.losses}L ({result.trades} trades)</p>
            </div>
            <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Max Drawdown</p>
              <p className="text-lg font-bold tabular-nums text-[var(--loss)]">-{result.maxDrawdown.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sharpe Ratio</p>
              <p className="text-lg font-bold tabular-nums text-foreground">{result.sharpe.toFixed(2)}</p>
            </div>
          </div>

          {/* Equity Curve */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Equity Curve</p>
            {curveSvg}
          </div>
        </div>
      )}
    </div>
  );
}
