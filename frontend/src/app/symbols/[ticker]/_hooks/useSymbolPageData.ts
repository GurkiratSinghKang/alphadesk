"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ApiError,
  getAnalysis,
  getBars,
  getEarningsDetail,
  getIVData,
  getRecommendedSetups,
  searchSymbols,
} from "@/lib/api";
import { useTickerContext } from "@/hooks/useQueries";
import type { Analysis, EarningsDetail, EarningsSetup, OHLCVBar, TimeFrame } from "@/types";

export type SymbolMeta = Awaited<ReturnType<typeof searchSymbols>>[number];

export type IVDataResult = Awaited<ReturnType<typeof getIVData>>;

const ETF_TYPES = ["ETF", "ETN", "ETV"] as const;
const CRYPTO_FOREX_TYPES = ["CRYPTO", "FX"] as const;

export interface UseSymbolPageDataResult {
  ctx: ReturnType<typeof useTickerContext>;
  analysis: Analysis | null;
  ivData: IVDataResult | null;
  bars: OHLCVBar[] | null;
  earningsDetail: EarningsDetail | null;
  recommendedSetups: EarningsSetup[] | null;
  symbolMeta: SymbolMeta | null;
  isLoading: boolean;
  isError: boolean;
  isETF: boolean;
  isCryptoForex: boolean;
  timeframe: TimeFrame;
  setTimeframe: (tf: TimeFrame) => void;
}

export function useSymbolPageData(sym: string): UseSymbolPageDataResult {
  const [timeframe, setTimeframe] = useState<TimeFrame>("D");

  const ctx = useTickerContext(
    [sym],
    ["quote", "options_summary", "earnings", "research", "news", "market_regime"],
  );

  const analysisQuery = useQuery<Analysis>({
    queryKey: ["analysis", sym],
    queryFn: () => getAnalysis(sym),
    staleTime: 5 * 60 * 1000,
    enabled: !!sym,
    retry: 1,
  });

  const ivQuery = useQuery<IVDataResult>({
    queryKey: ["iv", sym],
    queryFn: () => getIVData(sym),
    staleTime: 5 * 60 * 1000,
    enabled: !!sym,
    retry: 1,
  });

  const barsQuery = useQuery<OHLCVBar[]>({
    queryKey: ["bars", sym, timeframe],
    queryFn: () => getBars(sym, timeframe, 250),
    staleTime: 5 * 60 * 1000,
    enabled: !!sym,
    retry: 1,
  });

  const searchQuery = useQuery<SymbolMeta[]>({
    queryKey: ["symbolSearch", sym],
    queryFn: () => searchSymbols(sym, 1),
    staleTime: 60 * 60 * 1000,
    enabled: !!sym,
    retry: 1,
  });

  const symbolMeta =
    searchQuery.data && searchQuery.data.length > 0
      ? (searchQuery.data.find((r) => r.symbol.toUpperCase() === sym.toUpperCase()) ??
        searchQuery.data[0])
      : null;

  const isETF = symbolMeta != null && (ETF_TYPES as readonly string[]).includes(symbolMeta.type);
  const isCryptoForex =
    symbolMeta != null && (CRYPTO_FOREX_TYPES as readonly string[]).includes(symbolMeta.type);

  // T7 / D-05: cached-only mount of the earnings detail payload. The
  // /detail endpoint serves curated-universe symbols and 404s otherwise;
  // we treat 404 as "no curated thesis" rather than a hard error so the
  // band's analysis-summary fallback can render. ETFs are gated out
  // because the curated universe excludes them.
  //
  // T7 P1 #2: narrow the swallow to ApiError with status === 404. The
  // previous `.catch(() => null)` masked 5xx / network failures, leaving
  // the symbol page silently degraded with no telemetry signal. Now any
  // non-404 (5xx, network, RateLimitError, etc.) rethrows so React Query
  // surfaces it via `isError` and our error boundaries.
  //
  // Audit fix: don't gate on `symbolMeta != null`. The search index
  // doesn't always carry every valid ticker (BRK.B, recently-listed
  // names, dot-suffix symbols) and a missing entry shouldn't prevent
  // the curated-equity earnings/setups fetch. ETF/crypto-forex flags
  // both default to false when symbolMeta is null, which means we
  // assume equity and let the backend's 404 be the authoritative
  // "no curated detail" signal.
  const earningsEnabled = !!sym && !isETF && !isCryptoForex;
  const earningsQuery = useQuery<EarningsDetail | null>({
    queryKey: ["earnings-detail", sym],
    queryFn: () =>
      getEarningsDetail(sym).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }),
    staleTime: 5 * 60 * 1000,
    enabled: earningsEnabled,
    retry: false,
  });

  // T8 / Section 7: ranked top-3 recommended setups for the
  // RecommendedSetups card. Same curated-universe / asset-class gates as
  // /detail. 404 → null (no setups for this symbol); any other error
  // falls through and is excluded from the aggregate isError flag for
  // the same reason as earningsQuery: a missing recommender shouldn't
  // black out the whole symbol page.
  const setupsQuery = useQuery<EarningsSetup[] | null>({
    queryKey: ["earnings-setups", sym],
    queryFn: () =>
      getRecommendedSetups(sym).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }),
    staleTime: 5 * 60 * 1000,
    enabled: earningsEnabled,
    retry: false,
  });

  const isLoading =
    ctx.isLoading || analysisQuery.isLoading || ivQuery.isLoading || barsQuery.isLoading || searchQuery.isLoading;
  const isError =
    ctx.isError || analysisQuery.isError || ivQuery.isError || barsQuery.isError || searchQuery.isError;

  return {
    ctx,
    analysis: analysisQuery.data ?? null,
    ivData: ivQuery.data ?? null,
    bars: barsQuery.data ?? null,
    earningsDetail: earningsQuery.data ?? null,
    recommendedSetups: setupsQuery.data ?? null,
    symbolMeta,
    isLoading,
    isError,
    isETF,
    isCryptoForex,
    timeframe,
    setTimeframe,
  };
}
