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
 *   main     1fr / 388px — command center on the left, insight rail on right.
 *
 * Charting and execution now live on `/trade`; the root route is the
 * graphless operating dashboard.
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
  /** Center column (1fr). Account/risk/strategy command center. */
  center: React.ReactNode;
  /** Right column (388px at lg+). Briefing, watchlist, book, optional AI memo. */
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
        "alpha-auth-shell min-h-dvh md:h-dvh w-full overflow-x-hidden md:overflow-hidden bg-bg",
        // Round-8 killer-move 1: ContextBar grew 36→56px to host the
        // promoted Book Equity hero (28px display). The other 3 rows
        // (TopBar 48, main 1fr, StatusBar 22) are unchanged.
        "grid grid-cols-[minmax(0,1fr)] grid-rows-[48px_56px_1fr_22px]",
        className,
      )}
    >
      {topBar}
      {contextBar}

      <div
        data-slot="dashboard-main"
        className={cn(
          "min-h-0 min-w-0 w-full overflow-x-hidden md:overflow-y-auto lg:overflow-hidden bg-border/80",
          // Round-10 / X-5 (P0): previously ``md:grid-cols-[1fr_340px]``
          // forced iPad Air portrait (820 px) into a side-by-side layout
          // — the chart got squeezed to ~430 px which barely cleared its
          // ``min-h-[360px]`` and the OrderBar fields collapsed onto one
          // unreadable line. iPad portrait now stays single-column
          // (chart on top, rail beneath) and the side-by-side kicks in
          // only at ``lg`` (1024+). lg+ still gets the full 388 px rail.
          "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_388px] gap-px",
          "grid-rows-[auto] lg:grid-rows-[1fr]",
        )}
      >
        <main
          id="main-content"
          data-slot="dashboard-center"
          aria-label="Dashboard command center"
          tabIndex={-1}
          className={cn(
            "relative z-0 flex min-h-0 min-w-0 flex-col overflow-x-hidden md:overflow-hidden bg-bg",
            "md:row-start-1 md:col-start-1",
          )}
        >
          {center}
        </main>

        <aside
          data-slot="dashboard-right"
          aria-label="Dashboard insight rail"
          className={cn(
            "relative z-0 flex min-h-0 min-w-0 flex-col overflow-x-hidden lg:overflow-hidden bg-bg",
            // Rejoin as the 2nd column only once the parent grid actually
            // switches to two columns. At md widths the layout is intentionally
            // single-column; placing the aside at md:col-start-2 creates an
            // implicit off-screen column on tablets.
            "lg:row-start-1 lg:col-start-2",
          )}
        >
          {right}
        </aside>
      </div>

      {statusBar}
    </div>
  );
}
