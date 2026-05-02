"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DashboardPageLayout (Layer 3 shell)
 * ───────────────────────────────────
 * Generic editorial shell for every non-desk dashboard route
 * (analytics, pipeline, reports, alerts, settings).
 *
 * Provides a consistent command header:
 *   · tracked-caps route label ("§ ANALYTICS")
 *   · compact sans title for scan-heavy tools
 *   · optional right-aligned actions slot
 *   · dark elevated surface matching the trading desk chrome
 *
 * The children slot carries the page's own body — layout stays
 * opinion-free about internal spacing so existing panels keep working.
 * Max width 1280 matches the desk's center column comfort zone.
 */
export interface DashboardPageLayoutProps {
  /** Tracked-caps chapter tag rendered above the title, e.g. "§ ANALYTICS". */
  eyebrow: string;
  /** Page title. */
  title: string;
  /** Optional right-aligned header slot for CTAs, status pills, filters. */
  actions?: React.ReactNode;
  /** Page body. */
  children: React.ReactNode;
  className?: string;
  /**
   * B-89 — Accessible name for the page region. Screen readers announce this
   * when the user enters the page content. Falls back to `title` if omitted.
   * Prefer a short noun phrase (e.g. "Earnings options play") over the
   * editorial title ("This week · next week") so SR users get context.
   */
  pageLabel?: string;
}

export default function DashboardPageLayout({
  eyebrow,
  title,
  actions,
  children,
  className,
  pageLabel,
}: DashboardPageLayoutProps) {
  return (
    /* B-89 — WCAG 2.4.1 / 4.1.2: give the page content an accessible
       named landmark. The parent `(dashboard)/layout.tsx` already renders
       the single `<main id="main-content">`, so wrapping here in another
       `<main>` would produce nested mains (SC 4.1.2 violation). Instead we
       emit `role="region"` with an aria-label — this adds a named landmark
       the screen-reader rotor can jump to without duplicating `<main>`. */
    <div
      data-slot="dashboard-page-layout"
      role="region"
      aria-label={pageLabel ?? title}
      className={cn(
        // Viewport audit r5 #2: the previous 1280px cap wasted 33-50% of the
        // viewport on 1920+/ultrawide monitors (common for quant research).
        // Comfortable reading width on 1440 laptop + use more pixels on 4K.
        "mx-auto flex w-full max-w-[1480px] 2xl:max-w-[1680px] flex-col gap-5 px-4 py-5 md:px-6 md:py-7",
        className
      )}
    >
      <header className="relative overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/85 px-4 py-4 shadow-[0_18px_60px_-44px_rgba(0,0,0,0.72)] md:px-5">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)] opacity-75"
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="t-label text-brand/85">{eyebrow.replace("§ ", "")}</div>
            <h1
              className="mt-2 truncate text-[26px] font-semibold leading-[1.04] tracking-tight text-ink-1000 md:text-[32px]"
              style={{ letterSpacing: 0 }}
            >
              {title}
            </h1>
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
