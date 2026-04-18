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
  className,
  ...rest
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  if (range === 0) return null;

  const topPad = height * 0.1;
  const usable = height - topPad * 2;
  const xStep = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * xStep;
      const y = topPad + (1 - (v - min) / range) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      data-slot="sparkline"
      data-tone={tone}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("shrink-0", className)}
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
