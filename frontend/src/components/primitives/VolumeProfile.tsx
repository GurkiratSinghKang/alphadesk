import * as React from "react";

import { cn } from "@/lib/utils";
import type { OHLCVBar } from "@/types";

/**
 * VolumeProfile — vertical "volume at price" histogram primitive.
 *
 * Slice-17 / VPF-1 (2026 design brief, Quantower / GoCharting pattern):
 * shows where the most volume traded across the visible price range,
 * with Point of Control (highest-volume price) highlighted in brand
 * gold and the Value Area (70% of volume around POC) in muted gold.
 *
 * Computation:
 *   1. Bin the bar range [globalLow, globalHigh] into ``binCount`` even buckets.
 *   2. For each bar, distribute its volume proportionally across the
 *      bins it spans (high → low).
 *   3. Sum to volume-per-bin.
 *   4. POC = bin with maximum volume.
 *   5. Value Area = expand outward from POC until 70% of total volume
 *      is captured.
 *
 * Renders as an SVG with horizontal bars stacked vertically (price
 * down the y-axis). Designed to overlay the right edge of a chart
 * canvas as a translucent layer.
 */

export interface VolumeProfileProps {
  bars: OHLCVBar[];
  /** Default 24 — gives a readable distribution without over-binning. */
  binCount?: number;
  /** Pixel height of the SVG (matches chart pane height). */
  height?: number;
  /** Pixel width of the SVG (typically 15-20% of chart width). */
  width?: number;
  /**
   * Optional accessible label. If omitted the SVG is treated as
   * decorative (aria-hidden) — recommended unless the profile is
   * the primary surface for the data (it usually overlays a chart
   * whose price/volume readouts are already exposed elsewhere).
   */
  label?: string;
  className?: string;
}

export default function VolumeProfile({
  bars,
  binCount = 24,
  height = 360,
  width = 80,
  label,
  className,
}: VolumeProfileProps) {
  const profile = React.useMemo(() => {
    if (!bars || bars.length === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
    const range = hi - lo;
    const binSize = range / binCount;
    const bins = new Array<number>(binCount).fill(0);
    for (const b of bars) {
      // Distribute the bar's volume evenly across the bins it spans.
      const startIdx = Math.max(
        0,
        Math.min(binCount - 1, Math.floor((b.low - lo) / binSize)),
      );
      const endIdx = Math.max(
        0,
        Math.min(binCount - 1, Math.floor((b.high - lo) / binSize)),
      );
      const n = endIdx - startIdx + 1;
      if (n <= 0) continue;
      const per = b.volume / n;
      for (let i = startIdx; i <= endIdx; i++) bins[i] += per;
    }
    const totalVolume = bins.reduce((s, v) => s + v, 0);
    if (totalVolume <= 0) return null;
    // Point of Control
    let pocIdx = 0;
    let pocVol = -Infinity;
    bins.forEach((v, i) => {
      if (v > pocVol) {
        pocVol = v;
        pocIdx = i;
      }
    });
    // Value Area: expand outward from POC until cumulative ≥ 70% of total.
    let captured = bins[pocIdx];
    let lowIdx = pocIdx;
    let highIdx = pocIdx;
    while (captured < totalVolume * 0.7 && (lowIdx > 0 || highIdx < binCount - 1)) {
      const lowNext = lowIdx > 0 ? bins[lowIdx - 1] : -Infinity;
      const highNext = highIdx < binCount - 1 ? bins[highIdx + 1] : -Infinity;
      if (lowNext > highNext) {
        lowIdx--;
        captured += lowNext;
      } else {
        highIdx++;
        captured += highNext;
      }
    }
    return { bins, lo, hi, binSize, pocIdx, lowIdx, highIdx, maxVol: pocVol };
  }, [bars, binCount]);

  if (!profile) return null;
  const { bins, pocIdx, lowIdx, highIdx, maxVol, lo, binSize } = profile;
  const binPxHeight = height / binCount;
  const a11yProps = label
    ? {
        role: "img" as const,
        "aria-label": `${label}. Point of control near $${(lo + (pocIdx + 0.5) * binSize).toFixed(2)}; value area $${(lo + (lowIdx + 0.5) * binSize).toFixed(2)}–$${(lo + (highIdx + 0.5) * binSize).toFixed(2)}.`,
      }
    : { "aria-hidden": true as const };

  return (
    <svg
      data-slot="volume-profile"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("pointer-events-none", className)}
      {...a11yProps}
    >
      {bins.map((vol, i) => {
        // Reverse so bin 0 (lowest price) is at the bottom.
        const y = height - (i + 1) * binPxHeight;
        const w = (vol / maxVol) * width;
        const isPoc = i === pocIdx;
        const inValueArea = i >= lowIdx && i <= highIdx;
        const fill = isPoc
          ? "var(--brand)"
          : inValueArea
            ? "var(--brand)"
            : "var(--border)";
        const opacity = isPoc ? 0.85 : inValueArea ? 0.45 : 0.3;
        return (
          <rect
            key={i}
            x={width - w}
            y={y + 0.5}
            width={w}
            height={Math.max(1, binPxHeight - 1)}
            fill={fill}
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}
