"use client";

import * as React from "react";
import { Menu as MenuIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";

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
 *
 * Mobile rail access (persona-99, Wave 4S)
 * ───────────────────────────────────────
 * Below the md breakpoint the left rail is display:none to free the viewport
 * for chart + order ticket. Without an alternative, mobile users can't
 * switch strategies. We render a hamburger trigger overlaid on the 38px
 * ContextBar strip (mobile-only) that opens a left-side drawer containing
 * the same `rail` node. Desktop (md+) keeps the inline rail unchanged —
 * the trigger is hidden via `md:hidden`.
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
  const [mobileRailOpen, setMobileRailOpen] = React.useState(false);

  // Close the drawer automatically when the user selects a row in the rail.
  // StrategyRail doesn't know whether its host is a drawer or an inline
  // aside, so we intercept clicks inside the drawer body and close when the
  // click originated on a row button. Header buttons (e.g. the Sheet close
  // button) live outside the rail container, so they don't retrigger this.
  const handleDrawerClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Rail rows are rendered inside `<aside data-slot="strategy-rail"> ul li button`.
      const button = target.closest("button");
      if (!button) return;
      const rail = button.closest('[data-slot="strategy-rail"]');
      if (rail) setMobileRailOpen(false);
    },
    []
  );

  return (
    <div
      data-slot="desk-layout"
      className={cn(
        // iOS: 100dvh > 100vh — URL bar collapses dynamically and vh freezes
        // to the larger layout viewport, clipping the bottom row on scroll.
        "min-h-dvh md:h-dvh w-full overflow-x-hidden md:overflow-hidden bg-bg",
        "grid grid-rows-[48px_38px_1fr_22px]",
        className
      )}
    >
      {topBar}

      {/* The contextBar cell carries a mobile-only hamburger overlay in the
          left gutter. We wrap the caller-provided context bar with a relative
          positioning context, then absolute-position the trigger on top. This
          avoids the trigger affecting desktop layout at all. */}
      <div className="relative">
        {contextBar}
        <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
          <SheetTrigger
            aria-label="Open strategies menu"
            className={cn(
              // Mobile only — desk grid already shows the rail at md+.
              "md:hidden absolute left-1 top-1/2 -translate-y-1/2 z-20",
              "inline-flex items-center justify-center",
              // WCAG 2.5.5: 44×44 tap target.
              "min-h-11 min-w-11 rounded-sm",
              "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <MenuIcon className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent
            side="left"
            data-slot="desk-rail-drawer"
            className="p-0 flex flex-col"
            onClickCapture={handleDrawerClick}
          >
            <SheetHeader>
              <SheetTitle>Strategies</SheetTitle>
              <SheetDescription>
                Pick a strategy to switch the desk focus.
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-auto">{rail}</div>
          </SheetContent>
        </Sheet>
      </div>

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
