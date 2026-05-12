"use client";

/**
 * HeroChartWired
 * ──────────────
 * Replaces the design's hand-rolled SVG `HeroChart` with the real
 * lightweight-charts engine (`ChartPane`) so the Trade + Symbol pages
 * render live OHLCV bars instead of a synthetic sin/cos noise series.
 *
 * What we keep from the design:
 *   • Editorial gold/dark frame (border + radius + ink-100 fill)
 *   • Range chips → timeframe mapping (1D/5D/1M/3M/6M/YTD/1Y/ALL)
 *   • The mock `t.chart` array stays as a synchronous fallback so the
 *     surface paints something while React Query resolves.
 *
 * What this restores:
 *   • Indicator math (SMA/EMA/BB/RSI/MACD/VWAP/Anchored VWAP/ATR/Stochastic)
 *   • Drawing plugin (Series Primitives canvas, high-DPI bitmap scaling)
 *   • One-time fitContent gate (preservation invariant #3)
 *   • Comparison series overlay with percent-rebasing
 *   • Event markers (E/D/F/S badges with shape+position semantics)
 *   • Token-driven palette (`--chart-line` etc.)
 *   • Real-time tick consumption from the WebSocket provider
 *
 * Why a wrapper instead of replacing in-place:
 *   `AlphaDeskDesign.tsx` is `// @ts-nocheck` and 10k+ lines. Surgical
 *   replacement keeps the file's invariants intact and lets the chart
 *   engine ship its own hooks (preferences store, drawing template,
 *   etc.) without leaking those types into the design mock.
 */

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { getBars } from "@/lib/api";
import type { ChartType, Indicator, OHLCVBar, TimeFrame } from "@/types";
import type {
  ChartOrderPlacement,
  ChartTradeOverlay,
} from "@/components/charts/ChartPane";

// Dynamic-import ChartPane: lightweight-charts touches `window` at
// module-evaluation time (canvas init), so SSR would crash. The
// route-level page is already client-only, but ChartPane's helpers
// (drawing-plugin, indicator math) read DPR + cssVar at import time.
const ChartPane = dynamic(() => import("@/components/charts/ChartPane"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--ink-100)",
      }}
    />
  ),
});

/**
 * Map the design's range chip to a (timeframe, limit) pair the
 * /api/v1/market/bars endpoint understands. The limits are tuned to
 * give roughly the same visible-bar density the design's static
 * 80-point series produces.
 */
// 2026-05-11 (round 23): bumped 1Y / ALL caps so the chart actually
// paints multi-year history. 1Y now fetches a full trading year of
// daily bars; ALL fetches ~20 years of weekly bars. The mock backend
// honors `?limit=` (see handlers.ts) so visual QA shows the same
// horizontal scroll the production chart would.
const RANGE_TO_FETCH: Record<string, { timeframe: TimeFrame; limit: number }> = {
  "1D": { timeframe: "1m", limit: 390 }, // one regular session
  "5D": { timeframe: "15m", limit: 130 }, // ~5 sessions × 26 bars
  "1M": { timeframe: "1H", limit: 168 }, // ~21 sessions × 8 bars
  "3M": { timeframe: "1H", limit: 504 }, // ~63 sessions × 8 bars
  "6M": { timeframe: "D", limit: 130 },
  YTD: { timeframe: "D", limit: 260 },
  "1Y": { timeframe: "D", limit: 504 }, // 2y of daily for scroll-back headroom
  ALL: { timeframe: "W", limit: 2000 }, // ~38y of weekly bars
};

export interface HeroChartWiredProps {
  /** Symbol to fetch bars for. Falls back to "SPY" if unset. */
  symbol?: string;
  /** Range chip from the design's chart toolbar. */
  range?: string;
  /** Chart mode owned by the surrounding design toolbar. */
  chartType?: ChartType;
  /** Indicators selected in the surrounding design toolbar's Indicators
   *  dropdown. When provided, ChartPane renders this exact list and does
   *  not persist its own. */
  indicators?: Indicator[];
  /** Live position + staged-order overlays to render directly on the
   *  chart (entry / stop / take-profit horizontal lines). */
  tradeOverlays?: ChartTradeOverlay[];
  /** Click-to-stage configuration. When enabled, clicking a price level
   *  on the chart drops a draft order at that price via `onStagePrice`. */
  chartOrderPlacement?: ChartOrderPlacement | null;
}

export default function HeroChartWired({
  symbol,
  range = "3M",
  chartType = "candle",
  indicators,
  tradeOverlays,
  chartOrderPlacement,
}: HeroChartWiredProps) {
  const sym = (symbol || "SPY").toUpperCase();
  const { timeframe, limit } = RANGE_TO_FETCH[range] ?? RANGE_TO_FETCH["3M"];

  // Per-(symbol, timeframe) extension cap so scroll-back paginates in
  // chunks instead of fetching every historical bar up front.
  const [extension, setExtension] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    // Reset when the symbol or range flips — older extensions don't
    // apply to a fresh timeframe.
    setExtension(0);
  }, [sym, timeframe]);

  const effectiveLimit = Math.min(limit + extension, 5000);

  const { data, isLoading, isError, refetch } = useQuery({
    // Include effectiveLimit so growing the window triggers a fetch.
    queryKey: ["design-hero-bars", sym, timeframe, effectiveLimit],
    queryFn: ({ signal }) =>
      getBars(sym, timeframe, effectiveLimit, {
        signal,
        // Failures should NOT trigger the global ApiDegradedBanner:
        // the chart already renders an inline retry CTA via ChartPane,
        // and the design surface fallback paints a quiet "—" state.
        suppressGlobalError: true,
      }),
    // 2026-04-20 audit: stale-time matches PriceChartPanel so a
    // dashboard-to-symbol-page navigation reuses the cache.
    staleTime: 30_000,
    // 5 min: long enough that range-flips within a hover stay warm.
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!loadingMore) return;
    if (!isLoading) setLoadingMore(false);
  }, [isLoading, loadingMore]);

  // Memoise so React Query's referentially-stable empty array doesn't
  // produce a fresh `[]` on every render.
  const bars: OHLCVBar[] = useMemo(() => data ?? [], [data]);

  const handleLoadMore = useMemo(() => {
    return () => {
      if (loadingMore) return;
      // Pull another bucket of bars (clamped at 5000 server-side).
      const next = Math.min(effectiveLimit + Math.max(limit, 250), 5000);
      if (next === effectiveLimit) return;
      setLoadingMore(true);
      setExtension(next - limit);
    };
  }, [loadingMore, effectiveLimit, limit]);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "var(--ink-100)",
        border: "1px solid var(--border)",
        borderRadius: 4,
      }}
      data-design-chart-hero={sym}
    >
      <ChartPane
        data={bars}
        chartType={chartType}
        showToolbar={false}
        indicators={indicators}
        tradeOverlays={tradeOverlays}
        chartOrderPlacement={chartOrderPlacement}
        isLoading={isLoading}
        loadingMoreHistory={loadingMore}
        onLoadMoreHistory={handleLoadMore}
        error={isError}
        onRetry={() => {
          void refetch();
        }}
      />
    </div>
  );
}
