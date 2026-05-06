import { useQuery } from "@tanstack/react-query";
import { getContractSnapshot } from "@/lib/api";

/**
 * Project Maverick (PM-C): per-contract NBBO snapshot poll. Used by the
 * row-expand NBBO panel under StrikeLadder rows.
 *
 * Polling cadence (2s) is aggressive on purpose — the NBBO panel is only
 * mounted while a row is expanded, so the request volume is naturally
 * gated by user interaction. ``staleTime`` (1.5s) sits just below the
 * refetch interval so a remount during a poll cycle won't re-issue the
 * request, and ``gcTime`` (10s) keeps the last value warm for a quick
 * reopen of the same contract.
 *
 * ``occSymbol = null`` disables the query — callers pass null when the
 * underlying isn't available (graceful degrade in StrikeLadder), and the
 * hook obediently returns ``data: undefined`` without fetching.
 */
export function useContractSnapshot(occSymbol: string | null) {
  return useQuery({
    queryKey: ["contract-snapshot", occSymbol],
    queryFn: () => getContractSnapshot(occSymbol!),
    enabled: !!occSymbol,
    refetchInterval: 2_000,
    staleTime: 1_500,
    gcTime: 10_000,
    retry: 1,
  });
}
