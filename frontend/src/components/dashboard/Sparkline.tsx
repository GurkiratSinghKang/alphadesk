"use client";

import { useId } from "react";

// ─── Mini Sparkline SVG ──────────────────────────────────────

export function Sparkline({
  data,
  color,
  width = 80,
  height = 24,
  className,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradId = `spark-${useId().replace(/:/g, "")}`;
  if (data.length < 2) return null;
  // Filter non-finite values (NaN / Infinity) — a single NaN would
  // poison Math.min/max and the polyline would silently vanish.
  const clean = data.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  // Flat data — return nothing; the strategy card already shows the return text
  if (min === max) return null;
  const range = max - min;
  const points = clean
    .map((v, i) => {
      const x = (i / (clean.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className={className ?? "shrink-0"}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function generateSparkData(_seed: number, count = 20): number[] {
  // Return flat line — no fake random walk data
  return Array(count).fill(100);
}
