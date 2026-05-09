import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Stat
 * ────
 * v2 redesign — recurring 3-line stat block (label + value + sub).
 * Standardizes the ~60 ad-hoc stat patterns scattered across Dashboard,
 * Research, Admin, Risk, Reports. Always tabular-nums; tone follows
 * profit/loss/muted intent.
 *
 * Voice: ALL CAPS tracked label, large mono numeric value, optional
 * smaller sub-line.
 */
export type StatTone = "default" | "profit" | "loss" | "muted" | "brand";
export type StatSize = "sm" | "md" | "lg";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tracked-caps label above the value. */
  label: string;
  /** Primary numeric or short-text value. */
  value: React.ReactNode;
  /** Optional secondary line — delta, ratio, qualifier. */
  sub?: React.ReactNode;
  /**
   * Tone of the value (also color-codes the optional sub if numeric).
   * Default uses ink-1000 for the value.
   */
  tone?: StatTone;
  /**
   * Numeric size scale. `sm` for tightly-packed grids, `md` (default)
   * for primary stat strips, `lg` for hero stats.
   */
  size?: StatSize;
  /** Optional icon displayed inline with the label. */
  icon?: React.ReactNode;
  className?: string;
}

const valueSizeClass: Record<StatSize, string> = {
  sm: "t-num-md",
  md: "t-num-lg",
  lg: "t-num-xl",
};

const valueToneClass: Record<StatTone, string> = {
  default: "text-ink-1000",
  profit: "text-profit",
  loss: "text-loss",
  muted: "text-fg-muted",
  brand: "text-brand",
};

export default function Stat({
  label,
  value,
  sub,
  tone = "default",
  size = "md",
  icon,
  className,
  ...rest
}: StatProps) {
  return (
    <div
      data-slot="stat"
      data-tone={tone}
      data-size={size}
      className={cn("flex flex-col gap-1 min-w-0", className)}
      {...rest}
    >
      <span className="t-label inline-flex items-center gap-1.5">
        {icon && <span className="text-fg-muted [&>svg]:size-3">{icon}</span>}
        {label}
      </span>
      <span className={cn(valueSizeClass[size], valueToneClass[tone], "truncate")}>
        {value}
      </span>
      {sub != null && (
        <span className="text-body-sm text-fg-muted truncate">{sub}</span>
      )}
    </div>
  );
}
