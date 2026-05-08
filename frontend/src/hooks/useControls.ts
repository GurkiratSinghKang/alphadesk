"use client";

import * as React from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  MOCK_CONTROLS,
  type ControlCategory,
  type ControlSpec,
} from "@/lib/mocks";

/**
 * useControls
 * ────────────
 * v2 redesign — read access for the Admin Control Center registry.
 * Phase 0 returns the static MOCK_CONTROLS fixture; Phase 1.6 swaps
 * the queryFn for the real `GET /api/v1/admin/runtime-controls`
 * once backend B.6 / B.8 land.
 *
 * Optional `category` filter narrows the result without re-querying;
 * use it for sub-sections of the Admin page or for Settings (which
 * filters by `scope === "user"` once the user-scope tag lands).
 *
 * Selectors are memoized so consumers re-rendering on unrelated state
 * don't trigger filter pass.
 */
export interface UseControlsOptions {
  category?: ControlCategory;
  /** Optional fuzzy-search query — matches name + desc + envVar. */
  query?: string;
}

export function useControls(
  opts: UseControlsOptions = {},
): UseQueryResult<ControlSpec[]> {
  const { category, query } = opts;
  const normalisedQuery = query?.trim().toLowerCase();

  return useQuery({
    queryKey: ["controls", "list", category ?? null, normalisedQuery ?? null] as const,
    queryFn: async () => MOCK_CONTROLS,
    staleTime: Infinity,
    gcTime: Infinity,
    select: React.useCallback(
      (data: ControlSpec[]) => {
        let filtered = data;
        if (category) {
          filtered = filtered.filter((c) => c.category === category);
        }
        if (normalisedQuery) {
          filtered = filtered.filter((c) => {
            const haystack = `${c.name} ${c.desc} ${c.envVar ?? ""}`.toLowerCase();
            return haystack.includes(normalisedQuery);
          });
        }
        return filtered;
      },
      [category, normalisedQuery],
    ),
  });
}

/**
 * Critical-count helper — used by Admin master-map header for the
 * "1 critical / 2 watch / 0 deep" pill.
 */
export function useControlCounts(): {
  total: number;
  critical: number;
  byCategory: Record<string, number>;
} {
  const counts = React.useMemo(() => {
    const byCategory: Record<string, number> = {};
    let critical = 0;
    for (const c of MOCK_CONTROLS) {
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
      if (c.critical) critical += 1;
    }
    return { total: MOCK_CONTROLS.length, critical, byCategory };
  }, []);
  return counts;
}
