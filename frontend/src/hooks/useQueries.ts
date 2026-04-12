"use client";

import { useQuery } from "@tanstack/react-query";
import { getMarketRegime, getMarketIndices, getStrategies, getPortfolioSummary, getPipelineStatus } from "@/lib/api";

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
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
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
