import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * NumericChip
 * ───────────
 * Pill-shaped metadata chip. Label in UI sans (dim), value in bold mono.
 * Used in dashboard rails, card headers, and the context-bar summary row.
 *
 * `tone="profit" | "loss"` tints the value (and the whole chip on the P&L
 * variant from the kit). `tone="muted"` stays neutral.
 */
export type NumericChipTone = "profit" | "loss" | "muted";

export interface NumericChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  label: string;
  value: string | number;
  tone?: NumericChipTone;
}

export default function NumericChip({
  label,
  value,
  tone = "muted",
  className,
  ...rest
}: NumericChipProps) {
  const wrapTone =
    tone === "profit"
      ? "text-profit"
      : tone === "loss"
        ? "text-loss"
        : "text-fg-dim";
  const valueTone =
    tone === "profit"
      ? "text-profit"
      : tone === "loss"
        ? "text-loss"
        : "text-ink-1000";

  return (
    <span
      data-slot="numeric-chip"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 h-[26px] px-3",
        "rounded-pill border border-border bg-bg-elev-1",
        "font-mono text-[11px]",
        wrapTone,
        className
      )}
      {...rest}
    >
      <span>{label}</span>
      <b className={cn("font-medium", valueTone)}>{value}</b>
    </span>
  );
}
