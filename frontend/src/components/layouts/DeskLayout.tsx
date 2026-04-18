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

      <div
        data-slot="desk-main"
        className={cn(
          "min-h-0 overflow-x-hidden md:overflow-hidden bg-[var(--border)]",
          "grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_340px] gap-px"
        )}
      >
        <aside
          data-slot="desk-rail"
          className="hidden md:block min-h-0 overflow-auto bg-bg"
        >
          {rail}
        </aside>

        <section
          data-slot="desk-center"
          className="flex min-h-0 flex-col overflow-x-hidden md:overflow-hidden bg-bg"
        >
          {center}
        </section>

        <aside
          data-slot="desk-right"
          className="flex min-h-0 flex-col overflow-x-hidden lg:overflow-hidden bg-bg"
        >
          {right}
        </aside>
      </div>

      {statusBar}
    </div>
  );
}
