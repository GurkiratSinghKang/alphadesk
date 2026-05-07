"use client";

import { cn } from "@/lib/utils";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from "@/lib/confidenceThresholds";

/**
 * PR-1 / T3 (earnings discipline gates): tone-mapped per-setup
 * credibility chip. Score blends PoP × vol_premium_score × Claude
 * confidence × direction alignment on the backend (see
 * ``EarningsRecommender._compute_setup_confidence``); this surface is
 * the per-trade credibility readout the user inspects before clicking.
 *
 * Tone buckets mirror the recommender's internal "high / medium / low"
 * cutoffs:
 *   ≥ 0.65 → brand (high conviction)
 *   0.40 – 0.65 → muted (mid conviction)
 *   < 0.40 → warn (low conviction; reconsider before trading)
 *
 * Null/undefined/non-finite hides the chip (back-compat: old payloads
 * without the field, ``skip`` setups with no PoP).
 *
 * Shared between EOP TradeButtonRow and the symbols-page
 * RecommendedSetups so both surfaces show identical chips for the
 * same trade.
 */
export interface ConfidenceChipProps {
  confidence: number | null | undefined;
  /** Optional className passthrough for layout tweaks (e.g. spacing). */
  className?: string;
}

export default function ConfidenceChip({ confidence, className }: ConfidenceChipProps) {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  const pct = Math.round(confidence * 100);
  const tone =
    confidence >= HIGH_CONFIDENCE_THRESHOLD
      ? "u-brand"
      : confidence >= MEDIUM_CONFIDENCE_THRESHOLD
        ? "u-muted"
        : "text-state-warning-fg";
  return (
    <span data-slot="confidence-chip" className={cn("t-meta tabular-nums", tone, className)}>
      {pct}% conf
    </span>
  );
}
