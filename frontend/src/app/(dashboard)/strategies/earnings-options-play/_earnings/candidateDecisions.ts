import type { CalendarRow, EarningsCandidateDecision } from "@/types";
import { safeGetItem } from "@/lib/storage";

export type CandidateDecisionMap = Partial<Record<string, EarningsCandidateDecision>>;

export type CandidateDecisionCounts = {
  saved: number;
  discarded: number;
  order: number;
  total: number;
};

export const CANDIDATE_DECISIONS_KEY = "alphadesk:earnings-candidate-decisions:v1";

const CANDIDATE_DECISION_VALUES = new Set(["saved", "discarded", "order"]);

export function countVisibleCandidateDecisions(
  rows: Pick<CalendarRow, "symbol" | "reportDate">[],
  candidateDecisions: CandidateDecisionMap,
): CandidateDecisionCounts {
  const counts: CandidateDecisionCounts = { saved: 0, discarded: 0, order: 0, total: 0 };
  for (const row of rows) {
    const decision = candidateDecisions[candidateDecisionKey(row.symbol, row.reportDate)] ?? null;
    if (!decision) continue;
    counts[decision] += 1;
    counts.total += 1;
  }
  return counts;
}

export function readCandidateDecisions(): CandidateDecisionMap {
  if (typeof window === "undefined") return {};
  const raw = safeGetItem(CANDIDATE_DECISIONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: CandidateDecisionMap = {};
    for (const [rawKey, decision] of Object.entries(parsed)) {
      const key = normalizeCandidateDecisionKey(rawKey);
      if (
        key &&
        typeof decision === "string" &&
        CANDIDATE_DECISION_VALUES.has(decision)
      ) {
        out[key] = decision as EarningsCandidateDecision;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function candidateDecisionKey(symbol: string, reportDate: string | null | undefined): string {
  const normalized = symbol.trim().toUpperCase();
  return reportDate && /^\d{4}-\d{2}-\d{2}$/.test(reportDate)
    ? `${normalized}@${reportDate}`
    : normalized;
}

function normalizeCandidateDecisionKey(rawKey: string): string | null {
  if (typeof rawKey !== "string") return null;
  const [symbol, reportDate, ...rest] = rawKey.split("@");
  if (rest.length > 0) return null;
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z]{1,6}(\.[A-Z])?$/.test(normalized)) return null;
  if (reportDate === undefined) return normalized;
  return /^\d{4}-\d{2}-\d{2}$/.test(reportDate)
    ? `${normalized}@${reportDate}`
    : null;
}
