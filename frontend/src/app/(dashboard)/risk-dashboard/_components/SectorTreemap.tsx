"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import { cn } from "@/lib/utils";

interface SectorRow {
  id: string;
  name: string;
  pctNAV: number;
  capPctNAV: number;
  dayChgPct: number;
}

const SECTORS: SectorRow[] = [
  { id: "info-tech", name: "Information Tech", pctNAV: 38.4, capPctNAV: 35, dayChgPct: 1.6 },
  { id: "industrials", name: "Industrials", pctNAV: 14.2, capPctNAV: 25, dayChgPct: 0.4 },
  { id: "healthcare", name: "Healthcare", pctNAV: 11.8, capPctNAV: 25, dayChgPct: -0.2 },
  { id: "financials", name: "Financials", pctNAV: 9.6, capPctNAV: 25, dayChgPct: 0.7 },
  { id: "consumer-disc", name: "Consumer Disc.", pctNAV: 8.4, capPctNAV: 20, dayChgPct: -0.5 },
  { id: "energy", name: "Energy", pctNAV: 6.8, capPctNAV: 20, dayChgPct: -1.2 },
  { id: "comm-svcs", name: "Comm Services", pctNAV: 5.2, capPctNAV: 20, dayChgPct: 0.3 },
  { id: "consumer-stap", name: "Consumer Staples", pctNAV: 3.4, capPctNAV: 20, dayChgPct: 0.1 },
  { id: "materials", name: "Materials", pctNAV: 2.2, capPctNAV: 20, dayChgPct: -0.8 },
];

/**
 * SectorTreemap — sector exposure heatmap as a CSS grid where each
 * cell sizes by exposure %. Greener tiles for healthy headroom,
 * coral tiles for over-cap. Phase 1.1 simplified treemap (real
 * d3-treemap layout lands later); cells laid out with explicit
 * grid-area sizes derived from rounded percent buckets.
 */
export default function SectorTreemap() {
  const overCap = SECTORS.filter((s) => s.pctNAV > s.capPctNAV);
  return (
    <Section
      eyebrow="RISK · SECTOR EXPOSURE"
      title="Sector heatmap"
      description={
        overCap.length > 0
          ? `${overCap.length} sector over cap · trim or hedge`
          : "All sectors within cap"
      }
      right={
        overCap.length > 0 ? (
          <span className="px-2 py-0.5 rounded-pill bg-tint-down-1 border border-loss/40 text-loss text-eyebrow font-semibold uppercase tracking-[0.08em]">
            Over cap
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-pill bg-tint-up-1 border border-profit/40 text-profit text-eyebrow font-semibold uppercase tracking-[0.08em]">
            All clear
          </span>
        )
      }
    >
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {SECTORS.map((s) => {
          const utilization = (s.pctNAV / s.capPctNAV) * 100;
          const overCap = utilization > 100;
          // Larger cell rows for higher-exposure sectors.
          const rowSpan = s.pctNAV > 30 ? "lg:row-span-2" : s.pctNAV > 14 ? "" : "";
          const colSpan = s.pctNAV > 30 ? "lg:col-span-2" : "";
          return (
            <article
              key={s.id}
              className={cn(
                "rounded-md border p-3 flex flex-col gap-1 min-h-[88px]",
                rowSpan,
                colSpan,
                overCap
                  ? "border-loss/40 bg-tint-down-1"
                  : utilization > 70
                  ? "border-state-warning/40 bg-tint-brand-1"
                  : "border-border-hair bg-bg-elev-1",
              )}
              role="img"
              aria-label={`${s.name}: ${s.pctNAV}% of NAV (cap ${s.capPctNAV}%)`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-body-sm font-medium text-fg truncate">{s.name}</h3>
                <span className={cn("t-num-md", overCap ? "text-loss" : "text-fg")}>
                  {s.pctNAV}%
                </span>
              </div>
              <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                cap {s.capPctNAV}% · {Math.round(utilization)}% used
              </p>
              <p
                className={cn(
                  "text-eyebrow font-semibold",
                  s.dayChgPct > 0 ? "text-profit" : s.dayChgPct < 0 ? "text-loss" : "text-fg-muted",
                )}
              >
                {s.dayChgPct > 0 ? "+" : ""}
                {s.dayChgPct.toFixed(1)}% today
              </p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
