"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAnalysis, getBars, getIVData, searchSymbols } from "@/lib/api";
import { useTickerContext } from "@/hooks/useQueries";
import type { Analysis, OHLCVBar, TimeFrame } from "@/types";

export type SymbolMeta = Awaited<ReturnType<typeof searchSymbols>>[number];

export type IVDataResult = Awaited<ReturnType<typeof getIVData>>;

const ETF_TYPES = ["ETF", "ETN", "ETV"] as const;
const CRYPTO_FOREX_TYPES = ["CRYPTO", "FX"] as const;

export interface UseSymbolPageDataResult {
  ctx: ReturnType<typeof useTickerContext>;
  analysis: Analysis | null;
  ivData: IVDataResult | null;
  bars: OHLCVBar[] | null;
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

  const isLoading =
    ctx.isLoading || analysisQuery.isLoading || ivQuery.isLoading || barsQuery.isLoading || searchQuery.isLoading;
  const isError =
    ctx.isError || analysisQuery.isError || ivQuery.isError || barsQuery.isError || searchQuery.isError;

  return {
    ctx,
    analysis: analysisQuery.data ?? null,
    ivData: ivQuery.data ?? null,
    bars: barsQuery.data ?? null,
    symbolMeta,
    isLoading,
    isError,
    isETF,
    isCryptoForex,
    timeframe,
    setTimeframe,
  };
}
