import * as React from "react";

import type { ApplicantRiskTier } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * RiskPill — auto-flagged applicant risk tier.
 *
 * Phase 1.6h primitive. Three tiers (low / med / high) with tone-coded
 * pill backgrounds. Used in ApplicantsTable + ApplicantDrawer.
 */
export interface RiskPillProps {
  tier: ApplicantRiskTier;
  className?: string;
}

const TIER_LABEL: Record<ApplicantRiskTier, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

const TIER_TONE: Record<ApplicantRiskTier, string> = {
  low: "bg-tint-up-1 border-profit/40 text-profit",
  med: "bg-tint-brand-1 border-state-warning/40 text-state-warning",
  high: "bg-tint-down-1 border-loss/40 text-loss",
};

export default function RiskPill({ tier, className }: RiskPillProps) {
  return (
    <span
      data-slot="risk-pill"
      data-tier={tier}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-pill border text-eyebrow font-semibold uppercase tracking-[0.08em]",
        TIER_TONE[tier],
        className,
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
