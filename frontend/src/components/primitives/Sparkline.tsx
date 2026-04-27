import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sparkline
 * ─────────
 * Tiny single-polyline SVG. No axes, no fills, no labels — pure presentation.
 *
 * Tone maps to a design-system stroke color via CSS var. Data is scaled to
 * fit the viewBox without clipping — 2% top/bottom margin so points aren't
 * flush against the edge.
 */
export type SparklineTone = "profit" | "loss" | "brand" | "ice" | "muted";

export interface SparklineProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
  data: number[];
  tone?: SparklineTone;
  /** Default 200 px. */
  width?: number;
  /** Default 28 px. */
  height?: number;
  /** Default 1.5. */
  strokeWidth?: number;
  /**
   * Accessible label, e.g. "AAPL 5-day price trend, +2.3%". When
   * omitted the sparkline is treated as decorative (aria-hidden) —
   * callers should provide a label whenever the data isn't redundant
   * with adjacent text content.
   */
  label?: string;
}

const toneToVar: Record<SparklineTone, string> = {
  profit: "var(--profit)",
  loss: "var(--loss)",
  brand: "var(--brand)",
  ice: "var(--ice-500)",
  muted: "var(--fg-muted)",
};

export default function Sparkline({
  data,
  tone = "brand",
  width = 200,
  height = 28,
  strokeWidth = 1.5,
  label,
  className,
  ...rest
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  // Filter non-finite values (NaN / Infinity) before min/max. A single NaN
  // in `data` would make `Math.min` return NaN, which then propagates to
  // every polyline point — SVG silently drops the shape. If too few clean
  // points remain, bail out rather than drawing garbage.
  const clean = data.filter(Number.isFinite);
  if (clean.length < 2) return null;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min;
  if (range === 0) return null;

  const topPad = height * 0.1;
  const usable = height - topPad * 2;
  const xStep = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * xStep;
      // Clamp non-finite points to the midline rather than emitting NaN
      // coords — a cleaner failure mode than a vanished polyline.
      const safeV = Number.isFinite(v) ? v : (min + max) / 2;
      const y = topPad + (1 - (safeV - min) / range) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Resolve a11y attributes. Order of precedence:
  //   1. Explicit ``label`` prop → role="img" + aria-label.
  //   2. Pre-existing aria-* in rest (caller already wired AT) → leave
  //      it alone (with role="img" so the aria-label actually applies).
  //   3. Otherwise treat as decorative → aria-hidden=true.
  // Spreading ``...rest`` LAST so explicit caller attributes still win
  // when they really need to (e.g. tests), but the default branch
  // doesn't collide with a caller-supplied aria-label any more.
  const callerHasA11y =
    "aria-label" in rest ||
    "aria-labelledby" in rest ||
    "aria-describedby" in rest ||
    "role" in rest;
  const a11yProps = label
    ? { role: "img" as const, "aria-label": label }
    : callerHasA11y
      ? { role: "img" as const }
      : { "aria-hidden": true as const };

  return (
    <svg
      data-slot="sparkline"
      data-tone={tone}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("shrink-0", className)}
      {...a11yProps}
      {...rest}
    >
      <polyline
        points={points}
        fill="none"
        stroke={toneToVar[tone]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
