"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ExtendedHoursBadge (primitive)
 * ──────────────────────────────
 * Small uppercase pill rendered next to a price / position row when the
 * underlying data is sourced from outside the regular cash session.
 *
 * Tones:
 *   · pre    — "PM" (pre-market, before 09:30 ET)   amber
 *   · post   — "AH" (after-hours, after 16:00 ET)   amber
 *   · stale  — "STALE" (mark > 5min old)            warning red/yellow
 *
 * EH-3 contract: all data on the backend is optional. Callers MUST be
 * able to render this with an unknown session value without crashing —
 * if neither `session` nor `stale` resolves to one of the canonical
 * tokens, the badge renders nothing. This keeps the regular-session
 * case (where the field is null/undefined) zero-cost: the row's
 * existing layout remains unchanged.
 *
 * The badge uses the project's editorial tracked-caps treatment, with
 * a 6px LED dot for non-color-only signalling (matches Badge's design).
 *
 * NOTE: this is intentionally a thin primitive — most callers wrap it
 * in a Tooltip (see WatchlistPanel, PositionsList) for the long-form
 * "After-hours: $403.82 (+$47.54, +13.34%) at 22:35 ET" copy.
 */
export type ExtendedHoursTone = "pre" | "post" | "stale";

export interface ExtendedHoursBadgeProps {
  tone: ExtendedHoursTone | null | undefined;
  /** Override the default text label (PM / AH / STALE). */
  label?: string;
  /** Tailwind class merge. */
  className?: string;
  /** Forwarded for tooltip integration (caller controls aria-* on the wrapper). */
  title?: string;
}

const TONE_LABEL: Record<ExtendedHoursTone, string> = {
  pre: "PM",
  post: "AH",
  stale: "STALE",
};

const TONE_CLASS: Record<ExtendedHoursTone, string> = {
  // Amber for both pre + post — they're both "outside the session"
  // signals at the same severity. Distinct labels carry the meaning.
  pre: "text-amber bg-amber/10 border-amber/30",
  post: "text-amber bg-amber/10 border-amber/30",
  // Stale escalates one notch — yellow warning treatment with a
  // dashed border so the eye distinguishes "old data" from "valid AH/PM
  // data" at a glance.
  stale:
    "text-state-warning bg-state-warning/10 border-state-warning/30 border-dashed",
};

const DOT_CLASS: Record<ExtendedHoursTone, string> = {
  pre: "bg-amber",
  post: "bg-amber",
  stale: "bg-state-warning animate-pulse",
};

export function ExtendedHoursBadge({
  tone,
  label,
  className,
  title,
}: ExtendedHoursBadgeProps) {
  // Defensive: render nothing when the tone is null/undefined or
  // anything we don't recognise. The regular-session path must not
  // pay any DOM cost for this primitive.
  if (tone == null) return null;
  if (tone !== "pre" && tone !== "post" && tone !== "stale") return null;

  const text = label ?? TONE_LABEL[tone];
  return (
    <span
      data-slot="extended-hours-badge"
      data-tone={tone}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-[0.12em] leading-none",
        "shrink-0",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("inline-block h-1 w-1 rounded-full", DOT_CLASS[tone])}
      />
      {text}
    </span>
  );
}

export default ExtendedHoursBadge;
