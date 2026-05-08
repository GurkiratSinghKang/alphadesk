"use client";

import { useQuery } from "@tanstack/react-query";

import { getMarketDepth } from "@/lib/api";
import type { ApiFetchOptions } from "@/lib/api";
import type { MarketDepthSnapshot } from "@/types";

interface QuoteLike {
  bid?: number | null;
  ask?: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  bidExchange?: string | null;
  askExchange?: string | null;
  timestamp?: number | null;
}

type MarketDepthFetchOptions = Pick<
  ApiFetchOptions,
  "signal" | "suppressAuthRedirect" | "suppressGlobalError" | "timeoutMs"
>;

function quoteToDepth(symbol: string, quote: QuoteLike | null | undefined): MarketDepthSnapshot | null {
  const bid = typeof quote?.bid === "number" && Number.isFinite(quote.bid) ? quote.bid : null;
  const ask = typeof quote?.ask === "number" && Number.isFinite(quote.ask) ? quote.ask : null;
  if (bid == null || ask == null || bid <= 0 || ask <= 0) {
    return null;
  }
  return {
    symbol: symbol.toUpperCase(),
    kind: "top_of_book",
    provider: "quote_fallback",
    bids: [{ price: bid, size: quote?.bidSize ?? 0, venue: quote?.bidExchange ?? null }],
    asks: [{ price: ask, size: quote?.askSize ?? 0, venue: quote?.askExchange ?? null }],
    timestamp: quote?.timestamp ?? 0,
    isL2: false,
    isDemo: false,
    notes: ["Quote fallback; depth endpoint unavailable or not yet populated. Not full Level II depth."],
  };
}

export function useMarketDepth(
  symbol: string,
  quoteFallback?: QuoteLike | null,
  // Audit F-F8 (2026-05-05): callers that don't actually render depth
  // (most of the trade page outside the order-book panel) were polling
  // the L2 endpoint every 5s anyway. Add an opt-in ``enabled`` arg so
  // a parent that hides the depth UI can short-circuit the fetch.
  // Default true preserves the legacy behaviour for any caller that
  // hasn't migrated yet.
  enabled: boolean = true,
  options: MarketDepthFetchOptions = {},
): MarketDepthSnapshot | null {
  const fallback = quoteToDepth(symbol, quoteFallback);
  const query = useQuery({
    queryKey: ["market-depth", symbol.toUpperCase()],
    queryFn: () => getMarketDepth(symbol, 10, options),
    enabled: enabled && Boolean(symbol),
    staleTime: 2_000,
    gcTime: 30_000,
    // Pause the 5s poll when the UI doesn't render depth.
    refetchInterval: enabled ? 5_000 : false,
    retry: 1,
  });

  return query.data ?? fallback;
}
