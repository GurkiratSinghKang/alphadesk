import * as React from "react";

import { cn } from "@/lib/utils";
import type { ContextCell } from "./types";

/**
 * ContextBar (composite, 56px after Round-8 hero promotion)
 * ─────────────────────────────────────────────────────────
 * Horizontal band of 4 metric cells with the first ``emphasis`` cell
 * promoted to a 28px display — the page hero. Hairline dividers
 * between cells.
 *
 * Round-8 killer-move 1: trimmed from 7 cells to 4. Cash, Unrealized
 * P&L, Realized today were duplicates of fields already surfaced in
 * Day P&L's delta line. Hero cell now reads as a real hero (28px
 * mono display vs 20px), giving the dashboard one clear focal point
 * (the "single hero per page" rule from Linear / Bloomberg /
 * tastytrade). 38px → 56px so the bigger type breathes.
 */
export interface ContextBarProps {
  cells: ContextCell[];
  /** Optional className passthrough for the outer shell. */
  className?: string;
}

export default function ContextBar({ cells, className }: ContextBarProps) {
  return (
    <div
      data-slot="context-bar"
      className={cn(
        "flex items-stretch h-[56px]",
        // Viewport audit r5 #5: with 4 cells the bar fits comfortably at
        // every breakpoint, but keep the snap fallback for tiny viewports
        // (mobile landscape with side-rail collapsed).
        "overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none",
        "border-b border-border bg-ink-100",
        className
      )}
    >
      {cells.map((cell, i) => {
        const isLast = i === cells.length - 1;
        return (
          <div
            key={cell.label + i}
            data-emphasis={cell.emphasis || undefined}
            className={cn(
              "flex flex-col justify-center gap-[2px] shrink-0 snap-start px-3 md:px-[22px]",
              cell.emphasis && "min-w-[220px]",
              !isLast && "border-r border-border-hair"
            )}
          >
            <span className="t-label text-fg-hint">
              {cell.label}
            </span>
            <div className="flex gap-2 items-baseline">
              <b
                className={cn(
                  "font-mono tabular-nums font-medium",
                  cell.emphasis
                    ? "text-gold-300 text-[28px] leading-none"
                    : cell.valueTone === "profit"
                      ? "text-up-500 text-base"
                      : cell.valueTone === "loss"
                        ? "text-down-500 text-base"
                        : cell.valueTone === "muted"
                          ? "text-fg-muted text-base"
                          : "text-ink-1000 text-base"
                )}
                style={{ letterSpacing: "-0.005em" }}
              >
                {cell.value}
              </b>
              {cell.delta ? (
                <span
                  className={cn(
                    "font-mono tabular-nums text-[13px]",
                    cell.deltaTone === "profit"
                      ? "text-up-500"
                      : cell.deltaTone === "loss"
                        ? "text-down-500"
                        : "text-fg-muted"
                  )}
                >
                  {cell.delta}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
