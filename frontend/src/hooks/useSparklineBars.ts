"use client";

import { useQueries } from "@tanstack/react-query";

import { getBars } from "@/lib/api";

/**
 * useSparklineBars — Phase-2 / SP-1 (2026 design brief).
 *
 * Hook that fetches the closing-price series for a list of symbols
 * and returns a `Record<symbol, number[]>` ready to feed into
 * `<Sparkline data={…} />`. Used by PositionsList rows + Watchlist
 * rows so every list-page entry shows a 30-day micro-trend next to
 * the scalar number — Tufte's "show context, not scalars" rule.
 *
 * Implementation:
 *   - One react-query per symbol. The query key is `["bars", symbol, timeframe, limit]`
 *     so multiple consumers (positions + watchlist + KPIs) share the cache.
 *   - 5-minute stale time (overnight / cold-cache reuse).
 *   - 1 retry — falls back to an empty array on failure (Sparkline
 *     renders nothing rather than crashing).
 *
 * Usage:
 *
 *   const bars = useSparklineBars(["AAPL", "NVDA"]);
 *   const apple = bars["AAPL"];   // number[] of closes, oldest first
 */

export function useSparklineBars(
  symbols: string[],
  opts: { timeframe?: "D" | "1H" | "5m"; limit?: number } = {},
): Record<string, number[]> {
  const timeframe = opts.timeframe ?? "D";
  const limit = opts.limit ?? 30;
  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["bars-spark", symbol, timeframe, limit] as const,
      queryFn: async () => {
        const bars = await getBars(symbol, timeframe, limit);
        return bars.map((b) => b.close);
      },
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      // We render a Skeleton while loading and `null` on failure inside
      // the Sparkline component itself, so we don't need an error boundary here.
    })),
  });

  const out: Record<string, number[]> = {};
  symbols.forEach((sym, i) => {
    const q = queries[i];
    if (q?.data && q.data.length >= 2) {
      out[sym] = q.data;
    }
  });
  return out;
}
