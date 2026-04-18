import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StatusDot
 * ─────────
 * A single LED atom — a round colored span with a soft glow.
 *
 * Used by Badge, RegimePill, the status footer bar, and strategy rail rows.
 * Kept deliberately dumb: no store access, no state. Pass `tone` to pick the
 * color, `pulse` to animate for halted / armed states, `size` to scale.
 */
export type StatusDotTone =
  | "profit"
  | "loss"
  | "ice"
  | "amber"
  | "wine"
  | "brand"
  | "muted";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone;
  pulse?: boolean;
  /** Pixel diameter. Defaults to 8. */
  size?: 5 | 7 | 8;
}

const toneClass: Record<StatusDotTone, string> = {
  profit: "bg-profit shadow-[0_0_6px_var(--profit)]",
  loss: "bg-loss shadow-[0_0_6px_var(--loss)]",
  ice: "bg-ice shadow-[0_0_6px_var(--ice-500)]",
  amber: "bg-amber shadow-[0_0_6px_var(--amber-500)]",
  wine: "bg-wine shadow-[0_0_6px_var(--wine-500)]",
  brand: "bg-brand shadow-[0_0_6px_var(--brand)]",
  muted: "bg-fg-muted",
};

const sizeClass: Record<NonNullable<StatusDotProps["size"]>, string> = {
  5: "h-[5px] w-[5px]",
  7: "h-[7px] w-[7px]",
  8: "h-2 w-2",
};

export default function StatusDot({
  tone = "muted",
  pulse = false,
  size = 8,
  className,
  ...rest
}: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      data-pulse={pulse ? "on" : undefined}
      aria-hidden
      className={cn(
        "inline-block rounded-full",
        toneClass[tone],
        sizeClass[size],
        pulse && "animate-pulse",
        className
      )}
      {...rest}
    />
  );
}
