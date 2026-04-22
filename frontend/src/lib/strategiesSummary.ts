/**
 * strategiesSummary.ts
 * ────────────────────
 * BUG-009 fix — single aggregator for strategy bucket counts.
 *
 * Before: three callers (desk rail header "12/13", /strategies header
 * "12 active · 1 paused · 7 coming soon · 20 total", and /reports) each
 * derived their own counts and disagreed. Now all three call this one
 * helper so any drift is impossible.
 *
 * Input is the raw `/api/v1/strategies` list (as shaped by `getStrategies`
 * in lib/api). Output is the canonical bucket counts the UI displays.
 */
import { STRATEGY_META, metaStage, metaKind } from "@/lib/strategies";

export interface RawStrategySummary {
  id: string;
  status?: string;
}

export interface StrategiesCounts {
  active: number;
  paused: number;
  comingSoon: number;
  /** Active + paused (i.e. ids with a real backend implementation). */
  total: number;
  /** Active + paused + coming soon (everything the catalogue advertises). */
  catalogueTotal: number;
}

/**
 * Compute canonical bucket counts from the `/strategies` list response.
 *
 * Rules (mirror `/strategies` page + desk rail today):
 *   · "coming soon"  — STRATEGY_META entry with stage === "planned"
 *   · "active"       — stage !== "planned" AND api status === "active"
 *   · "paused"       — stage !== "planned" AND api status !== "active"
 *
 * Strategies the backend doesn't return yet are treated as paused — the
 * rail used to render them as paused rows with an em-dash, so this
 * preserves that behaviour.
 */
export function computeStrategyCounts(
  apiStrategies: RawStrategySummary[] | null | undefined
): StrategiesCounts {
  const byId = new Map((apiStrategies ?? []).map((s) => [s.id, s]));
  let active = 0;
  let paused = 0;
  let comingSoon = 0;
  for (const id of Object.keys(STRATEGY_META)) {
    // Research-kind entries are never autonomous strategies — skip them so
    // the active/paused/coming-soon counts don't include research tools.
    if (metaKind(id) === "research") continue;
    const stage = metaStage(id);
    if (stage === "planned") {
      comingSoon += 1;
      continue;
    }
    const api = byId.get(id);
    const status = (api?.status ?? "").toLowerCase();
    if (status === "active") active += 1;
    else paused += 1;
  }
  return {
    active,
    paused,
    comingSoon,
    total: active + paused,
    catalogueTotal: active + paused + comingSoon,
  };
}
