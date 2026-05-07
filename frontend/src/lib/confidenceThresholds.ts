/**
 * Shared confidence-threshold constants for earnings discipline gates.
 *
 * These cutoffs are referenced by:
 *   · EOP TradeButtonRow's per-setup ConfidenceChip
 *   · EOP DecisionStrip's verdict-pill tone
 *   · symbols-page RecommendedSetups (chip + warning modal)
 *   · symbols-page DecisionStrip
 *
 * Keeping the constants in one module guarantees the chip tone, pill
 * tone, and warning-modal threshold all agree across surfaces. If the
 * recommender's internal cutoffs change, update them here and every
 * consumer picks up the new boundary in lockstep.
 */
import type { EarningsTopSetup } from "@/types";

/** ≥ 0.65 → brand tone (high conviction). */
export const HIGH_CONFIDENCE_THRESHOLD = 0.65;

/** [0.40, 0.65) → muted tone (mid conviction). */
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.40;

/**
 * < 0.50 on a directional setup → trigger LowConfidenceWarningModal.
 * Iron condor / iron butterfly / long straddle (vol-selling, non-
 * directional) deliberately bypass this gate.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.50;

/**
 * Mirrors backend ``_BULL_SETUPS ∪ _BEAR_SETUPS`` in
 * ``earnings_recommender.py``. Iron condor / long straddle / etc. are
 * deliberately ABSENT — those harvest IV crush regardless of direction
 * and shouldn't carry friction.
 */
export const DIRECTIONAL_SETUPS: ReadonlySet<EarningsTopSetup> = new Set<EarningsTopSetup>([
  "long call",
  "long put",
  "bull put spread",
  "bear call spread",
  "bull call spread",
  "bear put spread",
]);

/**
 * Returns ``true`` when a directional setup's confidence falls below
 * the warning threshold. Non-directional setups, missing/non-finite
 * confidence, and unknown setup kinds all return ``false`` (no
 * friction). Pure helper — no side effects, safe to call on every
 * click.
 */
export function isLowConfDirectional(
  setupKind: EarningsTopSetup | string | null | undefined,
  confidence: number | null | undefined,
): boolean {
  if (typeof setupKind !== "string") return false;
  if (!DIRECTIONAL_SETUPS.has(setupKind as EarningsTopSetup)) return false;
  if (confidence == null || !Number.isFinite(confidence)) return false;
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}
