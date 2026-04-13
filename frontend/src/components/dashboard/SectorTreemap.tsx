"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SectorItem {
  sector: string;
  change_pct: number;
}

interface LayoutRect {
  sector: string;
  change_pct: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Squarified Treemap Algorithm ───────────────────────────

function worstAspectRatio(row: number[], w: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  if (s === 0 || w === 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((w * w * max) / (s * s), (s * s) / (w * w * min));
}

function squarify(
  items: { sector: string; change_pct: number; value: number }[],
  containerW: number,
  containerH: number
): LayoutRect[] {
  if (items.length === 0 || containerW <= 0 || containerH <= 0) return [];

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0) return [];

  // Normalize values to areas
  const totalArea = containerW * containerH;
  const areas = items.map((it) => ({
    ...it,
    area: (it.value / totalValue) * totalArea,
  }));

  const rects: LayoutRect[] = [];
  let remaining = [...areas];
  let x = 0;
  let y = 0;
  let w = containerW;
  let h = containerH;

  while (remaining.length > 0) {
    // Determine the shorter side
    const shortSide = Math.min(w, h);
    const row: typeof areas = [];
    let rowArea = 0;

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i];
      const testRow = [...row.map((r) => r.area), item.area];
      const testArea = rowArea + item.area;

      if (row.length === 0) {
        row.push(item);
        rowArea = item.area;
        continue;
      }

      const currentWorst = worstAspectRatio(
        row.map((r) => r.area),
        shortSide
      );
      const newWorst = worstAspectRatio(testRow, shortSide);

      if (newWorst <= currentWorst) {
        row.push(item);
        rowArea = testArea;
      } else {
        break;
      }
    }

    // Layout the row
    const isHorizontal = w >= h;
    const rowLength = rowArea / (isHorizontal ? h : w);

    let offset = 0;
    for (const item of row) {
      const itemLength = item.area / rowLength;
      if (isHorizontal) {
        rects.push({
          sector: item.sector,
          change_pct: item.change_pct,
          x: x,
          y: y + offset,
          w: rowLength,
          h: itemLength,
        });
      } else {
        rects.push({
          sector: item.sector,
          change_pct: item.change_pct,
          x: x + offset,
          y: y,
          w: itemLength,
          h: rowLength,
        });
      }
      offset += itemLength;
    }

    // Reduce remaining space
    if (isHorizontal) {
      x += rowLength;
      w -= rowLength;
    } else {
      y += rowLength;
      h -= rowLength;
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

// ─── Color Scale ────────────────────────────────────────────

function getColor(changePct: number): string {
  if (changePct > 1) return "rgba(34,197,94,0.7)";
  if (changePct > 0.3) return "rgba(34,197,94,0.45)";
  if (changePct > 0) return "rgba(34,197,94,0.25)";
  if (changePct > -0.3) return "rgba(239,68,68,0.25)";
  if (changePct > -1) return "rgba(239,68,68,0.45)";
  return "rgba(239,68,68,0.7)";
}

// ─── Sector name abbreviations ──────────────────────────────

const ABBREV: Record<string, string> = {
  "Consumer Discretionary": "Cons Disc",
  "Communication Services": "Comm Svcs",
  "Consumer Staples": "Cons Stpl",
  "Real Estate": "Real Est",
  Information: "Info Tech",
};

function abbrev(name: string): string {
  return ABBREV[name] ?? name;
}

// ─── Component ──────────────────────────────────────────────

interface SectorTreemapProps {
  sectors: SectorItem[];
  width?: number;
  height?: number;
  isDemo?: boolean;
}

export function SectorTreemap({ sectors, width: propWidth, height = 120, isDemo }: SectorTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(propWidth ?? 380);

  useEffect(() => {
    if (!containerRef.current) return;
    let timeout: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setMeasuredWidth(w);
      }, 100);
    });
    ro.observe(containerRef.current);
    return () => { clearTimeout(timeout); ro.disconnect(); };
  }, []);

  const width = propWidth ?? measuredWidth;
  const rects = useMemo(() => {
    if (sectors.length === 0) return [];
    // Size by absolute change — bigger movers get bigger rectangles
    // Use a minimum value so near-zero sectors still get a visible tile
    const items = sectors.map((s) => ({
      ...s,
      value: Math.max(Math.abs(s.change_pct), 0.05),
    }));
    // Sort by value descending for better treemap layout
    items.sort((a, b) => b.value - a.value);
    return squarify(items, width, height);
  }, [sectors, width, height]);

  if (rects.length === 0) {
    return <p className="text-xs text-muted-foreground">No sector data</p>;
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", isDemo && "opacity-40")} style={{ height }}>
      {rects.map((rect) => {
        const showText = rect.w > 45 && rect.h > 30;
        const val = rect.change_pct;
        return (
          <div
            key={rect.sector}
            className="absolute flex flex-col items-center justify-center overflow-hidden"
            style={{
              left: rect.x + 1,
              top: rect.y + 1,
              width: Math.max(0, rect.w - 2),
              height: Math.max(0, rect.h - 2),
              backgroundColor: getColor(val),
              borderRadius: 3,
            }}
          >
            {showText && (
              <>
                <span className="text-[10px] font-medium text-white/90 leading-tight text-center px-1 truncate max-w-full">
                  {abbrev(rect.sector)}
                </span>
                <span
                  className={cn(
                    "text-[11px] font-bold tabular-nums",
                    val >= 0 ? "text-emerald-200" : "text-red-200"
                  )}
                >
                  {val >= 0 ? "+" : ""}{val.toFixed(1)}%
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
