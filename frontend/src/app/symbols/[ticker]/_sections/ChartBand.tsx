"use client";

import { useState } from "react";
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

export interface ChartBandProps {
  symbol: string;
  /** Initial bars from the page-level data hook (timeframe="D"). The chart
   *  range chips drive their own re-fetch keyed on `[symbol, range]`. */
  bars: OHLCVBar[] | null;
  /** Optional display name for the chart hero ("Apple Inc." vs the ticker). */
  name?: string | null;
  /** Optional quote — drives the chart hero price + meta range cell. */
  quote?: StickyBandQuote | null;
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

export function ChartBand({ symbol, bars, name, quote }: ChartBandProps) {
  const [range, setRange] = useState<ChartRange>(DEFAULT_RANGE);

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
    queryFn: () => getBars(symbol, timeframe, limit),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const series: ChartBar[] = (rangeQuery.data ?? bars ?? []) as ChartBar[];

  return (
    <section
      id="chart"
      data-testid="chart-band"
      data-slot="chart-band"
      className="grid grid-cols-1 gap-4 px-4 py-6 scroll-mt-24 sm:px-6 xl:grid-cols-12"
    >
      <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden xl:col-span-8">
        <PriceChartPanel
          symbol={toMarketSymbol(symbol, name)}
          quote={toCompositeQuote(quote)}
          meta={toMetaCells(quote)}
          series={series}
          activeRange={range}
          onRangeChange={setRange}
          isLoading={rangeQuery.isLoading}
          error={rangeQuery.isError}
          onRetry={() => rangeQuery.refetch()}
        />
      </div>
      <div className="xl:col-span-4">
        <KeyStats symbol={symbol} />
      </div>
    </section>
  );
}

export default ChartBand;
