import * as React from "react";

import { cn } from "@/lib/utils";
import type { ContextCell } from "./types";

/**
 * ContextBar (composite, 38px)
 * ────────────────────────────
 * Horizontal band of 7 metric cells right-aligned after the hero.
 * Hairline dividers between cells; the first `emphasis` cell gets
 * the gold-300 hero treatment.
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
        "flex items-stretch h-[38px]",
        // Viewport audit r5 #5: the 7 cells (each ~100-140px at md:px-[22px])
        // don't fit in the center column at 768-1100 once the 260px rail
        // subtracts from width. Previously md:overflow-visible killed scroll
        // before there was room — cells clipped silently. Keep overflow-x-auto
        // + snap until lg where the 3-column grid finally leaves room.
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
                    ? "text-gold-300 text-[20px]"
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
