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
  Share2,
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
import { getBars, getPositions, getPipelinePositions, createPriceAlert, getPriceAlerts, deletePriceAlert, type PriceAlert } from "@/lib/api";
import { LayoutSelector, type ChartLayout } from "@/components/panels/LayoutSelector";
import { ShareTradeButton } from "@/components/panels/ShareTrade";
import type { TimeFrame, ChartType, Indicator, OHLCVBar, QuickOrderEvent } from "@/types";

// ─── Timeframes ──────────────────────────────────────────────

const TIMEFRAMES: TimeFrame[] = ["1m", "5m", "15m", "1H", "4H", "D", "W", "M"];

const INDICATORS: Indicator[] = ["EMA", "SMA", "Bollinger", "RSI", "MACD", "Volume", "VWAP", "Stochastic", "ATR"];

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

interface ChartPanelProps {
  /** Override symbol — when set, the chart uses this symbol instead of the global store selection */
  symbol?: string;
  /** Callback when symbol changes via the internal selector (used in multi-chart mode) */
  onSymbolChange?: (symbol: string) => void;
}

export function ChartPanel({ symbol: symbolProp, onSymbolChange }: ChartPanelProps = {}) {
  const chartHandleRef = useRef<TradingChartHandle>(null);
  const globalSymbol = useMarketStore((s) => s.selectedSymbol);
  const selectedSymbol = symbolProp ?? globalSymbol;
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
  const [symbolAlerts, setSymbolAlerts] = useState<PriceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [chartLayout, setChartLayoutLocal] = useState<ChartLayout>(() => {
    if (typeof window === "undefined") return "1x1";
    const stored = localStorage.getItem("alphadesk-chart-layout");
    if (stored && ["1x1", "2x1", "1x2", "2x2"].includes(stored)) return stored as ChartLayout;
    return "1x1";
  });

  const handleLayoutChange = useCallback((layout: ChartLayout) => {
    setChartLayoutLocal(layout);
    localStorage.setItem("alphadesk-chart-layout", layout);
    window.dispatchEvent(new CustomEvent("alphadesk:chart-layout", { detail: { layout } }));
  }, []);

  // Listen for layout changes from the trade page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ layout: ChartLayout }>).detail;
      if (detail?.layout) setChartLayoutLocal(detail.layout);
    };
    window.addEventListener("alphadesk:chart-layout", handler);
    return () => window.removeEventListener("alphadesk:chart-layout", handler);
  }, []);

  // ─── Quick Order Dialog (keyboard-driven) ────────────────
  const [quickOrder, setQuickOrder] = useState<{ side: "buy" | "sell"; price: number } | null>(null);
  const [quickOrderQty, setQuickOrderQty] = useState(1);
  const quickOrderInputRef = useRef<HTMLInputElement>(null);

  const [drawingMode, setDrawingMode] = useState<"none" | "hline" | "trendline" | "fib">("none");
  const [drawings, setDrawings] = useState<Array<{
    type: "hline" | "trendline" | "fib";
    price?: number;
    startPrice?: number;
    endPrice?: number;
    startTime?: number;
    endTime?: number;
    color?: string;
    label?: string;
  }>>([]);

  // Trendline drawing: two-click state
  const [trendlineStart, setTrendlineStart] = useState<{ x: number; y: number; price: number; time: number } | null>(null);

  // Trendline SVG lines stored separately (pixel coords + prices for labels)
  const [trendlines, setTrendlines] = useState<Array<{
    startX: number; startY: number; endX: number; endY: number;
    startPrice: number; endPrice: number;
  }>>([]);

  const quote = quotes[selectedSymbol];

  // Quick order keyboard shortcut listener (must be after `quote` definition)
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "chart:quick-buy" && quote) {
        setQuickOrder({ side: "buy", price: quote.last });
        setQuickOrderQty(1);
        setTimeout(() => quickOrderInputRef.current?.focus(), 50);
      } else if (action === "chart:quick-sell" && quote) {
        setQuickOrder({ side: "sell", price: quote.last });
        setQuickOrderQty(1);
        setTimeout(() => quickOrderInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("alphadesk:shortcut", handler);
    return () => window.removeEventListener("alphadesk:shortcut", handler);
  }, [quote]);

  const submitQuickOrder = useCallback(() => {
    if (!quickOrder) return;
    const detail: QuickOrderEvent = { symbol: selectedSymbol, side: quickOrder.side, price: quickOrder.price };
    window.dispatchEvent(new CustomEvent<QuickOrderEvent>("alphadesk:quick-order", { detail }));
    setQuickOrder(null);
  }, [quickOrder, selectedSymbol]);

  // BUG #10: chartData depends on timeframe
  const chartData = useMemo(
    () => generateDemoOHLCV(selectedSymbol, timeframe),
    [selectedSymbol, timeframe]
  );

  // Try to fetch real bars from API (best-effort)
  const [apiBars, setApiBars] = useState<OHLCVBar[] | null>(null);
  const [barsLoading, setBarsLoading] = useState(false);

  useEffect(() => {
    setApiBars(null);
    setBarsLoading(true);
    getBars(selectedSymbol, timeframe)
      .then((bars) => {
        if (bars?.length) setApiBars(bars);
      })
      .catch(() => {
        // Fall back to demo data
      })
      .finally(() => {
        setBarsLoading(false);
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
  const usingDemoData = !barsLoading && apiBars === null;

  // Only use real quote data for header price — never fall back to demo chart data
  const lastRealBar = apiBars && apiBars.length > 0 ? apiBars[apiBars.length - 1] : null;
  const displayPrice = crosshairPrice ?? quote?.last ?? lastRealBar?.close ?? 0;
  const change = quote?.change ?? 0;
  const changePct = quote?.changePct ?? 0;

  const handleCrosshairMove = useCallback(
    (price: number | null) => setCrosshairPrice(price),
    []
  );

  const toggleIndicator = (ind: Indicator) => {
    setActiveIndicators((prev) =>
      prev.includes(ind) ? prev.filter((i) => i !== ind) : [...prev, ind]
    );
  };

  const addHLine = (price: number, color = "#3b82f6", label?: string) => {
    setDrawings((prev) => [...prev, { type: "hline", price, color, label }]);
  };

  const addFibLines = (high: number, low: number) => {
    const range = high - low;
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
    const labels = ["0%", "23.6%", "38.2%", "50%", "61.8%", "78.6%", "100%"];
    const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ef4444"];
    levels.forEach((level, i) => {
      const price = high - range * level;
      const rounded = Math.round(price * 100) / 100;
      addHLine(rounded, colors[i], `Fib ${labels[i]} $${rounded.toFixed(2)}`);
    });
  };

  // Toggle drawing mode, resetting partial trendline/fib state when switching modes
  const toggleDrawingMode = (mode: "hline" | "trendline" | "fib") => {
    setTrendlineStart(null);
    setDrawingMode((prev) => (prev === mode ? "none" : mode));
  };

  const drawingPriceLines = drawings
    .filter((d) => d.type === "hline" && d.price != null)
    .map((d) => ({ price: d.price as number, color: d.color ?? "#3b82f6", label: d.label }));

  // Real-time chart update: when quote updates via WebSocket, push new bar to chart.
  // chartHandleRef.current may be null on the first quote if the chart hasn't mounted yet;
  // this is expected and we simply skip the update — the chart will render the data on mount.
  const prevQuoteRef = useRef<{ last: number; volume: number } | null>(null);
  useEffect(() => {
    if (!quote) return;
    const prev = prevQuoteRef.current;
    if (prev && quote.last !== prev.last && chartHandleRef.current) {
      // Update the LAST bar's close price instead of creating a new bar at current timestamp.
      // Creating bars at Date.now() would place them far right of historical data, causing chart jumps.
      chartHandleRef.current.updateLastClose(quote.last);
    }
    prevQuoteRef.current = { last: quote.last, volume: quote.volume };
  }, [quote]);

  // Fetch alerts for current symbol when popover opens
  const refreshAlerts = useCallback(() => {
    setAlertsLoading(true);
    getPriceAlerts(selectedSymbol)
      .then(setSymbolAlerts)
      .catch(() => setSymbolAlerts([]))
      .finally(() => setAlertsLoading(false));
  }, [selectedSymbol]);

  useEffect(() => {
    if (alertOpen) refreshAlerts();
  }, [alertOpen, refreshAlerts]);

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

  // Escape key: cancel drawing mode or dismiss quick order
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (quickOrder) { setQuickOrder(null); return; }
        if (drawingMode !== "none") {
          setDrawingMode("none");
          setTrendlineStart(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [quickOrder, drawingMode]);

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
              <ShareTradeButton symbol={selectedSymbol} />
            </div>
            {/* L1 Data Bar */}
            {quote && (
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground mt-0.5">
                <span>
                  {quote.bid && quote.ask ? (
                    <>
                      <span className="text-foreground">{quote.bid.toFixed(2)}</span>
                      {" / "}
                      <span className="text-foreground">{quote.ask.toFixed(2)}</span>
                      <span className="ml-1.5 text-[#8a8a95]">spread: {(quote.ask - quote.bid).toFixed(2)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Mkt Closed</span>
                  )}
                </span>
                <span className="text-border">|</span>
                <span>Vol: {formatNumber(quote.volume ?? 0, true)}</span>
                <span className="text-border">|</span>
                <span>H: {(quote.high ?? 0).toFixed(2)}</span>
                <span>L: {(quote.low ?? 0).toFixed(2)}</span>
              </div>
            )}
            {alertOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-80 rounded-lg border border-border bg-[var(--surface)] shadow-xl shadow-black/30">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-medium text-foreground">Price Alerts - {selectedSymbol}</span>
                  <button aria-label="Close alert panel" onClick={() => setAlertOpen(false)} className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 text-xs">&#10005;</button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {alertsLoading ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading...</div>
                  ) : symbolAlerts.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">No alerts for {selectedSymbol}</div>
                  ) : (
                    <div className="py-1">
                      {symbolAlerts.map((a) => (
                        <div key={a.id} className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", a.triggered && "opacity-60")}>
                          <span className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", a.triggered ? "bg-[var(--profit)]" : a.condition === "above" ? "bg-primary" : "bg-amber-500")} />
                          <span className="flex-1 min-w-0 tabular-nums text-foreground">
                            {a.condition === "above" ? "Above" : "Below"} ${a.price.toFixed(2)}
                            {a.triggered && a.triggered_at && (
                              <span className="ml-1.5 text-[10px] text-[var(--profit)]">
                                Triggered {new Date(a.triggered_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </span>
                          <button
                            aria-label="Delete alert"
                            onClick={async () => { try { await deletePriceAlert(a.id); refreshAlerts(); } catch { /* */ } }}
                            className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-[var(--loss)] hover:bg-accent/50 text-[10px] shrink-0"
                          >&#10005;</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <select value={alertCondition} onChange={(e) => setAlertCondition(e.target.value as "above" | "below")} aria-label="Alert condition" className="h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground">
                      <option value="above">Above</option>
                      <option value="below">Below</option>
                    </select>
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground" aria-hidden="true">$</span>
                      <input type="number" value={alertPrice} onChange={(e) => setAlertPrice(parseFloat(e.target.value) || 0)} step={0.01} aria-label="Alert price" className="h-7 w-full rounded border border-border bg-background pl-5 pr-2 text-[11px] tabular-nums text-foreground" />
                    </div>
                    <button
                      onClick={async () => {
                        if (alertPrice <= 0) return;
                        try { await createPriceAlert(selectedSymbol, alertPrice, alertCondition); refreshAlerts(); } catch { /* */ }
                      }}
                      className="h-7 px-3 rounded bg-primary text-[10px] font-medium text-primary-foreground hover:bg-primary/90 whitespace-nowrap"
                    >Add Alert</button>
                  </div>
                </div>
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

          {/* Chart layout selector */}
          <div className="ml-0.5 border-l border-border pl-1">
            <LayoutSelector layout={chartLayout} onLayoutChange={handleLayoutChange} />
          </div>
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
            onClick={() => toggleDrawingMode("hline")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "hline" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Horizontal Line"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            aria-label="Draw trendline"
            onClick={() => toggleDrawingMode("trendline")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "trendline" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Trendline"
          >
            <TrendingDown className="h-3 w-3" />
          </button>
          <button
            aria-label="Draw fibonacci retracement"
            onClick={() => toggleDrawingMode("fib")}
            className={cn("h-6 px-1.5 rounded text-[10px] transition-colors", drawingMode === "fib" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Fibonacci"
          >
            Fib
          </button>
          {(drawings.length > 0 || trendlines.length > 0) && (
            <button
              aria-label="Clear all drawings"
              onClick={() => { setDrawings([]); setTrendlines([]); setTrendlineStart(null); }}
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

        {/* Demo data overlay — shown when API bars fail to load */}
        {usingDemoData && !barsLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[4]">
            <span className="text-sm text-muted-foreground bg-[var(--surface)]/80 px-3 py-1.5 rounded-md border border-border">
              Historical data unavailable
            </span>
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

        {/* Trendline overlay — two clicks to draw a line */}
        {drawingMode === "trendline" && (
          <div
            className="absolute inset-0 cursor-crosshair z-[5]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const pctY = y / rect.height;

              // Compute price from Y position
              let price = 0;
              if (quote) {
                const high = quote.high || quote.last * 1.05;
                const low = quote.low || quote.last * 0.95;
                price = high - pctY * (high - low);
              } else if (displayData.length) {
                const high = Math.max(...displayData.map((b) => b.high));
                const low = Math.min(...displayData.map((b) => b.low));
                price = high - pctY * (high - low);
              }
              price = Math.round(price * 100) / 100;

              if (!trendlineStart) {
                // First click — record start point
                setTrendlineStart({ x, y, price, time: Date.now() });
              } else {
                // Second click — create the trendline
                setTrendlines((prev) => [...prev, {
                  startX: trendlineStart.x,
                  startY: trendlineStart.y,
                  endX: x,
                  endY: y,
                  startPrice: trendlineStart.price,
                  endPrice: price,
                }]);
                setTrendlineStart(null);
                setDrawingMode("none");
              }
            }}
          />
        )}

        {/* Fibonacci overlay — two clicks to set high and low */}
        {drawingMode === "fib" && (
          <div
            className="absolute inset-0 cursor-crosshair z-[5]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pctY = (e.clientY - rect.top) / rect.height;

              let price = 0;
              if (quote) {
                const high = quote.high || quote.last * 1.05;
                const low = quote.low || quote.last * 0.95;
                price = high - pctY * (high - low);
              } else if (displayData.length) {
                const high = Math.max(...displayData.map((b) => b.high));
                const low = Math.min(...displayData.map((b) => b.low));
                price = high - pctY * (high - low);
              }
              price = Math.round(price * 100) / 100;

              if (!trendlineStart) {
                // First click — high point
                setTrendlineStart({ x: 0, y: 0, price, time: Date.now() });
              } else {
                // Second click — low point, draw fib levels
                const high = Math.max(trendlineStart.price, price);
                const low = Math.min(trendlineStart.price, price);
                addFibLines(high, low);
                setTrendlineStart(null);
                setDrawingMode("none");
              }
            }}
          />
        )}

        {/* SVG overlay for trendlines */}
        {trendlines.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-[3]">
            {trendlines.map((line, i) => (
              <g key={i}>
                <line
                  x1={line.startX}
                  y1={line.startY}
                  x2={line.endX}
                  y2={line.endY}
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                />
                {/* Start dot */}
                <circle cx={line.startX} cy={line.startY} r={3} fill="#f59e0b" />
                {/* End dot */}
                <circle cx={line.endX} cy={line.endY} r={3} fill="#f59e0b" />
                {/* Price label at start */}
                <text
                  x={line.startX + 6}
                  y={line.startY - 6}
                  fill="#f59e0b"
                  fontSize={10}
                  fontFamily="Inter, sans-serif"
                >
                  ${line.startPrice.toFixed(2)}
                </text>
                {/* Price label at end */}
                <text
                  x={line.endX + 6}
                  y={line.endY - 6}
                  fill="#f59e0b"
                  fontSize={10}
                  fontFamily="Inter, sans-serif"
                >
                  ${line.endPrice.toFixed(2)}
                </text>
              </g>
            ))}
          </svg>
        )}

        {/* Trendline in-progress indicator (first click placed, waiting for second) */}
        {trendlineStart && drawingMode === "trendline" && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-[3]">
            <circle cx={trendlineStart.x} cy={trendlineStart.y} r={4} fill="#f59e0b" opacity={0.8} />
            <text
              x={trendlineStart.x + 8}
              y={trendlineStart.y - 8}
              fill="#f59e0b"
              fontSize={10}
              fontFamily="Inter, sans-serif"
            >
              ${trendlineStart.price.toFixed(2)} — click end point
            </text>
          </svg>
        )}

        {/* Fibonacci in-progress indicator */}
        {trendlineStart && drawingMode === "fib" && (
          <div className="absolute top-2 left-2 z-[6] bg-[var(--surface)]/90 border border-border rounded px-2 py-1 text-[10px] text-muted-foreground">
            Fib high: ${trendlineStart.price.toFixed(2)} — click to set low point
          </div>
        )}

        {/* Quick Order Dialog — keyboard-driven floating panel */}
        {quickOrder && (
          <div
            className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 w-56 rounded-lg border border-border bg-[var(--surface)] shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-150"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setQuickOrder(null); }
              if (e.key === "Enter") { e.preventDefault(); submitQuickOrder(); }
            }}
          >
            <div className={cn(
              "flex items-center justify-between rounded-t-lg px-3 py-2 text-xs font-bold",
              quickOrder.side === "buy" ? "bg-[var(--profit)]/15 text-[var(--profit)]" : "bg-[var(--loss)]/15 text-[var(--loss)]"
            )}>
              <span>{quickOrder.side === "buy" ? "QUICK BUY" : "QUICK SELL"}</span>
              <button onClick={() => setQuickOrder(null)} className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground text-[10px]">&#10005;</button>
            </div>
            <div className="px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{selectedSymbol}</span>
                <span className="text-xs tabular-nums text-foreground">{formatCurrency(quickOrder.price)}</span>
              </div>
              <div>
                <label htmlFor="quick-order-qty" className="text-[10px] text-muted-foreground">Qty</label>
                <input
                  id="quick-order-qty"
                  ref={quickOrderInputRef}
                  type="number"
                  min={1}
                  value={quickOrderQty}
                  onChange={(e) => setQuickOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-0.5 h-7 w-full rounded border border-border bg-background px-2 text-xs tabular-nums text-foreground"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>Est. cost</span>
                <span>{formatCurrency(quickOrder.price * quickOrderQty)}</span>
              </div>
              <button
                onClick={submitQuickOrder}
                className={cn(
                  "btn-press w-full rounded-md py-1.5 text-xs font-bold text-black shadow-lg",
                  quickOrder.side === "buy" ? "bg-[var(--profit)] hover:bg-[var(--profit)]/90" : "bg-[var(--loss)] hover:bg-[var(--loss)]/90"
                )}
              >
                {quickOrder.side === "buy" ? "Buy" : "Sell"} Market
              </button>
              <p className="text-center text-[9px] text-muted-foreground">Enter to confirm &middot; Esc to cancel</p>
            </div>
          </div>
        )}

        {/* Quick trade buttons — fixed top-right, translucent until hovered */}
        {quote && (
          <div className="absolute right-16 top-2 z-10 flex flex-col gap-1.5 opacity-30 hover:opacity-100 transition-opacity">
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
