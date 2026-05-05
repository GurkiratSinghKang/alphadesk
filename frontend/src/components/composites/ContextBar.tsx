import * as React from "react";

import { cn } from "@/lib/utils";
import type { ContextCell } from "./types";

/**
 * Debounce screen-reader announcements: ticker updates can fire many times
 * per second. ``useDeferredValue`` yields the latest value but defers the
 * paint, while a 2s minimum-interval throttle prevents announcement floods.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

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
        "border-b border-border/70 bg-ink-100/95 shadow-[0_12px_38px_-34px_rgba(0,0,0,0.9)]",
        className
      )}
    >
      {cells.map((cell, i) => {
        const isLast = i === cells.length - 1;
        return (
          <ContextCellRow
            key={cell.label + i}
            cell={cell}
            isLast={isLast}
          />
        );
      })}
    </div>
  );
}

/**
 * Single ContextBar cell. The hero (``emphasis``) cell wraps its
 * numeric content in ``aria-live="polite"`` + ``aria-atomic="true"``
 * so SR users hear the hero P&L change. The value/delta are debounced
 * 2s to prevent ticker-storm announcements.
 */
function ContextCellRow({ cell, isLast }: { cell: ContextCell; isLast: boolean }) {
  const debouncedValue = useDebouncedValue(cell.value, cell.emphasis ? 2000 : 0);
  const debouncedDelta = useDebouncedValue(cell.delta ?? "", cell.emphasis ? 2000 : 0);
  const displayValue = cell.emphasis ? debouncedValue : cell.value;
  const displayDelta = cell.emphasis ? debouncedDelta : (cell.delta ?? "");

  const inner = (
    <div className="flex gap-2 items-baseline">
      <b
        className={cn(
          "font-mono tabular-nums font-medium",
          cell.emphasis
            ? "text-gold-300 text-h1 leading-none"
            : cell.valueTone === "profit"
              ? "text-profit text-base"
              : cell.valueTone === "loss"
                ? "text-down-500 text-base"
                : cell.valueTone === "muted"
                  ? "text-fg-muted text-base"
                  : "text-ink-1000 text-base"
        )}
        style={{ letterSpacing: 0 }}
      >
        {displayValue}
      </b>
      {displayDelta ? (
        <span
          className={cn(
            "hidden font-mono tabular-nums text-body-sm sm:inline",
            cell.deltaTone === "profit"
              ? "text-profit"
              : cell.deltaTone === "loss"
                ? "text-down-500"
                : "text-fg-muted"
          )}
        >
          {displayDelta}
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      data-emphasis={cell.emphasis || undefined}
      className={cn(
        "flex flex-col justify-center gap-0.5 shrink-0 snap-start px-3 md:px-[22px]",
        cell.emphasis && "min-w-[220px]",
        !isLast && "border-r border-border-hair"
      )}
    >
      <span className="t-label uppercase tracking-wider text-fg-hint">
        {cell.label}
      </span>
      {cell.emphasis ? (
        <div aria-live="polite" aria-atomic="true">
          {inner}
        </div>
      ) : (
        inner
      )}
    </div>
  );
}
