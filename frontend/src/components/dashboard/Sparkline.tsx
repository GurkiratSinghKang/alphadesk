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
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  // Flat data — render a subtle dashed horizontal line
  if (min === max) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className={className ?? "shrink-0"} style={{ height }}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    );
  }
  const range = max - min;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const gradId = `spark-${useId().replace(/:/g, "")}`;

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
