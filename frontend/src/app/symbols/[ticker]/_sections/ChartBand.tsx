"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import PriceChartPanel from "@/components/composites/PriceChartPanel";
import type {
  ChartBar,
  ChartRange,
  MarketSymbol,
  MetaCells,
  Quote as CompositeQuote,
} from "@/components/composites/types";
import { barsRequestForRange } from "@/lib/chartRange";
import { getBars } from "@/lib/api";
import type { OHLCVBar } from "@/types";

import { KeyStats } from "./KeyStats";
import type { StickyBandQuote } from "./StickyBand";

const DEFAULT_RANGE: ChartRange = "1M";

/** Bars to fetch per "load more older history" page. */
const HISTORY_PAGE_SIZE = 500;
const PUBLIC_SYMBOL_DATA_OPTIONS = {
  suppressAuthRedirect: true,
  suppressGlobalError: true,
} as const;

export interface ChartBandProps {
  symbol: string;
  /** Initial bars from the page-level data hook (timeframe="D"). The chart
   *  range chips drive their own re-fetch keyed on `[symbol, range]`. */
  bars: OHLCVBar[] | null;
  /** Optional display name for the chart hero ("Apple Inc." vs the ticker). */
  name?: string | null;
  /** Optional quote — drives the chart hero price + meta range cell. */
  quote?: StickyBandQuote | null;
  /** Preview mode uses locally generated public bars when protected data is unavailable. */
  dataMode?: "live" | "preview";
}

function toMarketSymbol(symbol: string, name?: string | null): MarketSymbol {
  return {
    ticker: symbol,
    name: name && name.trim().length > 0 ? name : symbol,
    venue: "",
  };
}

function toCompositeQuote(quote: StickyBandQuote | null | undefined): CompositeQuote {
  // NaN is the "no data" sentinel — PriceChartPanel.numberOrNull() filters it
  // out and renders the dash glyph. Using 0 worked by accident (zero is also
  // treated as no-data) but NaN is semantically explicit and won't render
  // "$0.00" if a downstream consumer ever stops special-casing zero.
  if (!quote) return { last: NaN, change: 0, changePct: 0 };
  return {
    last: quote.last,
    change: quote.change ?? 0,
    changePct: quote.changePct ?? 0,
    timestamp: quote.timestamp,
    extended_price: quote.extended_price ?? null,
    extended_change: quote.extended_change ?? null,
    extended_change_pct: quote.extended_change_pct ?? null,
    extended_session: quote.extended_session ?? null,
    last_trade_time: quote.last_trade_time ?? null,
    session: quote.session ?? null,
  };
}

function toMetaCells(quote: StickyBandQuote | null | undefined): MetaCells {
  const dash = "—";
  const high = typeof quote?.high === "number" && Number.isFinite(quote.high) ? quote.high : null;
  const low = typeof quote?.low === "number" && Number.isFinite(quote.low) ? quote.low : null;
  const range = high != null && low != null ? `${low.toFixed(2)} ${dash} ${high.toFixed(2)}` : dash;
  const volume =
    typeof quote?.volume === "number" && Number.isFinite(quote.volume) && quote.volume > 0
      ? compact(quote.volume)
      : dash;
  return {
    volume,
    avgVolume: dash,
    range,
    iv: dash,
    regimeFit: 0,
  };
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function ChartBand({ symbol, bars, name, quote, dataMode = "live" }: ChartBandProps) {
  const [range, setRange] = useState<ChartRange>(DEFAULT_RANGE);
  const isPreview = dataMode === "preview";

  // Range chips drive a fresh fetch (timeframe + limit derived from range).
  // The page hook's `bars` prop seeds the panel for first paint while the
  // user-selected range request is in flight. We always fetch the
  // range-specific bars — never gate on `range === DEFAULT_RANGE` because
  // the page hook's seed is hard-coded to (D, 250) and won't match the
  // default range's timeframe/limit, which would silently mislabel the
  // displayed bars (e.g. daily seed shown under a "1M" chip that maps to 1H).
  const { timeframe, limit } = barsRequestForRange(range);
  const rangeQuery = useQuery<OHLCVBar[]>({
    queryKey: ["bars", symbol, range, timeframe, limit],
    queryFn: () => getBars(symbol, timeframe, limit, PUBLIC_SYMBOL_DATA_OPTIONS),
    enabled: !!symbol && !isPreview,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Older bars fetched after the user pans past the leftmost loaded bar.
  // Stored separately so React Query's range fetch isn't affected. Reset
  // whenever the symbol or the (range-derived) timeframe changes — older
  // hourly bars don't merge cleanly into a daily-bar request.
  const [olderBars, setOlderBars] = useState<OHLCVBar[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  // Track the (symbol, timeframe) the older-bars cache belongs to so we
  // know when to drop it. Strings keep the comparison cheap.
  const olderBarsKeyRef = useRef<string>("");
  const currentKey = `${symbol}|${timeframe}`;

  useEffect(() => {
    if (olderBarsKeyRef.current !== currentKey) {
      olderBarsKeyRef.current = currentKey;
      setOlderBars([]);
      setExhausted(false);
    }
  }, [currentKey]);

  // Merge older bars (paginated history) with the latest range query result.
  // Dedupe by `time` so re-fetches from the React Query cache or overlapping
  // pages don't render duplicate candles.
  const mergedBars: ChartBar[] = useMemo(() => {
    const latest = (rangeQuery.data ?? bars ?? []) as OHLCVBar[];
    if (olderBars.length === 0) return latest as ChartBar[];
    const seen = new Set<number>();
    const out: OHLCVBar[] = [];
    for (const bar of [...olderBars, ...latest]) {
      if (seen.has(bar.time)) continue;
      seen.add(bar.time);
      out.push(bar);
    }
    out.sort((a, b) => a.time - b.time);
    return out as ChartBar[];
  }, [olderBars, rangeQuery.data, bars]);

  const handleLoadMoreHistory = useCallback(async () => {
    if (loadingMore || exhausted || mergedBars.length === 0) return;
    const earliest = mergedBars[0];
    if (!earliest) return;

    // Backend `end` is a YYYY-MM-DD date and is inclusive — pass the day
    // before the earliest loaded bar to avoid re-fetching the same day's
    // candles. For intraday timeframes this still leaves room for the
    // server's per-day cap so we get a full page.
    const earliestDate = new Date(earliest.time * 1000);
    const endDate = new Date(earliestDate.getTime() - 24 * 60 * 60 * 1000);
    const isoEnd = endDate.toISOString().slice(0, 10);

    setLoadingMore(true);
    try {
      const olderPage = await getBars(symbol, timeframe, HISTORY_PAGE_SIZE, {
        ...PUBLIC_SYMBOL_DATA_OPTIONS,
        end: isoEnd,
      });
      // Filter any bars that overlap the already-loaded range — defensive
      // since some providers return inclusive `end` despite our offset.
      const fresh = olderPage.filter((b) => b.time < earliest.time);
      if (fresh.length === 0) {
        setExhausted(true);
        return;
      }
      setOlderBars((prev) => [...fresh, ...prev]);
    } catch {
      // Swallow — if the backend errors, we just stop trying. Showing a
      // toast would be noisy for a panning gesture; silent stop matches
      // TradingView/Webull behavior.
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, exhausted, mergedBars, symbol, timeframe]);

  return (
    <section
      id="chart"
      data-testid="chart-band"
      data-slot="chart-band"
      // 2026-05-07: chart was previously squeezed into 8/12 columns and
      // capped to 220-420px tall. The hero of a research page should be
      // the chart itself — let it span the full width and slot KeyStats
      // beneath as a horizontal stat strip on desktop.
      className="flex flex-col gap-4 px-4 py-6 scroll-mt-24 sm:px-6"
    >
      <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden">
        <PriceChartPanel
          symbol={toMarketSymbol(symbol, name)}
          quote={toCompositeQuote(quote)}
          meta={toMetaCells(quote)}
          series={mergedBars}
          activeRange={range}
          onRangeChange={setRange}
          isLoading={!isPreview && rangeQuery.isLoading}
          error={!isPreview && rangeQuery.isError}
          onRetry={() => rangeQuery.refetch()}
          onLoadMoreHistory={isPreview ? undefined : handleLoadMoreHistory}
          loadingMoreHistory={isPreview ? false : loadingMore}
          enableMarketDepth={!isPreview}
          marketDepthOptions={PUBLIC_SYMBOL_DATA_OPTIONS}
        />
      </div>
      <KeyStats symbol={symbol} />
    </section>
  );
}

export default ChartBand;
