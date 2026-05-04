"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface SectorItem {
  sector: string;
  change_pct: number;
  ytd_pct?: number;
  leader?: string;
  leader_change_pct?: number;
}

interface LayoutRect {
  sector: string;
  change_pct: number;
  ytd_pct?: number;
  leader?: string;
  leader_change_pct?: number;
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
  items: { sector: string; change_pct: number; ytd_pct?: number; leader?: string; leader_change_pct?: number; value: number }[],
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
          ytd_pct: item.ytd_pct,
          leader: item.leader,
          leader_change_pct: item.leader_change_pct,
          x: x,
          y: y + offset,
          w: rowLength,
          h: itemLength,
        });
      } else {
        rects.push({
          sector: item.sector,
          change_pct: item.change_pct,
          ytd_pct: item.ytd_pct,
          leader: item.leader,
          leader_change_pct: item.leader_change_pct,
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

// ─── Color Scale (7-step gradient) ─────────────────────────
// QA r4-2 — migrated from generic Tailwind emerald/red defaults to
// AlphaDesk's semantic --up-* / --down-* (chartreuse/coral) tokens so
// the treemap reads in-system. The four gradient stops are produced by
// composing the up-700 / up-500 / down-500 / down-700 ladder + opacity
// modifiers, and the neutral floor still uses --neutral.
function getTileColor(changePct: number): string {
  if (changePct > 2) return "bg-up-700";
  if (changePct > 1) return "bg-up-500/70";
  if (changePct > 0.3) return "bg-up-500/50";
  if (changePct >= -0.3) return "bg-[var(--neutral)]";
  if (changePct >= -1) return "bg-down-500/50";
  if (changePct >= -2) return "bg-down-500/70";
  return "bg-down-700";
}

// ─── Sector name abbreviations ──────────────────────────────

const ABBREV: Record<string, string> = {
  "Consumer Discretionary": "Cons Disc",
  "Communication Services": "Comm Svcs",
  "Consumer Staples": "Cons Stpl",
  "Real Estate": "Real Est",
  "Information Technology": "Info Tech",
  Information: "Info Tech",
  "Health Care": "Hlth Care",
};

function abbrev(name: string, tileWidth: number): string {
  // For narrow tiles, use very short abbreviations
  if (tileWidth < 65) {
    const shortMap: Record<string, string> = {
      "Consumer Discretionary": "CnDs",
      "Communication Services": "Comm",
      "Consumer Staples": "CnSt",
      "Real Estate": "RE",
      "Information Technology": "Tech",
      Information: "Tech",
      "Health Care": "Hlth",
      Technology: "Tech",
      Financials: "Fin",
      Healthcare: "Hlth",
      Industrials: "Ind",
      Materials: "Mat",
      Utilities: "Util",
      Energy: "Engy",
    };
    return shortMap[name] ?? name.slice(0, 4);
  }
  return ABBREV[name] ?? name;
}

// ─── Component ──────────────────────────────────────────────

interface SectorTreemapProps {
  sectors: SectorItem[];
  width?: number;
  height?: number;
  isDemo?: boolean;
}

export function SectorTreemap({ sectors, width: propWidth, height = 160, isDemo }: SectorTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(propWidth ?? 380);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<"daily" | "ytd">("daily");

  // Check if any sector has YTD data
  const hasYtd = useMemo(() => sectors.some((s) => s.ytd_pct != null), [sectors]);

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
    // Size by absolute change -- bigger movers get bigger rectangles
    // Use a minimum value so near-zero sectors still get a visible tile
    const items = sectors.map((s) => ({
      ...s,
      value: Math.max(Math.abs(s.change_pct), 0.05),
    }));
    // Sort by value descending for better treemap layout
    items.sort((a, b) => b.value - a.value);
    return squarify(items, width, height);
  }, [sectors, width, height]);

  const handleMouseEnter = useCallback((sector: string, e: React.MouseEvent) => {
    setHoveredSector(sector);
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltipPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      });
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltipPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredSector(null);
    setTooltipPos(null);
  }, []);

  if (rects.length === 0) {
    return <p className="text-label text-muted-foreground">No sector data</p>;
  }

  const hoveredRect = hoveredSector ? rects.find((r) => r.sector === hoveredSector) : null;

  return (
    <div>
      {/* Title row */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-eyebrow font-semibold uppercase tracking-wider text-muted-foreground">
          Sector Performance
        </h3>
        {hasYtd && (
          <div className="flex items-center gap-0.5 rounded-md bg-[var(--panel)] p-0.5 border border-border/30">
            <button
              onClick={() => setViewMode("daily")}
              className={cn(
                "px-2 py-0.5 text-label font-medium rounded transition-colors",
                viewMode === "daily"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Daily
            </button>
            <button
              onClick={() => setViewMode("ytd")}
              className={cn(
                "px-2 py-0.5 text-label font-medium rounded transition-colors",
                viewMode === "ytd"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              YTD
            </button>
          </div>
        )}
      </div>

      {/* Treemap */}
      <div ref={containerRef} className="relative w-full" style={{ height }}>
        {rects.map((rect) => {
          const tileW = Math.max(0, rect.w - 2);
          const tileH = Math.max(0, rect.h - 2);
          // Determine text visibility thresholds
          const showName = tileW > 36 && tileH > 22;
          const showChange = tileW > 36 && tileH > 34;
          const showYtd = tileW > 50 && tileH > 50 && rect.ytd_pct != null;
          const showLeader = tileW > 60 && tileH > 60 && rect.leader;

          const displayPct = viewMode === "ytd" && rect.ytd_pct != null ? rect.ytd_pct : rect.change_pct;
          const colorPct = viewMode === "ytd" && rect.ytd_pct != null ? rect.ytd_pct : rect.change_pct;
          const isHovered = hoveredSector === rect.sector;

          return (
            <div
              key={rect.sector}
              className={cn(
                "absolute flex flex-col items-center justify-center overflow-hidden rounded transition-all duration-150",
                getTileColor(colorPct),
                isHovered && "ring-1 ring-white/30 brightness-125 z-10"
              )}
              style={{
                left: rect.x + 1,
                top: rect.y + 1,
                width: tileW,
                height: tileH,
              }}
              onMouseEnter={(e) => handleMouseEnter(rect.sector, e)}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {showName && (
                <span className="text-label font-medium text-white/90 leading-tight text-center px-1 truncate max-w-full">
                  {abbrev(rect.sector, tileW)}
                </span>
              )}
              {showChange && (
                <span
                  className={cn(
                    "text-label font-bold tabular-nums leading-tight",
                    // QA r4-2 — was emerald-200 / red-200 (off-system). Use the
                    // semantic up-100 / down-100 tints which are AlphaDesk's
                    // light-end of the chartreuse/coral ladder.
                    displayPct >= 0 ? "text-up-100" : "text-down-100"
                  )}
                >
                  {(displayPct ?? 0) >= 0 ? "+" : ""}{(displayPct ?? 0).toFixed(1)}%
                </span>
              )}
              {showYtd && viewMode === "daily" && (
                <span className="text-label text-white/50 tabular-nums leading-tight mt-px">
                  YTD {(rect.ytd_pct ?? 0) >= 0 ? "+" : ""}{(rect.ytd_pct ?? 0).toFixed(1)}%
                </span>
              )}
              {showLeader && (
                <span className="text-label text-white/40 leading-tight mt-0.5 truncate max-w-full px-1">
                  {rect.leader}
                </span>
              )}
            </div>
          );
        })}

        {/* Hover tooltip */}
        {hoveredRect && tooltipPos && (
          <div
            className="pointer-events-none absolute z-30 rounded-md border border-border bg-[var(--surface)]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
            style={{
              left: Math.min(tooltipPos.x + 12, width - 160),
              top: Math.max(tooltipPos.y - 60, 0),
            }}
          >
            <p className="text-label font-semibold text-white">{hoveredRect.sector}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className={cn(
                "text-label font-bold tabular-nums",
                // QA r4-2 — emerald-400 / red-400 → semantic profit / loss tokens
                hoveredRect.change_pct >= 0 ? "text-profit" : "text-loss"
              )}>
                {(hoveredRect.change_pct ?? 0) >= 0 ? "+" : ""}{(hoveredRect.change_pct ?? 0).toFixed(2)}%
              </span>
              <span className="text-label text-fg-muted">today</span>
            </div>
            {hoveredRect.ytd_pct != null && (
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-label tabular-nums",
                  hoveredRect.ytd_pct >= 0 ? "text-profit/70" : "text-loss/70"
                )}>
                  {(hoveredRect.ytd_pct ?? 0) >= 0 ? "+" : ""}{(hoveredRect.ytd_pct ?? 0).toFixed(2)}%
                </span>
                <span className="text-label text-fg-muted">YTD</span>
              </div>
            )}
            {hoveredRect.leader && (
              <p className="mt-0.5 text-label text-fg-muted">
                Leader: <span className="text-white/80">{hoveredRect.leader}</span>
                {hoveredRect.leader_change_pct != null && (
                  <span className={cn(
                    "ml-1 tabular-nums",
                    hoveredRect.leader_change_pct >= 0 ? "text-profit/70" : "text-loss/70"
                  )}>
                    {(hoveredRect.leader_change_pct ?? 0) >= 0 ? "+" : ""}{(hoveredRect.leader_change_pct ?? 0).toFixed(1)}%
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      {isDemo && (
        <div className="text-label text-blue-400/70 mt-1">Connect Alpaca API for live data</div>
      )}
    </div>
  );
}
