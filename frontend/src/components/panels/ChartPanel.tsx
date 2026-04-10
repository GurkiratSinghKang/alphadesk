"use client";

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import {
  CandlestickChart,
  LineChart,
  AreaChart,
  ChevronDown,
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
  formatCurrency,
  formatChangeWithSign,
  formatPercent,
  getChangeTextClass,
} from "@/lib/utils";
import { getBars } from "@/lib/api";
import type { TimeFrame, ChartType, Indicator, OHLCVBar } from "@/types";

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
  const { selectedSymbol, quotes } = useMarketStore();
  const [timeframe, setTimeframe] = useState<TimeFrame>("D");
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [activeIndicators, setActiveIndicators] = useState<Indicator[]>(["Volume"]);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

  const quote = quotes.get(selectedSymbol);

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

  const displayData = apiBars ?? chartData;

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

  // Real-time chart update: when quote updates via WebSocket, push new bar to chart
  const prevQuoteRef = useRef<{ last: number; volume: number } | null>(null);
  useEffect(() => {
    if (!quote || !chartHandleRef.current) return;
    const prev = prevQuoteRef.current;
    if (prev && quote.last !== prev.last) {
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
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">
              {selectedSymbol}
            </span>
            <span className="text-lg font-bold text-white tabular-nums">
              {formatCurrency(displayPrice)}
            </span>
            <span className={`text-xs tabular-nums ${getChangeTextClass(change)}`}>
              {formatChangeWithSign(change)} ({formatPercent(changePct)})
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <HelpCircle text="Interactive price chart. Change timeframes with 1-8 keys. Use the dropdown to switch chart types and add indicators." />
          {/* Chart type */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
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
        />
        </div>
      </div>
    </div>
  );
}
