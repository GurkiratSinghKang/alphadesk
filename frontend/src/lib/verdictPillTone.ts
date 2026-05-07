/**
 * PR-1 / T5: 3-bucket tone-mapping for the verdict pill.
 *
 * Mirrors the per-setup credibility-chip cutoffs in
 * ``ConfidenceChip`` so the page-level verdict tone and the per-button
 * chip tone agree. Same module is consumed by both EOP DecisionStrip
 * and the symbols-page DecisionStrip — identical confidence bucket
 * means a 30% conviction reads "warn" on every surface.
 */
import {
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from "./confidenceThresholds";

/**
 * Returns a className string suitable for a verdict pill border + text
 * tone given a confidence in [0, 1].
 *
 *   ≥ 0.65 → brand
 *   0.40 – 0.65 → muted
 *   < 0.40 → warn
 */
export function verdictPillToneClass(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return "border border-[color:var(--brand)] u-brand";
  }
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return "border border-[color:var(--border)] u-muted";
  }
  return "border border-state-warning-border text-state-warning-fg";
}
