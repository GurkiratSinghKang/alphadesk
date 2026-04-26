import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton — content-shape shimmer placeholder.
 *
 * Phase-1 / SK-1 (2026 design brief): every list / page / data-table
 * loader should render the *shape* of the eventual content with a
 * subtle horizontal shimmer, NOT a spinning circle.
 *
 * Per the research synthesis (Stripe / Linear / Notion all converge here):
 * - Spinners give NO information about what's loading or how long.
 * - Skeletons reduce perceived load time ~20-30% (NN/g eye-tracking).
 * - Empty states should write a *next step*, not "loading…".
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />              // single line
 *   <Skeleton variant="circle" className="h-8 w-8" /> // avatar / dot
 *   <SkeletonRow cells={5} />                      // table-row preset
 *   <SkeletonStack rows={4} />                     // list preset
 */

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "rect" | "circle" | "pill";
}

export function Skeleton({
  className,
  variant = "rect",
  ...rest
}: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      role="presentation"
      className={cn(
        // Base: soft surface a half-step above the card background so
        // the shimmer reads as a faint pulse, not a hard rectangle.
        "relative overflow-hidden bg-[color:var(--bg-elev-1)]/60",
        // Shimmer keyframe defined in globals.css as `@keyframes shimmer`.
        // Apply via the inline gradient so the wave moves left→right.
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent",
        "before:animate-[shimmer_1.5s_infinite]",
        // Variants:
        variant === "circle" && "rounded-full",
        variant === "pill" && "rounded-full",
        variant === "rect" && "rounded-sm",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Single skeleton row that mimics a table row — N rectangular cells
 * with a thin gap between them. Use as a fill while a `<tbody>`
 * rehydrates.
 */
export function SkeletonRow({
  cells = 4,
  className,
}: {
  cells?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="skeleton-row"
      className={cn("flex items-center gap-3 py-2", className)}
    >
      {Array.from({ length: cells }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3.5",
            // Vary widths so the row doesn't look like a barcode.
            i === 0 && "w-16",
            i === 1 && "w-24",
            i === 2 && "w-12",
            i === 3 && "w-20",
            i > 3 && "w-16",
          )}
        />
      ))}
    </div>
  );
}

/**
 * N skeleton rows stacked, default 4. Use as a list/table loader.
 */
export function SkeletonStack({
  rows = 4,
  cells = 4,
  className,
}: {
  rows?: number;
  cells?: number;
  className?: string;
}) {
  return (
    <div data-slot="skeleton-stack" className={cn("space-y-1", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cells={cells} />
      ))}
    </div>
  );
}
