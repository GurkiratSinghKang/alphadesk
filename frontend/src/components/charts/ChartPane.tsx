"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TradingChart, type PriceCoordinate } from "@/components/charts/TradingChart";
import type { ChartType, Indicator, MarketDepthSnapshot, OHLCVBar } from "@/types";
import type { Drawing, DrawingKind } from "@/components/charts/drawingPlugin";
import { useChartDrawings } from "@/hooks/useChartDrawings";
import { useMarketStore } from "@/stores/market";
import { usePreferencesStore } from "@/stores/preferences";
import { useSparklineBars } from "@/hooks/useSparklineBars";
import { safeGetItem, safeSetItem } from "@/lib/storage";
import VolumeProfile from "@/components/primitives/VolumeProfile";
import { deriveMarketStructure } from "@/lib/marketStructure";

/**
 * ChartPane — dashboard chart surface (2026-04-20 redesign)
 * ─────────────────────────────────────────────────────────
 * Wraps `TradingChart` with the three desktop-trading primitives owner
 * research said every competitor ships and we didn't:
 *
 *   1. Chart-type toggle — candle (default) / line / area. The toggle
 *      lives top-right of the chart, matching ThinkorSwim's "Style"
 *      button pattern. Candle is the default per Webull/ToS/TWS precedent.
 *   2. Indicator menu — small popover with VWAP/EMA/SMA/BB/RSI/MACD
 *      checkboxes. Same priority stack the research report recommended
 *      (VWAP first because it's the one prosumer tool most retail
 *      brokers skip).
 *   3. Drawing-tools rail slot — 44px vertical strip on the LEFT of the
 *      chart canvas where the drawing-primitives toolbar will mount
 *      in a follow-up task. This component renders the strip + tool
 *      buttons; the actual drawing render path lives in the chart
 *      drawing plugin (separate file).
 *
 * Volume histogram: already rendered by `TradingChart` when the OHLCV
 * bars include `volume`. No extra config needed.
 *
 * TV watermark: already hidden in `TradingChart.tsx` via the inline
 * `<style>` rule (`.tv-lightweight-charts .chart-watermark {display:none}`
 * at the bottom of that component). If a watermark ever re-appears after
 * a lightweight-charts upgrade, re-verify that rule.
 */

export interface ChartPaneProps {
  data: OHLCVBar[];
  topOfBook?: TopOfBookQuote | null;
  marketDepth?: MarketDepthSnapshot | null;
  tradeOverlays?: ChartTradeOverlay[];
  chartOrderPlacement?: ChartOrderPlacement | null;
  /** Empty-state + error-state are handled by the parent so ChartPane
   *  stays focused on the live-data path. */
  isLoading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Forwarded to TradingChart — fires when the user pans near the
   *  leftmost loaded bar so the parent can fetch & merge older bars. */
  onLoadMoreHistory?: () => void;
  /** True while a load-more fetch is in flight. Suppresses repeated
   *  triggers from the chart's pan callback. */
  loadingMoreHistory?: boolean;
  className?: string;
}

export interface ChartTradeOverlay {
  id: string;
  label: string;
  status: "live" | "draft" | "pending" | "error";
  side: "long" | "short";
  entry: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  quantity?: number | null;
  summary?: string;
  error?: string | null;
  canSubmit?: boolean;
  submitLabel?: string;
  onSubmit?: () => void;
  onCancel?: () => void;
}

export interface ChartOrderPlacement {
  enabled: boolean;
  side?: "buy" | "sell";
  label?: string;
  hint?: string;
  onStagePrice: (price: number, side: "buy" | "sell") => void;
}

export interface TopOfBookQuote {
  bid?: number | null;
  ask?: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  bidExchange?: string | null;
  askExchange?: string | null;
  timestamp?: number | string | null;
  source?: string | null;
  isL2?: boolean;
  kind?: "top_of_book" | "level_2";
  depthLevels?: number;
}

const TYPES: { id: ChartType; label: string; icon: React.ReactNode }[] = [
  {
    id: "candle",
    label: "Candles",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M4 2v2M4 10v2M10 3v3M10 9v2" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2.75" y="4" width="2.5" height="6" fill="currentColor" />
        <rect x="8.75" y="3" width="2.5" height="8" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 10l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "area",
    label: "Area",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 10l4-4 3 2 5-6v10H1z" fill="currentColor" opacity="0.45" />
        <path d="M1 10l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ALL_INDICATORS: Indicator[] = ["VWAP", "EMA", "SMA", "Bollinger", "RSI", "MACD"];

// Range chips — visual time-window scoper. Filters `data` down to the
// trailing N seconds before passing into TradingChart, anchored to the
// last loaded bar (not Date.now()) so historical data still renders
// sensibly. ``ALL`` passes through unfiltered (default).
type RangeChipId = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "ALL";
const RANGE_CHIPS: { id: RangeChipId; label: string; seconds: number | null }[] = [
  { id: "1D", label: "1D", seconds: 1 * 86400 },
  { id: "5D", label: "5D", seconds: 5 * 86400 },
  { id: "1M", label: "1M", seconds: 30 * 86400 },
  { id: "3M", label: "3M", seconds: 90 * 86400 },
  { id: "6M", label: "6M", seconds: 180 * 86400 },
  { id: "1Y", label: "1Y", seconds: 365 * 86400 },
  { id: "ALL", label: "ALL", seconds: null },
];

// Drawing tools: the toolbar renders a chrome rail; the actual drawing
// capture + render lives in the drawing plugin. We expose the tool state
// as a callback so the parent (or a future drawings-store hook) can wire
// click-to-draw. In this first cut the buttons only flip an "active tool"
// local state — actual primitives land in a follow-up.
type DrawingTool = "cursor" | "trend" | "horizontal" | "rect" | "fib" | "text";

/**
 * Map non-cursor tools to the concrete `DrawingKind` the plugin renders.
 * `text` is excluded — we surface it disabled in the rail until v2 so
 * the user can't enter a dead-end draw mode. `cursor` also has no entry
 * because it's the default pan/zoom state, not a draw target.
 */
const TOOL_TO_KIND: Partial<Record<DrawingTool, DrawingKind>> = {
  trend: "trend",
  horizontal: "horizontal",
  rect: "rect",
  fib: "fib",
};

const DRAWING_TOOLS: { id: DrawingTool; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
  {
    id: "cursor",
    label: "Select",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 2l4 9 1.8-3.6L11 7l-2-2.4L6 2 2 2z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "trend",
    label: "Trend line",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 11L11 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="1.5" cy="11" r="1.3" fill="currentColor" />
        <circle cx="11" cy="1.5" r="1.3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "horizontal",
    label: "Horizontal line",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 6.5H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="6.5" cy="6.5" r="1.3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "rect",
    label: "Rectangle",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <rect x="1.5" y="3" width="10" height="7" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    ),
  },
  {
    id: "fib",
    label: "Fibonacci retracement",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 2h11M1 5h11M1 8h11M1 11h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text (in development)",
    disabled: true,
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 2h9v2h-3.5v8h-2V4H2z" fill="currentColor" />
      </svg>
    ),
  },
];

/**
 * Resolve a design-token color for the drawing currently being placed.
 * Runs lazily (each add) so the plugin renders with whatever tokens are
 * live at the moment of creation; persisted drawings keep their resolved
 * color verbatim so re-renders don't silently shift palette.
 */
function readDrawingColor(): string {
  if (typeof window === "undefined") return "#c9a66b";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--gold-300");
  return (v && v.trim()) || "#e0c070";
}

function formatStructurePrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function formatBookPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function formatBookSize(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface NormalizedTopOfBook {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidExchange?: string | null;
  askExchange?: string | null;
  spread: number;
  spreadBps: number;
  imbalancePct: number | null;
  source: string;
  isL2: boolean;
  kind: "top_of_book" | "level_2";
  depthLevels: number;
}

function depthToTopOfBook(depth: MarketDepthSnapshot | null | undefined): TopOfBookQuote | null {
  const bid = depth?.bids?.[0];
  const ask = depth?.asks?.[0];
  if (!depth || !bid || !ask) return null;
  return {
    bid: bid.price,
    ask: ask.price,
    bidSize: bid.size,
    askSize: ask.size,
    bidExchange: bid.venue,
    askExchange: ask.venue,
    timestamp: depth.timestamp,
    source: depth.provider,
    isL2: depth.isL2,
    kind: depth.kind,
    depthLevels: Math.min(depth.bids.length, depth.asks.length),
  };
}

function normalizeTopOfBook(q: TopOfBookQuote | null | undefined): NormalizedTopOfBook | null {
  const bid = toFiniteNumber(q?.bid);
  const ask = toFiniteNumber(q?.ask);
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || ask < bid) return null;
  const bidSize = Math.max(0, Math.round(toFiniteNumber(q?.bidSize) ?? 0));
  const askSize = Math.max(0, Math.round(toFiniteNumber(q?.askSize) ?? 0));
  const spread = ask - bid;
  const mid = (ask + bid) / 2;
  const totalSize = bidSize + askSize;
  return {
    bid,
    ask,
    bidSize,
    askSize,
    bidExchange: q?.bidExchange,
    askExchange: q?.askExchange,
    spread,
    spreadBps: mid > 0 ? (spread / mid) * 10_000 : 0,
    imbalancePct: totalSize > 0 ? (bidSize / totalSize) * 100 : null,
    source: q?.source ?? "quote",
    isL2: Boolean(q?.isL2),
    kind: q?.kind === "level_2" ? "level_2" : "top_of_book",
    depthLevels: Math.max(1, Math.round(toFiniteNumber(q?.depthLevels) ?? 1)),
  };
}

/**
 * QA r6-2 — small CSS-var resolver. Reads from `:root` so light/dark
 * theme swaps automatically; fallback is the SSR-safe value used before
 * hydration so the chart never renders transparent.
 */
function getCSSVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

/**
 * QA r6-2 — STRUCTURE_COLORS / BOOK_COLORS were raw rgba/hex literals
 * that bypassed the design-token system. They now resolve from CSS vars
 * defined in `styles/design-tokens.css` (`--chart-structure-*`,
 * `--chart-book-*`) so light-mode theme swaps work correctly and the chart
 * palette stays in sync with the rest of the app.
 *
 * Defined as functions (not module-level objects) so they re-resolve on
 * theme change — the consuming `React.useMemo` blocks already track the
 * inputs that change when this matters.
 */
const STRUCTURE_COLOR_DEFAULTS = {
  support: "rgba(168, 208, 77, 0.20)",
  resistance: "rgba(224, 120, 86, 0.20)",
  demand: "rgba(141, 179, 196, 0.18)",
  supply: "rgba(217, 164, 65, 0.18)",
  poc: "rgba(201, 166, 107, 0.30)",
} as const;

const BOOK_COLOR_DEFAULTS = {
  bid: "rgba(168, 208, 77, 0.30)",
  ask: "rgba(224, 120, 86, 0.30)",
} as const;

function getStructureColors() {
  return {
    support: getCSSVar("--chart-structure-support", STRUCTURE_COLOR_DEFAULTS.support),
    resistance: getCSSVar("--chart-structure-resistance", STRUCTURE_COLOR_DEFAULTS.resistance),
    demand: getCSSVar("--chart-structure-demand", STRUCTURE_COLOR_DEFAULTS.demand),
    supply: getCSSVar("--chart-structure-supply", STRUCTURE_COLOR_DEFAULTS.supply),
    poc: getCSSVar("--chart-structure-poc", STRUCTURE_COLOR_DEFAULTS.poc),
  };
}

function getBookColors() {
  return {
    bid: getCSSVar("--chart-book-bid", BOOK_COLOR_DEFAULTS.bid),
    ask: getCSSVar("--chart-book-ask", BOOK_COLOR_DEFAULTS.ask),
  };
}

export default function ChartPane({
  data,
  topOfBook,
  marketDepth,
  tradeOverlays = [],
  chartOrderPlacement = null,
  isLoading,
  error,
  onRetry,
  onLoadMoreHistory,
  loadingMoreHistory,
  className,
}: ChartPaneProps) {
  // Slice-16 / TPL-1 (2026 design brief, TradingView "Save Layout"): the
  // user's chart configuration (chartType + indicators) is persisted to
  // localStorage so it survives a refresh. Lazy-init reads the saved
  // template on first mount; subsequent state changes trigger a write
  // via the effect below.
  const [chartType, setChartType] = React.useState<ChartType>(() => {
    const raw = safeGetItem("alphadesk:chart-template:default");
    if (!raw) return "candle";
    try {
      const parsed = JSON.parse(raw) as { chartType?: ChartType };
      const v = parsed.chartType;
      if (v === "candle" || v === "line" || v === "area") return v;
    } catch {
      /* fall through to default */
    }
    return "candle";
  });
  const chartThemeKey = usePreferencesStore((s) => s.display.theme);
  const [activeTool, setActiveTool] = React.useState<DrawingTool>("cursor");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [indicators, setIndicators] = React.useState<Indicator[]>(() => {
    const raw = safeGetItem("alphadesk:chart-template:default");
    if (!raw) return ["Volume"];
    try {
      const parsed = JSON.parse(raw) as { indicators?: Indicator[] };
      if (Array.isArray(parsed.indicators)) return parsed.indicators;
    } catch {
      /* fall through to default */
    }
    return ["Volume"];
  });

  // Slice-16 / TPL-1: persist template on every chartType / indicators
  // change. Debounced via the React batching that already groups
  // setState calls — no manual debounce needed at this volume.
  React.useEffect(() => {
    safeSetItem(
      "alphadesk:chart-template:default",
      JSON.stringify({ chartType, indicators }),
    );
  }, [chartType, indicators]);

  // Market-structure layer: truthful liquidity context with the data we
  // actually have. There is no L2/depth endpoint in the app today, so this
  // ships as a volume-at-price liquidity proxy plus inferred S/R ranges and
  // high-volume supply/demand blocks from OHLCV bars.
  const [topOfBookOn, setTopOfBookOn] = React.useState(true);
  const [liquidityProfileOn, setLiquidityProfileOn] = React.useState(false);
  const [structureZonesOn, setStructureZonesOn] = React.useState(false);
  const [orderBlocksOn, setOrderBlocksOn] = React.useState(false);

  // Slice-14 / AVWAP-1 (2026 design brief, Quantower / TradingView power-tool):
  // anchored VWAP. ``avwapAnchor`` is the bar index from which the
  // VWAP cumulates; null means no anchored VWAP rendered. ``avwapArmed``
  // is true when the user has clicked the AVWAP toolbar button and the
  // next chart click should drop the anchor.
  const [avwapAnchor, setAvwapAnchor] = React.useState<number | null>(null);
  const [avwapArmed, setAvwapArmed] = React.useState(false);

  // Slice-9 / CH-3C (2026 chart audit, TradingView "+ Compare"): list of
  // symbols overlaid on the main chart for percent-change comparison.
  // Symbols are added via the "+ Compare" button in the toolbar; bars
  // for each compare symbol are fetched on demand via the existing
  // ``getBars`` API. Capped at 4 simultaneous compares so the overlay
  // stays readable.
  const [compareSymbols, setCompareSymbols] = React.useState<string[]>([]);
  const [compareInputOpen, setCompareInputOpen] = React.useState(false);
  const [compareInputValue, setCompareInputValue] = React.useState("");
  const compareBars = useSparklineBars(compareSymbols, {
    timeframe: "D",
    limit: 60,
  });
  // Key on primitive signature (symbols + per-symbol bar count) —
  // ``compareBars`` is a react-query wrapper whose identity churns
  // every poll and would otherwise re-fit the chart every render.
  // Extracted to variables so the lint rule can statically check them.
  const compareSymbolsKey = compareSymbols.join(",");
  const compareBarCountsKey = compareSymbols.map((s) => compareBars[s]?.length ?? 0).join(",");
  // Build the {symbol, bars} array from the closes-per-symbol cache.
  // Convert closes[] back into OHLCVBar[] (we only need close + time).
  const compareSeriesProp = React.useMemo(() => {
    return compareSymbols.flatMap((sym) => {
      const closes = compareBars[sym];
      if (!closes || closes.length < 2) return [];
      // Synthetic time series — index-based seconds from now back N days.
      const now = Math.floor(Date.now() / 1000);
      const dayS = 24 * 60 * 60;
      const bars = closes.map((close, i) => ({
        time: now - (closes.length - i - 1) * dayS,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
      }));
      return [{ symbol: sym, bars }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on primitive signatures (compareSymbolsKey, compareBarCountsKey) instead of identity-unstable compareSymbols/compareBars
  }, [compareSymbolsKey, compareBarCountsKey]);

  // Slice-8 / CH-3D (2026 chart audit, TradingView signature): Bar Replay.
  //   ``replayEnabled`` — toggles the entire replay UX
  //   ``replayCursor`` — bar index up to which the chart is shown
  //   ``replaySpeed``  — playback speed multiplier (1×, 2×, 5×, 10×)
  //   ``replayPlaying``— whether the auto-advance interval is running
  // When ``replayEnabled`` is on we slice ``data`` before passing it to
  // TradingChart, so the chart shows ONLY bars up to ``replayCursor``.
  // Auto-advance uses setInterval at ``1000 / replaySpeed`` ms cadence.
  const [replayEnabled, setReplayEnabled] = React.useState(false);
  const [replayCursor, setReplayCursor] = React.useState(0);
  const [replaySpeed, setReplaySpeed] = React.useState<1 | 2 | 5 | 10>(2);
  const [replayPlaying, setReplayPlaying] = React.useState(false);

  // v2 chart polish — range chip selector. ``ALL`` keeps the existing
  // full-data behavior; specific ranges trim ``data`` to the trailing
  // window anchored at the last bar's timestamp.
  // 2026-05-09 cleanup: the inline range chips were retired (pensive-kirch's
  // _v2/ChartToolbar now owns range selection above every consumer). State
  // is parked at ALL so `visibleData` continues to pass through the full
  // bar set; a future consumer can re-thread an external setter through
  // ChartPaneProps if it wants per-pane range scoping back.
  const rangeChip: RangeChipId = "ALL";

  // Initialize cursor to a sensible position when replay is first enabled.
  // Default to ~60% of history so the user immediately sees motion.
  React.useEffect(() => {
    if (replayEnabled && replayCursor === 0 && data.length > 10) {
      setReplayCursor(Math.floor(data.length * 0.6));
    }
    if (!replayEnabled) {
      setReplayPlaying(false);
    }
  }, [replayEnabled, data.length, replayCursor]);

  // Auto-advance loop. Stops when we reach the end of the data.
  // Honors ``prefers-reduced-motion``: a user who's flagged it gets
  // step-only replay (no auto-advance) — the play button still works
  // but each click moves one bar instead of starting an interval.
  React.useEffect(() => {
    if (!replayEnabled || !replayPlaying) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      // Single-step on each "play" click; turn off the auto loop so
      // the user can advance bar-by-bar without a moving image.
      setReplayCursor((c) => Math.min(data.length, c + 1));
      setReplayPlaying(false);
      return;
    }
    const intervalMs = Math.max(50, 1000 / replaySpeed);
    const id = setInterval(() => {
      setReplayCursor((c) => {
        const next = c + 1;
        if (next >= data.length) {
          setReplayPlaying(false);
          return data.length;
        }
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [replayEnabled, replayPlaying, replaySpeed, data.length]);

  // Slice the data passed to the chart when replay is on. When off,
  // this is the identity — full data. ``React.useMemo`` keeps the
  // reference stable so TradingChart's didFitRef logic isn't broken.
  const visibleData = React.useMemo(
    () => {
      const base = replayEnabled
        ? data.slice(0, Math.min(Math.max(replayCursor, 1), data.length))
        : data;
      const chip = RANGE_CHIPS.find((r) => r.id === rangeChip);
      if (!chip || chip.seconds == null || base.length === 0) return base;
      const lastTime =
        typeof base[base.length - 1].time === "number"
          ? (base[base.length - 1].time as number)
          : Number(base[base.length - 1].time);
      if (!Number.isFinite(lastTime)) return base;
      const cutoff = lastTime - chip.seconds;
      const trimmed = base.filter((b) => {
        const t = typeof b.time === "number" ? b.time : Number(b.time);
        return Number.isFinite(t) && t >= cutoff;
      });
      // If the requested range is wider than what we have loaded, fall
      // back to the full base — never render an empty chart for a chip.
      return trimmed.length > 1 ? trimmed : base;
    },
    [data, replayEnabled, replayCursor, rangeChip],
  );
  const tradeOverlayPrices = React.useMemo(
    () => uniqueTradeOverlayPrices(tradeOverlays),
    [tradeOverlays],
  );
  const [tradeOverlayCoordinates, setTradeOverlayCoordinates] = React.useState<PriceCoordinate[]>([]);
  const handleOverlayPriceCoordinates = React.useCallback((coordinates: PriceCoordinate[]) => {
    setTradeOverlayCoordinates(coordinates);
  }, []);

  const marketStructure = React.useMemo(
    () => deriveMarketStructure(visibleData, { maxZones: 6, maxBlocks: 3, binCount: 32 }),
    [visibleData],
  );

  // Extract `marketDepth` top-bid/ask snapshots to local variables so that
  // the lint rule can statically check the dependency expressions.
  const mdProvider = marketDepth?.provider;
  const mdKind = marketDepth?.kind;
  const mdIsL2 = marketDepth?.isL2;
  const mdTimestamp = marketDepth?.timestamp;
  const mdTopBid = marketDepth?.bids?.[0];
  const mdTopAsk = marketDepth?.asks?.[0];
  const mdTopBidPrice = mdTopBid?.price;
  const mdTopBidSize = mdTopBid?.size;
  const mdTopBidVenue = mdTopBid?.venue;
  const mdTopAskPrice = mdTopAsk?.price;
  const mdTopAskSize = mdTopAsk?.size;
  const mdTopAskVenue = mdTopAsk?.venue;
  const mdBidsLen = marketDepth?.bids?.length;
  const mdAsksLen = marketDepth?.asks?.length;
  const effectiveTopOfBook = React.useMemo(
    () => depthToTopOfBook(marketDepth) ?? topOfBook,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on stable primitive snapshots (mdProvider, mdKind, ...) instead of identity-unstable marketDepth object
    [
      mdProvider,
      mdKind,
      mdIsL2,
      mdTimestamp,
      mdTopBidPrice,
      mdTopBidSize,
      mdTopBidVenue,
      mdTopAskPrice,
      mdTopAskSize,
      mdTopAskVenue,
      mdBidsLen,
      mdAsksLen,
      topOfBook,
    ],
  );

  // Extract `effectiveTopOfBook` fields to locals so the lint rule can
  // statically check the dependency expressions.
  const etbBid = effectiveTopOfBook?.bid;
  const etbAsk = effectiveTopOfBook?.ask;
  const etbBidSize = effectiveTopOfBook?.bidSize;
  const etbAskSize = effectiveTopOfBook?.askSize;
  const etbBidExchange = effectiveTopOfBook?.bidExchange;
  const etbAskExchange = effectiveTopOfBook?.askExchange;
  const etbSource = effectiveTopOfBook?.source;
  const etbIsL2 = effectiveTopOfBook?.isL2;
  const etbKind = effectiveTopOfBook?.kind;
  const etbDepthLevels = effectiveTopOfBook?.depthLevels;
  const topBook = React.useMemo(
    () => normalizeTopOfBook(effectiveTopOfBook),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on extracted primitive fields, not the identity-unstable effectiveTopOfBook object
    [
      etbBid,
      etbAsk,
      etbBidSize,
      etbAskSize,
      etbBidExchange,
      etbAskExchange,
      etbSource,
      etbIsL2,
      etbKind,
      etbDepthLevels,
    ],
  );

  // Drawing state machine: `firstPoint` is set on the first click of a
  // two-click drawing (trend/rect/fib). The second click commits via
  // `add(...)` and clears. `hoverPoint` trails the crosshair so we can
  // render the in-progress preview without re-querying the chart API.
  const [firstPoint, setFirstPoint] = React.useState<{ time: number; price: number } | null>(null);
  const [hoverPoint, setHoverPoint] = React.useState<{ time: number; price: number } | null>(null);

  // Round-12 / CH-2: live OHLC from the chart's crosshair. Used by the
  // top-left overlay to give a TradingView-style readout when the user
  // hovers a bar.
  const [ohlcHover, setOhlcHover] = React.useState<
    | { open: number; high: number; low: number; close: number; volume?: number }
    | null
  >(null);

  // Slice-4 / CH-3B (TradingView pattern): the floating "+" alert
  // affordance follows the crosshair along the right edge of the
  // chart canvas — one click adds a price alert at the exact axis
  // price the user is pointing at.
  const [alertHover, setAlertHover] = React.useState<
    { price: number; y: number } | null
  >(null);

  // Slice-5 / CH-3A (NinjaTrader pattern): track Shift modifier so
  // the affordance switches mode — Shift held = "place limit" target
  // (B above mid, S below); no modifier = "add alert". One axis,
  // two affordances, distinguished by keyboard.
  const [shiftHeld, setShiftHeld] = React.useState(false);
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      setShiftHeld(e.shiftKey);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Use ``visibleData`` (not ``data``) so the Shift-click side decision
  // matches the scene the user actually sees under Bar Replay.
  const lastClose = visibleData.length > 0
    ? visibleData[visibleData.length - 1].close
    : ohlcHover?.close ?? null;

  const symbol = useMarketStore((s) => s.selectedSymbol);
  const { drawings, add } = useChartDrawings(symbol);

  const menuRef = React.useRef<HTMLDivElement | null>(null);

  // Close indicator menu on outside click / escape. Declared before any
  // early return so the hooks order stays stable (rules-of-hooks).
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Global Esc handler for the draw state machine: cancels in-progress
  // draw and falls back to the cursor tool. Scoped at window level so it
  // fires even when focus is on the chart canvas (which isn't focusable
  // by default in lightweight-charts v5).
  React.useEffect(() => {
    if (activeTool === "cursor" && firstPoint == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setFirstPoint(null);
      setActiveTool("cursor");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, firstPoint]);

  // Clicking a new tool mid-draw should abandon the in-progress draw so
  // the user doesn't end up with a half-committed shape bridging tools.
  const selectTool = React.useCallback((t: DrawingTool) => {
    setActiveTool(t);
    setFirstPoint(null);
  }, []);

  // Handle a click on the chart canvas. `horizontal` finalizes on the
  // FIRST click (single-point tool); other tools need two points. Text
  // is disabled at the button level, so this branch is defensive.
  const handleChartClick = React.useCallback(
    (pt: { time: number; price: number }) => {
      // Slice-14 / AVWAP-1: when the AVWAP tool is armed, the next chart
      // click drops the anchor and disarms. Find the bar whose time is
      // closest to the click.
      if (avwapArmed) {
        const t = pt.time;
        let bestIdx = 0;
        let bestDelta = Infinity;
        for (let i = 0; i < data.length; i++) {
          const barT =
            typeof data[i].time === "number"
              ? (data[i].time as number)
              : Math.floor(new Date(data[i].time).getTime() / 1000);
          const delta = Math.abs(barT - t);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIdx = i;
          }
        }
        setAvwapAnchor(bestIdx);
        setAvwapArmed(false);
        return;
      }
      if (activeTool === "cursor") return;
      if (activeTool === "text") {
        // Text drawing is a v2 feature; silently no-op for now.
        return;
      }
      const kind = TOOL_TO_KIND[activeTool];
      if (!kind) return;
      const color = readDrawingColor();
      if (kind === "horizontal") {
        add({ kind, points: [pt], color });
        // Drop back to cursor so the user doesn't accidentally line-flood
        // the chart — matches TradingView's single-shot-tool behaviour.
        setFirstPoint(null);
        setActiveTool("cursor");
        return;
      }
      if (firstPoint == null) {
        setFirstPoint(pt);
        return;
      }
      add({ kind, points: [firstPoint, pt], color });
      setFirstPoint(null);
      setActiveTool("cursor");
    },
    [activeTool, firstPoint, add, avwapArmed, data],
  );

  // Compose the drawings array with a transient preview entry whenever
  // the user has placed firstPoint and the crosshair is over the canvas.
  // The preview is a real Drawing object so the plugin renders it with
  // the same code path as persisted shapes — no preview-only renderer.
  const drawingsWithPreview = React.useMemo<Drawing[]>(() => {
    const kind = TOOL_TO_KIND[activeTool];
    if (!kind || activeTool === "cursor") return drawings;
    if (kind === "horizontal" && hoverPoint) {
      return [
        ...drawings,
        {
          id: "__preview",
          kind,
          points: [hoverPoint],
          color: "rgba(224, 192, 112, 0.6)",
          createdAt: 0,
        },
      ];
    }
    if (firstPoint && hoverPoint) {
      return [
        ...drawings,
        {
          id: "__preview",
          kind,
          points: [firstPoint, hoverPoint],
          color: "rgba(224, 192, 112, 0.6)",
          createdAt: 0,
        },
      ];
    }
    return drawings;
  }, [drawings, activeTool, firstPoint, hoverPoint]);

  const marketStructureDrawings = React.useMemo<Drawing[]>(() => {
    if (visibleData.length < 2) return [];
    const firstTime = visibleData[0].time;
    const lastTime = visibleData[visibleData.length - 1].time;
    const zoneDrawings: Drawing[] = [];
    const structureColors = getStructureColors();

    if (structureZonesOn) {
      for (const zone of marketStructure.zones) {
        const color = zone.kind === "support"
          ? structureColors.support
          : structureColors.resistance;
        zoneDrawings.push({
          id: `market-structure:${zone.id}`,
          kind: "rect",
          points: zone.kind === "support"
            ? [
                { time: firstTime, price: zone.lower },
                { time: lastTime, price: zone.upper },
              ]
            : [
                { time: firstTime, price: zone.upper },
                { time: lastTime, price: zone.lower },
              ],
          color,
          createdAt: 0,
        });
      }
    }

    if (orderBlocksOn) {
      for (const block of marketStructure.orderBlocks) {
        const color = block.kind === "demand"
          ? structureColors.demand
          : structureColors.supply;
        zoneDrawings.push({
          id: `market-block:${block.id}`,
          kind: "rect",
          points: block.kind === "demand"
            ? [
                { time: block.originTime, price: block.lower },
                { time: block.endTime, price: block.upper },
              ]
            : [
                { time: block.originTime, price: block.upper },
                { time: block.endTime, price: block.lower },
              ],
          color,
          createdAt: 0,
        });
      }
    }

    return zoneDrawings;
  }, [marketStructure.orderBlocks, marketStructure.zones, orderBlocksOn, structureZonesOn, visibleData]);

  const bookPriceLines = React.useMemo(() => {
    if (!topOfBookOn || !topBook) return [];
    const bookColors = getBookColors();
    return [
      {
        price: topBook.bid,
        color: bookColors.bid,
        label: `Bid ${formatBookPrice(topBook.bid)} x${formatBookSize(topBook.bidSize)}`,
      },
      {
        price: topBook.ask,
        color: bookColors.ask,
        label: `Ask ${formatBookPrice(topBook.ask)} x${formatBookSize(topBook.askSize)}`,
      },
    ];
  }, [topBook, topOfBookOn]);

  const structurePriceLines = React.useMemo(() => {
    const lines: Array<{ price: number; color: string; label?: string }> = [];
    const structureColors = getStructureColors();

    if (liquidityProfileOn) {
      const poc = marketStructure.profile.find((bin) => bin.isPoc);
      if (poc) {
        lines.push({
          price: poc.mid,
          color: structureColors.poc,
          label: `POC ${formatStructurePrice(poc.mid)}`,
        });
      }
    }

    if (structureZonesOn) {
      for (const zone of marketStructure.zones) {
        const label = zone.kind === "support" ? "Support" : "Resistance";
        lines.push({
          price: zone.mid,
          color: zone.kind === "support"
            ? structureColors.support
            : structureColors.resistance,
          label: `${label} ${formatStructurePrice(zone.lower)}-${formatStructurePrice(zone.upper)}`,
        });
      }
    }

    if (orderBlocksOn) {
      for (const block of marketStructure.orderBlocks) {
        const mid = (block.lower + block.upper) / 2;
        const label = block.kind === "demand" ? "Demand block" : "Supply block";
        lines.push({
          price: mid,
          color: block.kind === "demand"
            ? structureColors.demand
            : structureColors.supply,
          label: `${label} ${block.relativeVolume.toFixed(1)}x vol`,
        });
      }
    }

    return lines;
  }, [
    liquidityProfileOn,
    marketStructure.orderBlocks,
    marketStructure.profile,
    marketStructure.zones,
    orderBlocksOn,
    structureZonesOn,
  ]);

  const chartPriceLines = React.useMemo(
    () => [
      ...bookPriceLines,
      ...structurePriceLines,
      ...tradeOverlays.flatMap((overlay) => tradeOverlayPriceLines(overlay)),
    ],
    [bookPriceLines, structurePriceLines, tradeOverlays],
  );

  const chartDrawings = React.useMemo<Drawing[]>(
    () => [...marketStructureDrawings, ...drawingsWithPreview],
    [drawingsWithPreview, marketStructureDrawings],
  );

  const drawMode = activeTool !== "cursor";

  const toggleIndicator = (i: Indicator) => {
    setIndicators((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
    );
  };

  return (
    <div
      data-slot="chart-pane"
      className={cn("relative flex-1 min-h-0 flex flex-col", className)}
    >
      {/* Top chrome: chart-type toggle (left) + indicator button (right).
          40px tall (h-10, WCAG 2.5.5 hit target). Rendered OUTSIDE the
          inner rail+canvas flex-row so it spans full width — previously
          the drawing rail sat alongside this bar and the first tool
          button's top edge clipped into the chrome's border, making it
          appear half-hidden. With the chrome above and the rail below,
          every drawing button is fully visible and unambiguously
          clickable. */}
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 overflow-visible border-b border-border-hair bg-bg-elev-1/30 px-3 py-1.5 shrink-0">
          <div aria-label="Chart type" className="flex gap-0.5">
            {TYPES.map((t) => {
              const active = chartType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setChartType(t.id)}
                  title={t.label}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 px-2.5 rounded-xs transition-colors",
                    "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
                    active
                      ? "text-ink-1000 bg-bg-elev-2"
                      : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
                  )}
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* (Range chips removed 2026-05-09 — pensive-kirch's
              `_v2/ChartToolbar.tsx` now owns the range pills above
              every consumer of ChartPane (trade page, symbol pages),
              and rendering both produced two stacked toolbars on
              tradingalpha.net. The internal `rangeChip` state below
              still drives `visibleData` if a future consumer needs to
              re-expose a chip group inline; for now it stays parked at
              ALL by default.) */}

          {/* Slice-9 / CH-3C: "+ Compare" toolbar button.
              Click to expand a small input where the user types a symbol
              (SPY / QQQ / etc.); pressing Enter adds it to the overlay.
              Active compare symbols render as small chips below the
              toolbar with an ✕ to remove. Capped at 4 symbols.
              TradingView convention: compare series scale to %-change
              from first bar so AAPL @ $200 and SPY @ $500 land on
              the same axis. */}
          <div className="relative inline-flex items-center mr-1">
            <button
              type="button"
              onClick={() => setCompareInputOpen((v) => !v)}
              aria-pressed={compareInputOpen}
              title="Compare symbol — overlay a second symbol on the chart, % change basis"
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors",
                "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
                compareSymbols.length > 0 || compareInputOpen
                  ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                  : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
              )}
            >
              <span aria-hidden="true">+</span>
              <span>Compare</span>
              {compareSymbols.length > 0 && (
                <span className="font-mono tabular-nums text-fg-muted">
                  {compareSymbols.length}
                </span>
              )}
            </button>
            {compareInputOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const sym = compareInputValue.trim().toUpperCase();
                  // Round-17 / persona-C: broaden the regex so legit
                  // tickers like BF.B, BRK-B, RDS.A, GOOGL (5), and
                  // 7+-char foreign listings pass. Pre-fix the regex
                  // silently dropped them with no error toast.
                  if (
                    sym &&
                    /^[A-Z]{1,7}([.\-][A-Z]{1,2})?$/.test(sym) &&
                    !compareSymbols.includes(sym) &&
                    compareSymbols.length < 4
                  ) {
                    setCompareSymbols((prev) => [...prev, sym]);
                    setCompareInputValue("");
                  }
                }}
                className="absolute left-0 top-full mt-1 z-30 flex items-center gap-1 rounded border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1.5 shadow-lg"
              >
                <input
                  autoFocus
                  type="text"
                  value={compareInputValue}
                  onChange={(e) => setCompareInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setCompareInputOpen(false);
                      setCompareInputValue("");
                    }
                  }}
                  placeholder="SPY, QQQ, …"
                  aria-label="Compare symbol ticker"
                  maxLength={10}
                  className="bg-transparent border border-[color:var(--border)] rounded-xs px-2 py-1 t-mono text-label text-[color:var(--fg)] uppercase outline-none focus:border-[color:var(--brand)] w-24"
                />
                <button
                  type="submit"
                  className="t-mono text-label text-[color:var(--brand)] hover:underline"
                  disabled={compareSymbols.length >= 4}
                >
                  Add
                </button>
              </form>
            )}
          </div>

          <button
            type="button"
            onClick={() => setTopOfBookOn((v) => !v)}
            aria-pressed={topOfBookOn}
            title={
              topBook
                ? topBook.isL2
                  ? "Show order-book best bid/ask and depth context"
                  : "Show top-of-book bid/ask lines and spread (not full Level II depth)"
                : "Top-of-book bid/ask unavailable for this symbol"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              topOfBookOn && topBook
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h5M2 6h8M2 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M8.7 2.4v2.2M8.7 7.4v2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.65" />
            </svg>
            <span>Book</span>
          </button>

          {/* Market structure controls. Profile is a volume-at-price
              liquidity proxy; S/R and Blocks are inferred from OHLCV. */}
          <button
            type="button"
            onClick={() => setLiquidityProfileOn((v) => !v)}
            aria-pressed={liquidityProfileOn}
            title={liquidityProfileOn ? "Hide volume-at-price estimate" : "Show volume-at-price estimate (POC + Value Area, not live depth)"}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              liquidityProfileOn
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="3" width="6" height="1.4" fill="currentColor" />
              <rect x="2" y="5" width="9" height="1.4" fill="currentColor" />
              <rect x="2" y="7" width="4" height="1.4" fill="currentColor" />
            </svg>
            <span>Profile</span>
          </button>

          <button
            type="button"
            onClick={() => setStructureZonesOn((v) => !v)}
            aria-pressed={structureZonesOn}
            title={structureZonesOn ? "Hide support/resistance ranges" : "Show support/resistance ranges"}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              structureZonesOn
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 3.5h9M1.5 8.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M2.5 3.5c1.4-1.2 2.6-1.2 4 0s2.6 1.2 3.5 0M2.5 8.5c1.4 1.2 2.6 1.2 4 0s2.6-1.2 3.5 0" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
            </svg>
            <span>S/R</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {marketStructure.zones.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOrderBlocksOn((v) => !v)}
            aria-pressed={orderBlocksOn}
            title={orderBlocksOn ? "Hide inferred high-volume supply/demand zones" : "Show inferred high-volume supply/demand zones"}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              orderBlocksOn
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2.5" width="8" height="2.4" rx="0.4" fill="currentColor" opacity="0.55" />
              <rect x="3" y="6.8" width="6" height="2.7" rx="0.4" fill="currentColor" />
            </svg>
            <span>Blocks</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {marketStructure.orderBlocks.length}
            </span>
          </button>

          {/* Slice-14 / AVWAP-1: anchored-VWAP toolbar button.
              Click → arms; next chart click drops the anchor; AVWAP
              renders as a dashed brand-gold line from anchor → present.
              Click again to clear. Quantower / TradingView power-tool. */}
          <button
            type="button"
            onClick={() => {
              if (avwapAnchor != null) {
                // Already anchored — clear it.
                setAvwapAnchor(null);
                setAvwapArmed(false);
              } else {
                // Arm or disarm.
                setAvwapArmed((v) => !v);
              }
            }}
            aria-pressed={avwapArmed || avwapAnchor != null}
            title={
              avwapAnchor != null
                ? `AVWAP anchored at bar ${avwapAnchor + 1} — click to clear`
                : avwapArmed
                  ? "Click any bar to anchor VWAP — click button again to cancel"
                  : "Anchored VWAP — click then pick a bar to anchor"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              avwapAnchor != null
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : avwapArmed
                  ? "text-[color:var(--brand)] bg-[color:var(--brand)]/10 ring-1 ring-[color:var(--brand)]/40 motion-safe:animate-pulse"
                  : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 10v-3M5 10V4M8 10V2M11 10V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>AVWAP</span>
          </button>

          {/* Slice-8 / CH-3D: Bar Replay toggle. Off → button is muted;
              on → button is brand-tinted and the canvas shows the
              ⏮⏯⏭ control strip. TradingView signature. */}
          <button
            type="button"
            onClick={() => setReplayEnabled((v) => !v)}
            aria-pressed={replayEnabled}
            title={
              replayEnabled
                ? "Exit Bar Replay"
                : "Enter Bar Replay — scrub through historical bars"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
              replayEnabled
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polygon points="3,2 3,10 10,6" fill="currentColor" />
            </svg>
            <span>Replay</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors",
                "font-sans text-eyebrow font-medium uppercase tracking-[0.08em]",
                indicators.length > 0
                  ? "text-gold-300 hover:bg-bg-elev-1"
                  : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
              )}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 9l3-4 2.5 2L11 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Indicators</span>
              {indicators.length > 0 ? (
                <span className="font-mono tabular-nums text-fg-muted">
                  {indicators.length}
                </span>
              ) : null}
            </button>

            {menuOpen ? (
              <div
                className={cn(
                  "absolute right-0 top-full mt-1 z-20",
                  "min-w-[180px] bg-bg-elev-2 border border-border rounded-sm shadow-lg",
                  "py-1",
                )}
              >
                {ALL_INDICATORS.map((i) => {
                  const on = indicators.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleIndicator(i)}
                      className={cn(
                        "w-full flex items-center gap-2 h-9 px-3 text-sm text-left transition-colors",
                        "hover:bg-bg-elev-1",
                        on ? "text-ink-1000" : "text-fg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-3.5 h-3.5 rounded-xs border",
                          on ? "bg-gold-500 border-gold-500 text-bg" : "border-border-hair",
                        )}
                      >
                        {on ? (
                          <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
                            <path d="M1 4.5l2.5 2.5L8 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="font-mono font-medium">{i}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

      {/* Below-chrome row: drawing-tools rail (left, md+) + canvas area. */}
      <div className="flex-1 min-h-0 flex">
        {/* Drawing-tools rail (left). 44px wide — each button hits the
            WCAG 2.5.5 40×40 minimum on desktop. Mobile (<md) hides the
            rail; a follow-up will surface it as a popover. */}
        <div
          data-slot="chart-tools"
          role="toolbar"
          aria-label="Drawing tools"
          aria-orientation="vertical"
          className="hidden md:flex flex-col gap-px w-11 shrink-0 bg-bg-elev-1/40 border-r border-border-hair py-1"
        >
          {DRAWING_TOOLS.map((t) => {
            const active = activeTool === t.id;
            const disabled = Boolean(t.disabled);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (!disabled) selectTool(t.id); }}
                title={t.label}
                aria-label={t.label}
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                className={cn(
                  "w-11 h-10 inline-flex items-center justify-center rounded-xs transition-colors",
                  disabled
                    ? "text-fg-hint/50 cursor-not-allowed"
                    : active
                      ? "text-gold-300 bg-bg-elev-2"
                      : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
                )}
              >
                {t.icon}
              </button>
            );
          })}
        </div>

        {/* Canvas — min-height bumped 260 → 440 (2026-05-07) so the
            inner chart pane respects the new outer 480/620px container.
            Without this bump the flex-1 child could collapse under
            indicator/volume overlays on tall layouts. */}
        <div className="flex-1 relative min-h-[440px] min-w-0">
          {error ? (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2.5"
            >
              <span className="font-display italic text-body text-fg-muted">
                Failed to load chart data.
              </span>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    "font-sans font-semibold uppercase text-label tracking-[0.12em]",
                    "text-primary hover:text-gold-300 border border-border bg-bg-elev-1",
                    "rounded-xs px-3 h-9 transition-colors",
                  )}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : isLoading ? (
            <div
              aria-hidden="true"
              className="absolute inset-3 rounded-md bg-bg-elev-1 animate-pulse"
            />
          ) : data.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center px-6">
              <span className="font-display italic text-numeric-md text-fg-muted">
                Not enough price data.
              </span>
              <span className="font-sans text-body-sm text-fg-hint">
                Try a wider range or check back once bars arrive.
              </span>
            </div>
          ) : (
            // Wrapper carries the draw-mode cursor so the chart canvas
            // (which is inside TradingChart) visually telegraphs that a
            // click will drop a point instead of panning.
            <div className={cn("absolute inset-0", drawMode && "cursor-crosshair")}>
              {/* Slice-9 / CH-3C: active compare-symbol chips. Each chip has
                  a colored swatch matching its overlay line + an ✕ to remove.
                  Anchored top-right of the canvas so they sit outside the
                  drawing tools rail and the OHLC overlay. */}
              {compareSymbols.length > 0 && (
                <div
                  data-slot="chart-compare-chips"
                  className={cn(
                    "absolute right-3 z-10 flex flex-col items-end gap-1",
                    topOfBookOn && topBook ? "top-20" : "top-3",
                  )}
                >
                  {compareSymbols.map((sym, idx) => {
                    const palette = ["#5b8def", "#a07550", "#e07856", "#a8d04d"];
                    const color = palette[idx % palette.length];
                    return (
                      <button
                        key={sym}
                        type="button"
                        onClick={() =>
                          setCompareSymbols((prev) => prev.filter((s) => s !== sym))
                        }
                        title={`Remove ${sym} from compare`}
                        className="inline-flex items-center gap-1.5 rounded border border-[color:var(--border)]/60 bg-[color:var(--bg-card)]/80 backdrop-blur-md px-1.5 py-0.5 t-mono text-label text-[color:var(--fg)] hover:border-[color:var(--loss)]/60 hover:text-[color:var(--loss)] transition-colors"
                      >
                        <span
                          aria-hidden="true"
                          className="inline-block h-1.5 w-3 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                        <span>{sym}</span>
                        <span className="opacity-60 text-label">×</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {topOfBookOn && topBook && (
                <div
                  data-slot="chart-top-book-overlay"
                  className="pointer-events-none absolute right-3 top-3 z-10 hidden w-[min(260px,calc(100%-1.5rem))] rounded border border-[color:var(--border)]/45 bg-[color:var(--bg-card)]/62 px-2.5 py-2 t-mono text-label text-[color:var(--fg-muted)] backdrop-blur-md sm:block"
                >
                  <TopOfBookReadout book={topBook} />
                </div>
              )}
              {/* Slice-17 / VPF-1: volume profile overlay. Sits to the
                  right of the price axis at low opacity so it doesn't
                  fight the candles for visual weight. POC bin is
                  brand-gold; Value Area bins are lighter; rest are
                  muted border-color. */}
              {liquidityProfileOn && (
                <div
                  data-slot="chart-volume-profile-overlay"
                  className="pointer-events-none absolute right-12 top-3 bottom-12 z-10 hidden opacity-70 sm:block"
                >
                  <VolumeProfile
                    bars={visibleData}
                    height={300}
                    width={70}
                    label="Volume-at-price estimate"
                  />
                </div>
              )}
              <TradingChart
                data={visibleData}
                chartType={chartType}
                themeKey={chartThemeKey}
                compareSeries={compareSeriesProp}
                anchoredVwapIndex={avwapAnchor}
                indicators={indicators}
                drawMode={drawMode}
                drawings={chartDrawings}
                drawingPriceLines={chartPriceLines}
                overlayPrices={tradeOverlayPrices}
                onOverlayPriceCoordinates={handleOverlayPriceCoordinates}
                onChartClick={handleChartClick}
                onDrawCrosshair={setHoverPoint}
                // Round-12 / CH-2 (P1): wire OHLC hover to the overlay below.
                onCrosshairMove={(_p, _t, ohlcv) => setOhlcHover(ohlcv ?? null)}
                // Slice-4 / CH-3B: wire alert-hover to the floating "+" overlay.
                onAlertHover={(price, y) =>
                  setAlertHover(price != null && y != null ? { price, y } : null)
                }
                onLoadMoreHistory={onLoadMoreHistory}
                loadingMoreHistory={loadingMoreHistory}
              />
              <TradeOverlayLayer
                overlays={tradeOverlays}
                bars={visibleData}
                coordinates={tradeOverlayCoordinates}
              />
              {/* Round-12 / CH-2: TradingView-style OHLC + indicator legend
                  overlay. Renders top-left so it never overlaps with the
                  toolbars on the top-right. Always visible (shows last bar
                  when crosshair isn't active) so the user can see the
                  current bar's values at a glance.

                  Round-12 / CH-4: pill is intentionally translucent
                  (40% bg + medium backdrop-blur) so the price bars
                  underneath stay legible. Border alpha matches so a
                  dark-mode chart isn't bordered with an opaque hairline. */}
              <div
                data-slot="chart-ohlc-overlay"
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] overflow-hidden rounded border border-[color:var(--border)]/40 bg-[color:var(--bg-card)]/40 px-2 py-1 t-mono text-label backdrop-blur-md sm:left-3 sm:top-3 sm:px-2.5 sm:py-1.5 sm:text-label"
              >
                <OHLCReadout
                  hover={ohlcHover}
                  lastBar={visibleData[visibleData.length - 1] ?? null}
                  indicators={indicators}
                />
              </div>
              {((topOfBookOn && topBook) || liquidityProfileOn || structureZonesOn || orderBlocksOn) && (
                <div
                  data-slot="market-structure-summary"
                  className="pointer-events-none absolute left-3 bottom-3 z-10 hidden max-w-[min(520px,calc(100%-7rem))] rounded border border-[color:var(--border)]/45 bg-[color:var(--bg-card)]/55 px-2.5 py-1.5 t-mono text-label text-[color:var(--fg-muted)] backdrop-blur-md sm:block"
                >
                  <span className="text-[color:var(--fg)]">Structure map</span>
                  {topOfBookOn && topBook && (
                    <>
                      <span className="mx-1.5 text-[color:var(--border-strong)]">·</span>
                      <span>top book spread {formatBookPrice(topBook.spread)}</span>
                    </>
                  )}
                  <span className="mx-1.5 text-[color:var(--border-strong)]">·</span>
                  <span>{marketStructure.hasVolume ? "volume proxy" : "price-only"}</span>
                  {structureZonesOn && (
                    <>
                      <span className="mx-1.5 text-[color:var(--border-strong)]">·</span>
                      <span>{marketStructure.zones.length} S/R ranges</span>
                    </>
                  )}
                  {orderBlocksOn && (
                    <>
                      <span className="mx-1.5 text-[color:var(--border-strong)]">·</span>
                      <span>{marketStructure.orderBlocks.length} blocks</span>
                    </>
                  )}
                  <span className="mx-1.5 text-[color:var(--border-strong)]">·</span>
                  <span>{topBook?.isL2 ? "live L2 depth" : "not live L2 depth"}</span>
                </div>
              )}
              {/* Slice-8 / CH-3D: Bar Replay control strip — appears at
                  the bottom-right of the canvas when replay mode is on.
                  Mirrors TradingView's playback controls: ⏮ rewind 10
                  bars, ⏯ play/pause, ⏭ step forward 1 bar, then a
                  speed picker (1× 2× 5× 10×) and an exit X. The cursor
                  position is reflected in the bar count "324 / 500".
                  TradingView gates this behind their paid tier; we
                  ship it free per the design brief. */}
              {replayEnabled && (
                <div
                  data-slot="chart-replay-controls"
                  className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded border border-[color:var(--border)]/60 bg-[color:var(--bg-card)]/90 px-2 py-1 t-mono text-label backdrop-blur-md shadow-sm"
                >
                  <button
                    type="button"
                    aria-label="Rewind 10 bars"
                    title="Rewind 10 bars"
                    onClick={() => setReplayCursor((c) => Math.max(1, c - 10))}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded hover:bg-[color:var(--bg-elev-1)] transition-colors"
                  >
                    ⏮
                  </button>
                  <button
                    type="button"
                    aria-label={replayPlaying ? "Pause replay" : "Play replay"}
                    title={replayPlaying ? "Pause" : "Play"}
                    onClick={() => setReplayPlaying((p) => !p)}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded text-[color:var(--brand)] hover:bg-[color:var(--brand)] hover:text-[color:var(--bg-base)] transition-colors"
                  >
                    {replayPlaying ? "⏸" : "▶"}
                  </button>
                  <button
                    type="button"
                    aria-label="Step forward one bar"
                    title="Forward one bar"
                    onClick={() =>
                      setReplayCursor((c) => Math.min(data.length, c + 1))
                    }
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded hover:bg-[color:var(--bg-elev-1)] transition-colors"
                  >
                    ⏭
                  </button>
                  <select
                    aria-label="Replay speed"
                    title="Playback speed"
                    value={replaySpeed}
                    onChange={(e) =>
                      setReplaySpeed(Number(e.target.value) as 1 | 2 | 5 | 10)
                    }
                    className="min-h-10 bg-transparent border-none outline-none px-1 text-[color:var(--fg)] cursor-pointer"
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                  </select>
                  <span className="px-1 u-muted tabular-nums" aria-live="polite">
                    {replayCursor} / {data.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Exit replay mode"
                    title="Exit replay"
                    onClick={() => {
                      setReplayEnabled(false);
                      setReplayPlaying(false);
                      setReplayCursor(0);
                    }}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded hover:bg-[color:var(--loss)] hover:text-[color:var(--bg-base)] transition-colors"
                  >
                    ×
                  </button>
                </div>
              )}
              {/* Slice-4 / CH-3B + Slice-5 / CH-3A: floating chart-axis
                  affordance. Two modes, switched by the Shift key:

                  · No modifier: "+" → adds a price alert at the axis
                    price (TradingView pattern).
                  · Shift held:  "B" or "S" → places a buy/sell limit
                    order at the axis price (NinjaTrader pattern). B
                    when the cursor is BELOW current close, S when
                    ABOVE.

                  Tooltip teaches the modifier. Color tracks side
                  (buy = profit, sell = loss) when in trade mode.
                  Same single button — one affordance, two roles. */}
              {alertHover && (() => {
                const placementEnabled = chartOrderPlacement?.enabled === true;
                const tradeMode = (placementEnabled || shiftHeld) && lastClose != null;
                const side: "buy" | "sell" =
                  placementEnabled && chartOrderPlacement?.side
                    ? chartOrderPlacement.side
                    : tradeMode && alertHover.price < lastClose!
                      ? "buy"
                      : "sell";
                const label = tradeMode ? (side === "buy" ? "B" : "S") : "+";
                const ariaLabel = tradeMode
                  ? `Stage ${side} limit at ${alertHover.price.toFixed(2)}`
                  : `Add price alert at ${alertHover.price.toFixed(2)}`;
                const titleCopy = tradeMode
                  ? `${side === "buy" ? "Buy" : "Sell"} limit @ $${alertHover.price.toFixed(2)} · click to stage`
                  : `Add alert @ $${alertHover.price.toFixed(2)} · Shift-click for limit order`;
                const tone = tradeMode
                  ? side === "buy"
                    ? "border-[color:var(--profit)]/60 text-[color:var(--profit)] hover:bg-[color:var(--profit)] hover:text-[color:var(--bg-base)]"
                    : "border-[color:var(--loss)]/60 text-[color:var(--loss)] hover:bg-[color:var(--loss)] hover:text-[color:var(--bg-base)]"
                  : "border-[color:var(--brand)]/60 text-[color:var(--brand)] hover:bg-[color:var(--brand)] hover:text-[color:var(--bg-base)]";
                return (
                  <button
                    type="button"
                    data-slot="chart-axis-affordance"
                    data-mode={tradeMode ? "trade" : "alert"}
                    aria-label={ariaLabel}
                    title={titleCopy}
                    onClick={(e) => {
                      if (typeof window === "undefined") return;
                      // Re-read modifier from the click event itself —
                      // the keydown listener can lag if the user holds
                      // Shift after the cursor lands on the button.
                      const isTrade = e.shiftKey && lastClose != null;
                      if (placementEnabled) {
                        chartOrderPlacement.onStagePrice(alertHover.price, side);
                      } else if (isTrade) {
                        const orderSide: "buy" | "sell" =
                          alertHover.price < lastClose! ? "buy" : "sell";
                        window.dispatchEvent(
                          new CustomEvent("alphadesk:place-limit-from-chart", {
                            detail: {
                              symbol,
                              price: alertHover.price,
                              side: orderSide,
                              source: "chart-axis-shift-click",
                            },
                          }),
                        );
                      } else {
                        window.dispatchEvent(
                          new CustomEvent("alphadesk:add-price-alert", {
                            detail: {
                              symbol,
                              price: alertHover.price,
                              source: "chart-axis-hover",
                            },
                          }),
                        );
                      }
                    }}
                    className={cn(
                      "absolute z-20 -translate-y-1/2 right-1 inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-full bg-[color:var(--bg-card)] text-label leading-none shadow-sm transition-colors",
                      tone,
                    )}
                    style={{ top: alertHover.y }}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function tradeOverlayPriceLines(overlay: ChartTradeOverlay) {
  const lines: Array<{ price: number; color: string; label?: string }> = [];
  const entryColor = overlay.status === "live" ? "rgba(201, 166, 107, 0.95)" : "rgba(224, 192, 112, 0.76)";
  if (overlay.entry != null && Number.isFinite(overlay.entry)) {
    lines.push({
      price: overlay.entry,
      color: entryColor,
      label: `${overlay.status === "draft" ? "Draft" : overlay.status === "pending" ? "Working" : "Entry"} ${formatBookPrice(overlay.entry)}`,
    });
  }
  if (overlay.stopLoss != null && Number.isFinite(overlay.stopLoss)) {
    lines.push({
      price: overlay.stopLoss,
      color: "rgba(224, 120, 86, 0.9)",
      label: `SL ${formatBookPrice(overlay.stopLoss)}`,
    });
  }
  if (overlay.takeProfit != null && Number.isFinite(overlay.takeProfit)) {
    lines.push({
      price: overlay.takeProfit,
      color: "rgba(168, 208, 77, 0.9)",
      label: `TP ${formatBookPrice(overlay.takeProfit)}`,
    });
  }
  return lines;
}

function uniqueTradeOverlayPrices(overlays: ChartTradeOverlay[]) {
  const seen = new Set<string>();
  const prices: number[] = [];
  for (const overlay of overlays) {
    for (const price of [overlay.entry, overlay.stopLoss, overlay.takeProfit]) {
      if (price == null || !Number.isFinite(price)) continue;
      const key = priceKey(price);
      if (seen.has(key)) continue;
      seen.add(key);
      prices.push(price);
    }
  }
  return prices;
}

function priceKey(price: number) {
  return price.toFixed(8);
}

interface OverlayTop {
  value: number;
  unit: "px" | "%";
}

function overlayTopCss(top: OverlayTop) {
  return `${top.value}${top.unit}`;
}

function overlaySizeCss(a: OverlayTop, b: OverlayTop) {
  const minimum = a.unit === "px" ? 14 : 1.4;
  return `${Math.max(Math.abs(a.value - b.value), minimum)}${a.unit}`;
}

function TradeOverlayLayer({
  overlays,
  bars,
  coordinates,
}: {
  overlays: ChartTradeOverlay[];
  bars: OHLCVBar[];
  coordinates?: PriceCoordinate[];
}) {
  const coordinateByPrice = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const coordinate of coordinates ?? []) {
      if (coordinate.y == null || !Number.isFinite(coordinate.y)) continue;
      map.set(priceKey(coordinate.price), coordinate.y);
    }
    return map;
  }, [coordinates]);
  const exactPrices = React.useMemo(() => uniqueTradeOverlayPrices(overlays), [overlays]);
  const canUseExactCoordinates =
    exactPrices.length > 0 &&
    exactPrices.every((price) => coordinateByPrice.has(priceKey(price)));
  const scale = React.useMemo(() => {
    const prices: number[] = [];
    for (const bar of bars) prices.push(bar.high, bar.low);
    for (const overlay of overlays) {
      for (const price of [overlay.entry, overlay.stopLoss, overlay.takeProfit]) {
        if (price != null && Number.isFinite(price)) prices.push(price);
      }
    }
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = Math.max((max - min) * 0.08, Math.abs(max || 1) * 0.002);
    return { min: min - pad, max: max + pad };
  }, [bars, overlays]);

  if ((!scale && !canUseExactCoordinates) || overlays.length === 0) return null;
  const topFor = (price: number) => {
    if (canUseExactCoordinates) {
      return { value: coordinateByPrice.get(priceKey(price)) ?? 0, unit: "px" as const };
    }
    const fallbackScale = scale ?? { min: 0, max: 1 };
    const span = fallbackScale.max - fallbackScale.min || 1;
    return {
      value: Math.max(2, Math.min(98, ((fallbackScale.max - price) / span) * 100)),
      unit: "%" as const,
    };
  };

  return (
    <div
      data-slot="chart-trade-overlays"
      className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-[11] overflow-hidden"
    >
      {overlays.map((overlay) => (
        <TradeOverlay key={overlay.id} overlay={overlay} topFor={topFor} />
      ))}
    </div>
  );
}

function TradeOverlay({
  overlay,
  topFor,
}: {
  overlay: ChartTradeOverlay;
  topFor: (price: number) => OverlayTop;
}) {
  const entry = overlay.entry;
  if (entry == null || !Number.isFinite(entry)) return null;
  const entryTop = topFor(entry);
  const isLong = overlay.side === "long";
  const stopTop =
    overlay.stopLoss != null && Number.isFinite(overlay.stopLoss)
      ? topFor(overlay.stopLoss)
      : null;
  const takeProfitTop =
    overlay.takeProfit != null && Number.isFinite(overlay.takeProfit)
      ? topFor(overlay.takeProfit)
      : null;
  const zone = (a: OverlayTop, b: OverlayTop, className: string) => (
    <div
      className={cn("absolute left-0 right-16 border-y", className)}
      style={{
        top: overlayTopCss(a.value <= b.value ? a : b),
        height: overlaySizeCss(a, b),
      }}
    />
  );

  return (
    <>
      {takeProfitTop != null
        ? zone(entryTop, takeProfitTop, "border-profit/25 bg-profit/10")
        : null}
      {stopTop != null
        ? zone(entryTop, stopTop, "border-loss/25 bg-loss/10")
        : null}
      <TradeLevelRail
        top={entryTop}
        tone="entry"
        label={overlay.status === "draft" ? "Draft entry" : overlay.status === "pending" ? "Working order" : "Entry"}
        value={entry}
        meta={overlay.quantity ? `${overlay.quantity} ${isLong ? "long" : "short"}` : overlay.status}
      />
      {stopTop != null && overlay.stopLoss != null ? (
        <TradeLevelRail top={stopTop} tone="stop" label="Stop" value={overlay.stopLoss} meta="risk floor" />
      ) : null}
      {takeProfitTop != null && overlay.takeProfit != null ? (
        <TradeLevelRail top={takeProfitTop} tone="target" label="Target" value={overlay.takeProfit} meta="take profit" />
      ) : null}
      {overlay.status === "draft" ? (
        <div className="pointer-events-auto absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-2 rounded border border-border-hair bg-bg-card/90 px-3 py-2 shadow-lg backdrop-blur-md sm:bottom-3 sm:left-1/2 sm:right-auto sm:max-w-[min(560px,calc(100%-6rem))] sm:-translate-x-1/2 sm:flex-nowrap">
          <div className="min-w-[160px] flex-1 sm:min-w-0">
            <p className="truncate font-mono text-label font-semibold text-fg">
              {overlay.label} · {formatBookPrice(entry)}
            </p>
            <p className="hidden truncate text-eyebrow text-fg-muted sm:block">
              {overlay.summary ?? "Chart draft updates the ticket; submit remains explicit."}
            </p>
          </div>
          {overlay.onCancel ? (
            <button
              type="button"
              onClick={overlay.onCancel}
              className="h-8 rounded border border-border-hair px-2.5 font-mono text-eyebrow text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          ) : null}
          {overlay.onSubmit ? (
            <button
              type="button"
              disabled={!overlay.canSubmit}
              onClick={overlay.onSubmit}
              className="h-8 rounded border border-primary bg-primary px-3 font-mono text-eyebrow font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              {overlay.submitLabel ?? "Place"}
            </button>
          ) : null}
        </div>
      ) : null}
      {overlay.error ? (
        <div
          className="absolute right-20 max-w-[260px] rounded border border-loss/30 bg-loss/10 px-2 py-1.5 text-eyebrow text-loss"
          style={{
            top:
              entryTop.unit === "px"
                ? `${Math.max(8, entryTop.value - 40)}px`
                : `${Math.max(2, entryTop.value - 5)}%`,
          }}
        >
          {overlay.error}
        </div>
      ) : null}
    </>
  );
}

function TradeLevelRail({
  top,
  tone,
  label,
  value,
  meta,
}: {
  top: OverlayTop;
  tone: "entry" | "stop" | "target";
  label: string;
  value: number;
  meta: string;
}) {
  return (
    <div className="absolute left-0 right-14" style={{ top: overlayTopCss(top) }}>
      <div
        className={cn(
          "absolute inset-x-0 top-0 border-t",
          tone === "entry" && "border-gold-300/80",
          tone === "stop" && "border-loss/80",
          tone === "target" && "border-profit/80",
        )}
      />
      <div
        className={cn(
          "absolute right-0 top-0 -translate-y-1/2 rounded border bg-bg-card/90 px-2 py-1 font-mono text-eyebrow shadow-sm backdrop-blur-md",
          tone === "entry" && "border-gold-300/40 text-gold-300",
          tone === "stop" && "border-loss/40 text-loss",
          tone === "target" && "border-profit/40 text-profit",
        )}
      >
        <span className="font-semibold">{label}</span>{" "}
        <span>{formatBookPrice(value)}</span>
        <span className="ml-1 text-fg-hint">{meta}</span>
      </div>
    </div>
  );
}

// ─── Top-of-book overlay ─────────────────────────────────────────────────────

function TopOfBookReadout({ book }: { book: NormalizedTopOfBook }) {
  const imbalanceLabel =
    book.imbalancePct == null
      ? "size unknown"
      : book.imbalancePct >= 56
        ? `bid heavy ${book.imbalancePct.toFixed(0)}%`
        : book.imbalancePct <= 44
          ? `ask heavy ${(100 - book.imbalancePct).toFixed(0)}%`
          : "balanced";
  return (
    <div className="flex flex-col gap-1 leading-tight">
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-label font-semibold uppercase tracking-[0.08em] text-[color:var(--fg)]">
          {book.isL2 ? `Depth ${book.depthLevels}` : "Top book"}
        </span>
        <span className="text-[color:var(--fg-hint)]">
          {book.isL2
            ? book.source
            : book.source === "quote_fallback"
              ? "quote fallback"
              : "NBBO quote only"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 tabular-nums">
        <div className="rounded border border-[color:var(--profit)]/30 bg-[color:var(--profit)]/10 px-1.5 py-1">
          <div className="text-[color:var(--profit)]">Bid</div>
          <div className="text-[color:var(--fg)]">{formatBookPrice(book.bid)}</div>
          <div className="text-[color:var(--fg-hint)]">
            x{formatBookSize(book.bidSize)}
            {book.bidExchange ? ` · ${book.bidExchange}` : ""}
          </div>
        </div>
        <div className="rounded border border-[color:var(--loss)]/30 bg-[color:var(--loss)]/10 px-1.5 py-1">
          <div className="text-[color:var(--loss)]">Ask</div>
          <div className="text-[color:var(--fg)]">{formatBookPrice(book.ask)}</div>
          <div className="text-[color:var(--fg-hint)]">
            x{formatBookSize(book.askSize)}
            {book.askExchange ? ` · ${book.askExchange}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[color:var(--fg-hint)] tabular-nums">
        <span>
          spread {formatBookPrice(book.spread)} · {book.spreadBps.toFixed(1)} bp
        </span>
        <span>{imbalanceLabel}</span>
      </div>
      {!book.isL2 && book.source === "quote_fallback" ? (
        <div className="text-[color:var(--fg-hint)]">
          depth unavailable · showing quote fallback
        </div>
      ) : !book.isL2 && book.source !== "quote" ? (
        <div className="text-[color:var(--fg-hint)]">
          source {book.source} · depth adapter ready
        </div>
      ) : null}
    </div>
  );
}

// ─── OHLC + indicator legend overlay ──────────────────────────────────────────

/**
 * Round-12 / CH-2 + CH-3: TradingView-style OHLC + indicator readout.
 * Renders top-left of the chart and shows:
 *
 *   - Open / High / Low / Close / Volume for the bar under the crosshair
 *     (or the latest bar if the crosshair isn't active).
 *   - Net change vs Open with a profit/loss tint so the user can read
 *     direction at a glance.
 *   - The active indicators with their PERIODS expanded — "SMA 20",
 *     "EMA 50" instead of bare "SMA"/"EMA". CH-3: ``TradingChart``
 *     hard-codes EMA(20)/EMA(50) and SMA(20)/SMA(50) when the user
 *     toggles those indicators on; this legend reflects those.
 */
function OHLCReadout({
  hover,
  lastBar,
  indicators,
}: {
  hover: { open: number; high: number; low: number; close: number; volume?: number } | null;
  lastBar: OHLCVBar | null;
  indicators: Indicator[];
}) {
  const bar = hover ?? (lastBar ? {
    open: lastBar.open,
    high: lastBar.high,
    low: lastBar.low,
    close: lastBar.close,
    volume: lastBar.volume,
  } : null);
  const changeAbs = bar ? bar.close - bar.open : 0;
  const changePct = bar && bar.open ? (changeAbs / bar.open) * 100 : 0;
  const changeTint =
    !bar ? "" : changeAbs >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]";
  // Compose the indicator legend with periods. TradingChart draws:
  //   EMA → EMA(20, amber) + EMA(50, blue)
  //   SMA → SMA(20, gold)  + SMA(50, fg-dim)
  //   VWAP, Bollinger, RSI, MACD: single instances; show plain.
  const indicatorLegend = indicators
    .filter((i) => i !== "Volume")
    .flatMap((i) => {
      if (i === "EMA") return ["EMA 20", "EMA 50"];
      if (i === "SMA") return ["SMA 20", "SMA 50"];
      if (i === "Bollinger") return ["Bollinger 20"];
      return [i];
    });
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      {bar ? (
        <>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="u-muted">O</span>
            <span>{bar.open.toFixed(2)}</span>
            <span className="u-muted">H</span>
            <span>{bar.high.toFixed(2)}</span>
            <span className="u-muted">L</span>
            <span>{bar.low.toFixed(2)}</span>
            <span className="u-muted">C</span>
            <span>{bar.close.toFixed(2)}</span>
            <span className={cn("ml-1", changeTint)}>
              {changeAbs >= 0 ? "+" : ""}
              {changeAbs.toFixed(2)} ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%)
            </span>
          </div>
          {bar.volume != null && (
            <div className="flex items-baseline gap-2 u-muted tabular-nums">
              <span>VOL</span>
              <span>{formatVolume(bar.volume)}</span>
            </div>
          )}
        </>
      ) : (
        <span className="u-muted">— no bar</span>
      )}
      {indicatorLegend.length > 0 && (
        <div className="flex items-baseline gap-2 u-muted text-label mt-0.5">
          {indicatorLegend.map((label) => (
            <span key={label} className="rounded border border-[color:var(--border)] px-1 py-px">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}
