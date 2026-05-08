"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { MOCK_AGENTS, type Agent } from "@/lib/mocks";

/**
 * useAgents
 * ──────────
 * v2 redesign — read access for the agent roster. Phase 0 returns
 * the static MOCK_AGENTS fixture; Phase 1.6 swaps the queryFn for
 * the real `GET /api/v1/agents/list` once backend B.2 lands.
 *
 * Phase 0 sets `staleTime: Infinity` so the mock never refetches —
 * production tuning lives in `useQueries.ts`. Consumers should treat
 * this hook as the canonical agent feed source.
 */
export function useAgents(): UseQueryResult<Agent[]> {
  return useQuery({
    queryKey: ["agents", "list"] as const,
    queryFn: async () => MOCK_AGENTS,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Helper for filtering agents by archetype — used by Strategy
 * Playbook's per-stage agent assignments and the Symbol "Agents
 * on this name" tab.
 */
export function useAgentsByArchetype(
  archetype: Agent["archetype"],
): UseQueryResult<Agent[]> {
  return useQuery({
    queryKey: ["agents", "by-archetype", archetype] as const,
    queryFn: async () =>
      MOCK_AGENTS.filter((a) => a.archetype === archetype),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
