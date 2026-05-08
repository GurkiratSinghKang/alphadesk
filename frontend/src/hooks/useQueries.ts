"use client";

import { useQuery } from "@tanstack/react-query";
import { getMarketRegime, getMarketIndices, getMarketStatus, getStrategies, getPortfolioSummary, getPipelineStatus, getOptionsChain, getIVData, getPnlCalendar, getIndexSparklines, getMorningBrief, getTickerContext, getCurrentUser, getBrokerConnections } from "@/lib/api";
import type { ApiFetchOptions, MarketStatusResponse } from "@/lib/api";

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

/**
 * Holiday-aware market open/closed status. The backend
 * ``/api/v1/market/market-status`` endpoint proxies Polygon and Alpaca,
 * both of which honour the NYSE-observed US holiday schedule, so
 * ``data?.isOpen`` is correct on Independence Day, MLK Day, Thanksgiving,
 * Good Friday, Juneteenth, etc. — situations the local ``isMarketOpen()``
 * heuristic gets wrong.
 *
 * Callers should fall back to ``isMarketOpen()`` while ``isLoading`` is
 * true (first paint) and on a hook failure so the change is a strict
 * improvement on the prior heuristic — never a regression.
 *
 * The 60-second cadence covers the boundary transitions we actually care
 * about (open at 09:30 ET, close at 16:00 ET, ad-hoc closures). The
 * upstream providers themselves only update at minute-level granularity
 * for the open/closed flag.
 */
export function useMarketStatus() {
  return useQuery<MarketStatusResponse>({
    queryKey: ["market-status"],
    queryFn: getMarketStatus,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
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
    queryFn: () => getPnlCalendar(year, month),
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

export function useMorningBrief() {
  return useQuery({
    queryKey: ['morningBrief'],
    queryFn: getMorningBrief,
    staleTime: 30 * 60 * 1000, // 30 min — brief doesn't change often
    retry: 1,
  });
}

/**
 * Batch E (2026-05-05) — P0-05.
 *
 * The current user's profile (``GET /api/v1/user/me``). Used by the
 * dashboard to detect demo-seed accounts and surface a "Connect your
 * broker — your desk is showing demo data" CTA at the top of the
 * Action stack. Cached for the full session (no auto-refetch) — the
 * profile only changes on logout, which already invalidates the
 * QueryClient via ``cleanupAuthCookies``.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: getCurrentUser,
    // Profile is effectively immutable for the session. A 5-minute stale
    // window is a generous belt-and-braces against accidental refetches.
    staleTime: 5 * 60 * 1000,
    // No interval refetch — there's nothing on this endpoint that
    // changes mid-session that we need to react to in the desk.
    retry: 1,
  });
}

/**
 * Batch E (2026-05-05) — P1-21.
 *
 * Broker connections list — same source the Settings → Brokerage tab
 * uses. The StatusStrip's tri-state PAPER pill reads from this so the
 * pill state stays in lock-step with what Settings shows.
 */
export function useBrokerConnections() {
  return useQuery({
    queryKey: ["brokerConnections"],
    queryFn: getBrokerConnections,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useTickerContext(
  symbols: readonly string[],
  needs: readonly string[] = ["quote", "options_summary", "earnings", "research"],
  options: Pick<ApiFetchOptions, "suppressAuthRedirect" | "suppressGlobalError" | "timeoutMs"> = {},
) {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  );
  const normalizedNeeds = Array.from(new Set(needs.map((need) => need.trim()).filter(Boolean)));
  return useQuery({
    queryKey: ['tickerContext', normalizedSymbols, normalizedNeeds],
    queryFn: ({ signal }) => getTickerContext(normalizedSymbols, {
      needs: normalizedNeeds,
      onStale: "allow_with_warning",
      signal,
      suppressAuthRedirect: options.suppressAuthRedirect,
      suppressGlobalError: options.suppressGlobalError,
      timeoutMs: options.timeoutMs,
    }),
    staleTime: 30 * 1000,
    enabled: normalizedSymbols.length > 0,
    retry: 1,
  });
}
