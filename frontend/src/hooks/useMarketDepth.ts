"use client";

import { useQuery } from "@tanstack/react-query";

import { getMarketDepth } from "@/lib/api";
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
): MarketDepthSnapshot | null {
  const fallback = quoteToDepth(symbol, quoteFallback);
  const query = useQuery({
    queryKey: ["market-depth", symbol.toUpperCase()],
    queryFn: () => getMarketDepth(symbol, 10),
    enabled: Boolean(symbol),
    staleTime: 2_000,
    gcTime: 30_000,
    refetchInterval: 5_000,
    retry: 1,
  });

  return query.data ?? fallback;
}
