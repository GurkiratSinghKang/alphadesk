"use client";

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import {
  CandlestickChart,
  LineChart,
  AreaChart,
  ChevronDown,
  BellPlus,
  Minus,
  TrendingDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { useMarketStore } from "@/stores/market";
import { TradingChart, type TradingChartHandle } from "@/components/charts/TradingChart";
import {
  cn,
  formatCurrency,
  formatChangeWithSign,
  formatPercent,
  formatNumber,
  getChangeTextClass,
} from "@/lib/utils";
import { getBars, getPositions, getPipelinePositions, createPriceAlert } from "@/lib/api";
import type { TimeFrame, ChartType, Indicator, OHLCVBar, QuickOrderEvent } from "@/types";

// ─── Timeframes ──────────────────────────────────────────────

const TIMEFRAMES: TimeFrame[] = ["1m", "5m", "15m", "1H", "4H", "D", "W", "M"];

const INDICATORS: Indicator[] = ["EMA", "SMA", "Bollinger", "RSI", "MACD", "Volume"];

// ─── Generate demo data (BUG #10: timeframe-aware) ───────────

function generateDemoOHLCV(symbol: string, timeframe: TimeFrame, count = 200): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = symbol === "SPY" ? 590 : symbol === "AAPL" ? 230 : 150 + Math.random() * 300;
  const now = Math.floor(Date.now() / 1000);

  const intervalMap: Record<TimeFrame, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1H": 3600,
    "4H": 14400,
    D: 86400,
    W: 604800,
    M: 2592000,
  };
  const interval = intervalMap[timeframe];

  // Use symbol+timeframe as seed for deterministic but different data
  let seed = 0;
  for (let c = 0; c < symbol.length; c++) seed += symbol.charCodeAt(c);
  seed += interval;
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = count; i >= 0; i--) {
    const time = now - i * interval;
    const volatility = price * 0.015;
    const open = price + (rng() - 0.5) * volatility;
    const close = open + (rng() - 0.48) * volatility;
    const high = Math.max(open, close) + rng() * volatility * 0.5;
    const low = Math.min(open, close) - rng() * volatility * 0.5;
    const volume = Math.floor(10_000_000 + rng() * 40_000_000);

    bars.push({ time, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

// ─── Component ───────────────────────────────────────────────

export function ChartPanel() {
  const chartHandleRef = useRef<TradingChartHandle>(null);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const quotes = useMarketStore((s) => s.quotes);
  const [timeframe, setTimeframe] = useState<TimeFrame>("D");
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [activeIndicators, setActiveIndicators] = useState<Indicator[]>(["Volume"]);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [positionLines, setPositionLines] = useState<{
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  } | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState(0);
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("above");
  const [drawingMode, setDrawingMode] = useState<"none" | "hline" | "trendline" | "fib">("none");
  const [drawings, setDrawings] = useState<Array<{
    type: "hline" | "trendline" | "fib";
    price?: number;
    startPrice?: number;
    endPrice?: number;
    startTime?: number;
    endTime?: number;
    color?: string;
  }>>([]);

  const quote = quotes[selectedSymbol];

  // BUG #10: chartData depends on timeframe
  const chartData = useMemo(
    () => generateDemoOHLCV(selectedSymbol, timeframe),
    [selectedSymbol, timeframe]
  );

  // Try to fetch real bars from API (best-effort)
  const [apiBars, setApiBars] = useState<OHLCVBar[] | null>(null);

  useEffect(() => {
    setApiBars(null);
    getBars(selectedSymbol, timeframe)
      .then((bars) => {
        if (bars?.length) setApiBars(bars);
      })
      .catch(() => {
        // Fall back to demo data
      });
  }, [selectedSymbol, timeframe]);

  useEffect(() => {
    let cancelled = false;
    async function fetchPositionLevels() {
      try {
        const [positions, pipelineData] = await Promise.allSettled([
          getPositions(),
          getPipelinePositions(),
        ]);
        if (cancelled) return;

        const pos = positions.status === "fulfilled"
          ? positions.value.find((p) => p.symbol === selectedSymbol)
          : null;
        const pipPos = pipelineData.status === "fulfilled" && Array.isArray(pipelineData.value?.positions)
          ? pipelineData.value.positions.find((p) => p.symbol === selectedSymbol)
          : null;

        if (pos) {
          setPositionLines({
            entry: pos.avgCost,
            stopLoss: pipPos?.stopLoss ?? null,
            takeProfit: pipPos?.takeProfit ?? null,
          });
        } else {
          setPositionLines(null);
        }
      } catch {
        setPositionLines(null);
      }
    }
    fetchPositionLevels();
    return () => { cancelled = true; };
  }, [selectedSymbol]);

  const displayData = apiBars ?? chartData;
  const usingDemoData = apiBars === null;

  const displayPrice = crosshairPrice ?? quote?.last ?? displayData[displayData.length - 1]?.close ?? 0;
  const change = quote?.change ?? (displayData.length > 1 ? displayData[displayData.length - 1].close - displayData[displayData.length - 2].close : 0);
  const changePct = quote?.changePct ?? (displayData.length > 1 && displayData[displayData.length - 2].close !== 0 ? (change / displayData[displayData.length - 2].close) * 100 : 0);

  const handleCrosshairMove = useCallback(
    (price: number | null) => setCrosshairPrice(price),
    []
  );

  const toggleIndicator = (ind: Indicator) => {
    setActiveIndicators((prev) =>
      prev.includes(ind) ? prev.filter((i) => i !== ind) : [...prev, ind]
    );
  };

  const addHLine = (price: number) => {
    setDrawings((prev) => [...prev, { type: "hline", price, color: "#3b82f6" }]);
  };

  const drawingPriceLines = drawings
    .filter((d) => d.type === "hline" && d.price != null)
    .map((d) => ({ price: d.price as number, color: d.color ?? "#3b82f6" }));

  // Real-time chart update: when quote updates via WebSocket, push new bar to chart.
  // chartHandleRef.current may be null on the first quote if the chart hasn't mounted yet;
  // this is expected and we simply skip the update — the chart will render the data on mount.
  const prevQuoteRef = useRef<{ last: number; volume: number } | null>(null);
  useEffect(() => {
    if (!quote) return;
    const prev = prevQuoteRef.current;
    if (prev && quote.last !== prev.last && chartHandleRef.current) {
      const now = Math.floor(Date.now() / 1000);
      chartHandleRef.current.updateBar({
        time: now,
        open: quote.open || quote.last,
        high: Math.max(quote.high || quote.last, quote.last),
        low: Math.min(quote.low || quote.last, quote.last),
        close: quote.last,
        volume: quote.volume || 0,
      });
    }
    prevQuoteRef.current = { last: quote.last, volume: quote.volume };
  }, [quote]);

  // BUG #25: Listen for timeframe change events dispatched by keyboard shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ timeframe: TimeFrame }>).detail;
      if (detail?.timeframe) {
        setTimeframe(detail.timeframe);
      }
    };
    window.addEventListener("timeframeChange", handler);
    return () => window.removeEventListener("timeframeChange", handler);
  }, []);

  const ChartTypeIcon =
    chartType === "candle"
      ? CandlestickChart
      : chartType === "line"
      ? LineChart
      : AreaChart;

  return (
    <div data-slot="chart-panel" className="flex h-full flex-col bg-[var(--surface)] overflow-hidden">
      {/* Header: symbol info + controls — z-10 to stay above chart canvas */}
      <div className="flex items-center justify-between border-b border-[#2a2a3e] px-3 py-1.5 shrink-0 bg-[var(--surface)] relative z-10">
        {/* Symbol & Price */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-foreground">
                {selectedSymbol}
              </span>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {formatCurrency(displayPrice)}
              </span>
              <span className={`text-xs tabular-nums ${getChangeTextClass(change)}`}>
                {formatChangeWithSign(change)} ({formatPercent(changePct)})
              </span>
              <button
                aria-label="Set price alert"
                onClick={() => { setAlertPrice(quote?.last ?? 0); setAlertOpen(!alertOpen); }}
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Set price alert"
              >
                <BellPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* L1 Data Bar */}
            {quote && (
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground mt-0.5">
                <span>
                  <span className="text-[var(--profit)]">{quote.bid.toFixed(2)}</span>
                  {" / "}
                  <span className="text-[var(--loss)]">{quote.ask.toFixed(2)}</span>
                  <span className="ml-1.5 text-[#8a8a95]">spread: {(quote.ask - quote.bid).toFixed(2)}</span>
                </span>
                <span className="text-border">|</span>
                <span>Vol: {formatNumber(quote.volume, true)}</span>
                <span className="text-border">|</span>
                <span>H: {quote.high.toFixed(2)}</span>
                <span>L: {quote.low.toFixed(2)}</span>
              </div>
            )}
            {alertOpen && (
              <div className="flex items-center gap-2 mt-1 p-2 rounded border border-border bg-[var(--surface)]">
                <select value={alertCondition} onChange={(e) => setAlertCondition(e.target.value as "above" | "below")} className="h-6 rounded border border-border bg-background px-1 text-[11px] text-foreground">
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
                <input type="number" value={alertPrice} onChange={(e) => setAlertPrice(parseFloat(e.target.value) || 0)} step={0.01} className="h-6 w-24 rounded border border-border bg-background px-2 text-[11px] tabular-nums text-foreground" />
                <button
                  onClick={async () => {
                    try {
                      await createPriceAlert(selectedSymbol, alertPrice, alertCondition);
                      setAlertOpen(false);
                    } catch (err) {
                      console.error("Failed to create price alert:", err);
                    }
                  }}
                  className="h-6 px-2 rounded bg-primary text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Set Alert
                </button>
                <button aria-label="Close alert form" onClick={() => setAlertOpen(false)} className="h-6 w-6 rounded text-muted-foreground hover:text-foreground">✕</button>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <HelpCircle text="Interactive price chart. Change timeframes with 1-8 keys. Use the dropdown to switch chart types and add indicators." />
          {/* Chart type */}
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Chart type selector" className="inline-flex items-center justify-center rounded-md h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <ChartTypeIcon className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[var(--panel)] border-border">
              <DropdownMenuItem onClick={() => setChartType("candle")}>
                <CandlestickChart className="mr-2 h-3.5 w-3.5" /> Candlestick
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChartType("line")}>
                <LineChart className="mr-2 h-3.5 w-3.5" /> Line
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChartType("area")}>
                <AreaChart className="mr-2 h-3.5 w-3.5" /> Area
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Indicators */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              Indicators
              {activeIndicators.length > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] text-primary">
                  {activeIndicators.length}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[var(--panel)] border-border">
              {INDICATORS.map((ind) => (
                <DropdownMenuItem
                  key={ind}
                  onClick={() => toggleIndicator(ind)}
                  className={activeIndicators.includes(ind) ? "text-primary" : ""}
                >
                  <span className={`mr-2 h-2 w-2 rounded-full ${activeIndicators.includes(ind) ? "bg-primary" : "bg-transparent"}`} />
                  {ind}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Timeframe bar */}
      <div className="flex items-center gap-0.5 border-b border-[#2a2a3e] px-3 py-1 shrink-0 bg-[#0e0e16] relative z-10">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tf === timeframe
                ? "bg-primary/30 text-primary font-bold border border-primary/40"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
            }`}
          >
            {tf}
          </button>
        ))}
        <div className="mx-1.5 h-4 w-px bg-[#2a2a3e]" />
        <div className="flex items-center gap-0.5">
          {([
            { type: "candle" as const, label: "🕯", ariaLabel: "Candlestick chart" },
            { type: "line" as const, label: "📈", ariaLabel: "Line chart" },
            { type: "area" as const, label: "▨", ariaLabel: "Area chart" },
          ]).map(({ type, label, ariaLabel }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              aria-label={ariaLabel}
              className={cn(
                "h-6 w-7 rounded text-[11px] transition-colors",
                chartType === type
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              title={type.charAt(0).toUpperCase() + type.slice(1)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 ml-2 border-l border-border pl-2">
          <button
            aria-label="Draw horizontal line"
            onClick={() => setDrawingMode(drawingMode === "hline" ? "none" : "hline")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "hline" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Horizontal Line"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            aria-label="Draw trendline"
            onClick={() => setDrawingMode(drawingMode === "trendline" ? "none" : "trendline")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "trendline" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Trendline"
          >
            <TrendingDown className="h-3 w-3" />
          </button>
          <button
            aria-label="Draw fibonacci retracement"
            onClick={() => setDrawingMode(drawingMode === "fib" ? "none" : "fib")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "fib" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Fibonacci"
          >
            Fib
          </button>
          {drawings.length > 0 && (
            <button
              aria-label="Clear all drawings"
              onClick={() => setDrawings([])}
              className="h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-[var(--loss)]"
              title="Clear all drawings"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Chart — BUG #11: pass chartType, BUG #12: pass indicators */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0">
        <TradingChart
          ref={chartHandleRef}
          data={displayData}
          chartType={chartType}
          indicators={activeIndicators}
          onCrosshairMove={handleCrosshairMove}
          positionLines={positionLines}
          drawingPriceLines={drawingPriceLines}
        />
        </div>

        {/* Demo data watermark */}
        {usingDemoData && (
          <div className="absolute top-2 left-2 z-[6] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20">
            <span className="text-[10px] font-medium text-amber-300/70">Demo data</span>
          </div>
        )}

        {/* Drawing overlay — captures clicks when a drawing mode is active */}
        {drawingMode === "hline" && (
          <div
            className="absolute inset-0 cursor-crosshair z-[5]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pctY = (e.clientY - rect.top) / rect.height;
              if (quote) {
                const high = quote.high || quote.last * 1.05;
                const low = quote.low || quote.last * 0.95;
                const price = high - pctY * (high - low);
                addHLine(Math.round(price * 100) / 100);
              } else if (displayData.length) {
                const highs = displayData.map((b) => b.high);
                const lows = displayData.map((b) => b.low);
                const high = Math.max(...highs);
                const low = Math.min(...lows);
                const price = high - pctY * (high - low);
                addHLine(Math.round(price * 100) / 100);
              }
              setDrawingMode("none");
            }}
          />
        )}

        {/* Quick trade buttons — fixed top-right, translucent until hovered */}
        {quote && (
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1.5 opacity-30 hover:opacity-100 transition-opacity">
            <button
              aria-label="Quick buy"
              onClick={() => {
                const detail: QuickOrderEvent = { symbol: selectedSymbol, side: "buy", price: quote.last };
                window.dispatchEvent(
                  new CustomEvent<QuickOrderEvent>("alphadesk:quick-order", { detail })
                );
              }}
              className="rounded-md bg-[var(--profit)] px-2.5 py-1.5 text-[10px] font-bold text-black shadow-lg hover:bg-[var(--profit)]/90 backdrop-blur-sm"
            >
              BUY
            </button>
            <button
              aria-label="Quick sell"
              onClick={() => {
                const detail: QuickOrderEvent = { symbol: selectedSymbol, side: "sell", price: quote.last };
                window.dispatchEvent(
                  new CustomEvent<QuickOrderEvent>("alphadesk:quick-order", { detail })
                );
              }}
              className="rounded-md bg-[var(--loss)] px-2.5 py-1.5 text-[10px] font-bold text-black shadow-lg hover:bg-[var(--loss)]/90 backdrop-blur-sm"
            >
              SELL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
