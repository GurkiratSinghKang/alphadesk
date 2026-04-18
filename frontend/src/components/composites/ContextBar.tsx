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
        "overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none scrollbar-none",
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
            <span
              className={cn(
                "font-sans font-semibold text-[8.5px] uppercase text-fg-hint"
              )}
              style={{ letterSpacing: "0.18em", lineHeight: 1 }}
            >
              {cell.label}
            </span>
            <div className="flex gap-2 items-baseline">
              <b
                className={cn(
                  "font-mono tabular-nums font-medium",
                  cell.emphasis
                    ? "text-gold-300 text-[14px]"
                    : cell.valueTone === "profit"
                      ? "text-up-500 text-[13px]"
                      : cell.valueTone === "loss"
                        ? "text-down-500 text-[13px]"
                        : cell.valueTone === "muted"
                          ? "text-fg-muted text-[13px]"
                          : "text-ink-1000 text-[13px]"
                )}
                style={{ letterSpacing: "-0.005em" }}
              >
                {cell.value}
              </b>
              {cell.delta ? (
                <span
                  className={cn(
                    "font-mono tabular-nums text-[10.5px]",
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
