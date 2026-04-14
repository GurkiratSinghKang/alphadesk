"use client";

import { useQuery } from "@tanstack/react-query";
import { getMarketRegime, getMarketIndices, getStrategies, getPortfolioSummary, getPipelineStatus, getOptionsChain, getIVData, getPnlCalendar, getIndexSparklines } from "@/lib/api";

export function useRegime() {
  return useQuery({
    queryKey: ["regime"],
    queryFn: getMarketRegime,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useIndices() {
  return useQuery({
    queryKey: ["indices"],
    queryFn: getMarketIndices,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: getStrategies,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}

export function usePortfolioSummary() {
  return useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: getPortfolioSummary,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}

export function usePipelineStatus() {
  return useQuery({
    queryKey: ["pipelineStatus"],
    queryFn: getPipelineStatus,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}

export function useOptionsChain(symbol: string, expiration: string) {
  return useQuery({
    queryKey: ['optionsChain', symbol, expiration],
    queryFn: () => getOptionsChain(symbol, expiration),
    staleTime: 30 * 1000,
    enabled: !!symbol && !!expiration,
    retry: 1,
  });
}

export function useIVData(symbol: string) {
  return useQuery({
    queryKey: ['ivData', symbol],
    queryFn: () => getIVData(symbol),
    staleTime: 60 * 1000,
    enabled: !!symbol,
    retry: 1,
  });
}

export function usePnlCalendar(month: number, year: number) {
  return useQuery({
    queryKey: ['pnlCalendar', month, year],
    queryFn: () => getPnlCalendar(month, year),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useIndexSparklines() {
  return useQuery({
    queryKey: ['indexSparklines'],
    queryFn: getIndexSparklines,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });
}
