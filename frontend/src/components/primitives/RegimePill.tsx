import * as React from "react";

import { cn } from "@/lib/utils";
import StatusDot, { type StatusDotTone } from "./StatusDot";

/**
 * RegimePill
 * ──────────
 * The italic-serif regime pill from the top-bar market-context cluster.
 * Displays regime + optional volatility annotation, with a tone-mapped LED
 * dot beside the phrase.
 *
 * Tone rules (from the kit):
 *  - bull         → ice (pale cyan)
 *  - bear/crisis  → wine
 *  - neutral + elevated/high vol → amber
 *  - neutral + low vol           → ice
 */
export type Regime = "bull" | "bear" | "neutral" | "crisis";
export type RegimeVol = "low" | "elevated" | "high";

export interface RegimePillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  regime: Regime;
  vol?: RegimeVol;
  /** Optional override for the body text; default derived from regime + vol. */
  label?: string;
}

function toneFor(regime: Regime, vol?: RegimeVol): StatusDotTone {
  if (regime === "bull") return "ice";
  if (regime === "bear" || regime === "crisis") return "wine";
  // neutral
  if (vol === "elevated" || vol === "high") return "amber";
  return "ice";
}

function defaultLabel(regime: Regime, vol?: RegimeVol): string {
  const volLabel =
    vol === "low"
      ? "low volatility"
      : vol === "elevated"
        ? "elevated vix"
        : vol === "high"
          ? "risk-off"
          : undefined;
  return volLabel ? `${regime} — ${volLabel}` : regime;
}

export default function RegimePill({
  regime,
  vol,
  label,
  className,
  ...rest
}: RegimePillProps) {
  const tone = toneFor(regime, vol);
  const body = label ?? defaultLabel(regime, vol);

  return (
    <span
      data-slot="regime-pill"
      data-regime={regime}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-2 py-1.5 px-3.5",
        "rounded-pill border border-border",
        "font-display italic text-[13px] text-fg",
        className
      )}
      {...rest}
    >
      <StatusDot tone={tone} size={8} />
      {body}
    </span>
  );
}
