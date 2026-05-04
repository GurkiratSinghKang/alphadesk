import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * BulletGraph — Stephen Few's gauge-replacement.
 *
 * Phase-1 / BG-1 (2026 design brief / Few "Information Dashboard Design"):
 * Donut / pie / radial dials are a poor encoding for magnitude — Munzner
 * ranks position-on-common-scale > length > angle > area > color hue.
 * The bullet graph delivers the same "current vs target" comparison
 * with a 1-D bar that scans in <1 sec.
 *
 * Anatomy (Few's spec):
 *   • Scale axis along the bottom
 *   • Qualitative bands (poor / fair / good) shaded behind
 *   • Target marker (vertical tick) where the goal sits
 *   • Current value bar (the actual measurement)
 *
 * Use cases on AlphaDesk:
 *   • Daily loss vs cap (current $ loss, cap = $5k, fair band 60-80%)
 *   • Buying-power utilization (current BP used vs available)
 *   • Sector concentration vs limit (current 32%, cap 35%)
 *   • Strategy drawdown vs max-DD threshold
 */

export interface BulletGraphProps {
  /** Current measured value */
  current: number;
  /** Target / goal value (vertical tick) */
  target?: number;
  /** Maximum value of the scale (defaults to 1.25× target so the bar has headroom) */
  max?: number;
  /** Bands as fractions of max — e.g. {fair: 0.6, good: 0.8} renders fair from 0..0.6 and good from 0.6..0.8 */
  bands?: { fair?: number; good?: number };
  /** Tone of the value bar — profit / loss / brand. Defaults to brand. */
  tone?: "profit" | "loss" | "brand" | "warn";
  /** Inverted scale: lower = better (e.g. drawdown). Default false. */
  inverted?: boolean;
  /** Optional caption below the bar (e.g. "62% of cap"). */
  caption?: string;
  /** Accessible label, e.g. "Daily loss". */
  label: string;
  className?: string;
}

const toneToBar: Record<NonNullable<BulletGraphProps["tone"]>, string> = {
  profit: "bg-[color:var(--profit)]",
  loss: "bg-[color:var(--loss)]",
  brand: "bg-[color:var(--brand)]",
  warn: "bg-[color:var(--state-warning,#d97706)]",
};

export default function BulletGraph({
  current,
  target,
  max,
  bands,
  tone = "brand",
  inverted = false,
  caption,
  label,
  className,
}: BulletGraphProps) {
  const scaleMax = max ?? (target != null ? target * 1.25 : Math.max(1, current * 1.25));
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const fairPct = bands?.fair != null ? pct(bands.fair * scaleMax) : null;
  const goodPct = bands?.good != null ? pct(bands.good * scaleMax) : null;
  const targetPct = target != null ? pct(target) : null;
  const currentPct = pct(Math.abs(current));

  // For inverted scales (lower = better) we shade the bands in reverse.
  const fairLeft = inverted ? 100 - (fairPct ?? 0) : 0;
  const goodLeft = inverted ? 100 - (goodPct ?? 0) : 0;

  return (
    <div
      data-slot="bullet-graph"
      role="img"
      aria-label={`${label}: ${current.toFixed(2)}${target != null ? ` of ${target.toFixed(2)}` : ""}`}
      className={cn("flex flex-col gap-1", className)}
    >
      <div className="relative h-3 w-full overflow-hidden rounded-sm bg-[color:var(--bg-elev-1)]">
        {/* Qualitative bands — render before the value bar so the bar
            sits on top. Use border-dim to keep the visual quiet. */}
        {fairPct != null && (
          <span
            className="absolute top-0 bottom-0 bg-[color:var(--border)]/40"
            style={
              inverted
                ? { right: 0, width: `${fairPct}%` }
                : { left: `${fairLeft}%`, width: `${fairPct}%` }
            }
          />
        )}
        {goodPct != null && (
          <span
            className="absolute top-0 bottom-0 bg-[color:var(--border)]/60"
            style={
              inverted
                ? { right: 0, width: `${goodPct}%` }
                : { left: `${goodLeft}%`, width: `${goodPct}%` }
            }
          />
        )}
        {/* Value bar — the principal datum, height ~50% so it's visibly
            inside the band track. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1/4 bottom-1/4 rounded-sm",
            toneToBar[tone],
          )}
          style={{ left: 0, width: `${currentPct}%` }}
        />
        {/* Target marker — vertical tick. Bloomberg-amber-style accent. */}
        {targetPct != null && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-[color:var(--fg-strong)]"
            style={{ left: `${targetPct}%` }}
          />
        )}
      </div>
      {caption && (
        <span className="font-mono text-label text-[color:var(--fg-muted)]">
          {caption}
        </span>
      )}
    </div>
  );
}
