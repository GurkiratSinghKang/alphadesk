import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DeskLayout (Layer 3 shell)
 * ──────────────────────────
 * The 4-row editorial workstation shell that hosts the Layer-2 desk
 * composites. Pure slot composition — takes no data, runs no effects.
 *
 * Grid:
 *   rows    : 48px (topBar) / 38px (contextBar) / 1fr (main) / 22px (status)
 *   main    : 260px / 1fr / 340px columns, gap 1px with border bg so
 *             gaps read as hairline separators.
 *
 * Responsibility boundary:
 *   - parent (page) wires stores/queries and shapes props for composites,
 *   - composites carry styling for their cells,
 *   - this shell only guarantees the grid matches the kit.
 */
export interface DeskLayoutProps {
  /** 48px strip — TopBar composite goes here. */
  topBar: React.ReactNode;
  /** 38px strip — ContextBar composite goes here. */
  contextBar: React.ReactNode;
  /** Left column (260px). StrategyRail composite. */
  rail: React.ReactNode;
  /** Center column (1fr). Typically PriceChartPanel + OrderBar stacked. */
  center: React.ReactNode;
  /** Right column (340px). Typically PositionsList + AIMemoPanel stacked. */
  right: React.ReactNode;
  /** 22px strip — StatusBar composite goes here. */
  statusBar: React.ReactNode;
  className?: string;
}

export default function DeskLayout({
  topBar,
  contextBar,
  rail,
  center,
  right,
  statusBar,
  className,
}: DeskLayoutProps) {
  return (
    <div
      data-slot="desk-layout"
      className={cn(
        "min-h-screen md:h-screen w-full overflow-x-hidden md:overflow-hidden bg-bg",
        "grid grid-rows-[48px_38px_1fr_22px]",
        className
      )}
    >
      {topBar}
      {contextBar}

      {/* Viewport audit r5 #1: at md (768-1023) the previous grid declared
          only 2 columns, so <desk-right> became an orphan that flowed into
          an implicit row and was clipped by md:overflow-hidden. Option A:
          declare explicit rows so right-content stacks under the center
          column at md, and sits in the 3rd column at lg+. At md the main
          region needs to scroll vertically since right-content stacks below
          chart (outer shell is md:h-screen); at lg+ we restore the
          viewport-locked overflow:hidden so the desk remains non-scrolling. */}
      <div
        data-slot="desk-main"
        className={cn(
          "min-h-0 overflow-x-hidden md:overflow-y-auto lg:overflow-hidden bg-[var(--border)]",
          "grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_340px] gap-px",
          "grid-rows-[auto] md:grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-[1fr]"
        )}
      >
        <aside
          data-slot="desk-rail"
          className="hidden md:block min-h-0 overflow-auto bg-bg md:row-start-1 md:col-start-1 lg:row-span-1"
        >
          {rail}
        </aside>

        {/* a11y audit r3 — WCAG 2.4.1 / 1.3.1 / 4.1.2: the flagship desk
            route had no <main> landmark; wrapped the center column here so
            the skip-link target (#main-content) lands on a proper landmark
            and SR users can jump straight to the chart/order ticket. */}
        <main
          id="main-content"
          data-slot="desk-center"
          aria-label="Trading chart and order ticket"
          tabIndex={-1}
          className="flex min-h-0 flex-col overflow-x-hidden md:overflow-hidden bg-bg md:row-start-1 md:col-start-2"
        >
          {center}
        </main>

        <aside
          data-slot="desk-right"
          className={cn(
            "flex min-h-0 flex-col overflow-x-hidden lg:overflow-hidden bg-bg",
            // md (768-1023): stacks full-width under the 2-col rail+center
            // lg+: rejoins the 3rd column of the grid.
            "md:row-start-2 md:col-start-1 md:col-span-2",
            "lg:row-start-1 lg:col-start-3 lg:col-span-1"
          )}
        >
          {right}
        </aside>
      </div>

      {statusBar}
    </div>
  );
}
