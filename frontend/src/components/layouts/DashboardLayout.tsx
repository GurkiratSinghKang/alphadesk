"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DashboardLayout (Layer 3 shell — dashboard redesign 2026-04-20)
 * ───────────────────────────────────────────────────────────────
 * Two-column grid that replaces the four-zone `DeskLayout` on the `/`
 * route. The strategies rail was the 260px left column on DeskLayout;
 * per Wave-3 owner feedback it's redundant with `/strategies` and was
 * eating viewport that should go to the chart. Same research pass
 * established a dense-pro density target (ToS / TWS / Webull) vs the
 * casual-retail density of `DeskLayout`'s original layout.
 *
 * Grid:
 *   rows     48 (topBar) / 36 (contextBar) / 1fr (main) / 22 (status)
 *   main     1fr / 388px — chart+ticket on the left, Book rail on right.
 *
 * Chart-side drawing-tools toolbar lives INSIDE the center column so the
 * chart can own its own vertical strip without spending a top-level grid
 * column on it.
 *
 * Reflow:
 *   - lg+ : 1fr | 388px (default above)
 *   - md  : 1fr | 340px — right rail narrows 48px to keep chart usable.
 *   - sm  : single column, right rail stacks below center and the outer
 *           scroll unlocks so a phone can scroll the whole page.
 */
export interface DashboardLayoutProps {
  /** 48px strip — TopBar composite. */
  topBar: React.ReactNode;
  /** 36px strip — ContextBar composite. */
  contextBar: React.ReactNode;
  /** Center column (1fr). Chart pane + OrderBar stacked vertically. */
  center: React.ReactNode;
  /** Right column (388px at lg+, 340px at md). Watchlist + Book + optional AI memo. */
  right: React.ReactNode;
  /** 22px strip — StatusBar composite. */
  statusBar: React.ReactNode;
  className?: string;
}

export default function DashboardLayout({
  topBar,
  contextBar,
  center,
  right,
  statusBar,
  className,
}: DashboardLayoutProps) {
  return (
    <div
      data-slot="dashboard-layout"
      className={cn(
        // iOS: 100dvh > 100vh — URL bar collapses dynamically and vh
        // freezes to the larger layout viewport, clipping the bottom row
        // on scroll. Same trick DeskLayout uses.
        "min-h-dvh md:h-dvh w-full overflow-x-hidden md:overflow-hidden bg-bg",
        "grid grid-rows-[48px_36px_1fr_22px]",
        className,
      )}
    >
      {topBar}
      {contextBar}

      <div
        data-slot="dashboard-main"
        className={cn(
          "min-h-0 overflow-x-hidden md:overflow-y-auto lg:overflow-hidden bg-[var(--border)]",
          // Mobile: single column. md: two columns with a slightly narrower
          // right rail. lg+: the full 388px rail.
          "grid grid-cols-1 md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_388px] gap-px",
          "grid-rows-[auto] md:grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-[1fr]",
        )}
      >
        <main
          id="main-content"
          data-slot="dashboard-center"
          aria-label="Trading chart and order ticket"
          tabIndex={-1}
          className={cn(
            "flex min-h-0 flex-col overflow-x-hidden md:overflow-hidden bg-bg",
            "md:row-start-1 md:col-start-1",
          )}
        >
          {center}
        </main>

        <aside
          data-slot="dashboard-right"
          aria-label="Watchlist and open positions"
          className={cn(
            "flex min-h-0 flex-col overflow-x-hidden lg:overflow-hidden bg-bg",
            // md: rejoin as 2nd column (full height). lg+ same.
            "md:row-start-1 md:col-start-2",
          )}
        >
          {right}
        </aside>
      </div>

      {statusBar}
    </div>
  );
}
