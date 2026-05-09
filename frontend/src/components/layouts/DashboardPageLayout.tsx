"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DashboardPageLayout (Layer 3 shell)
 * ───────────────────────────────────
 * Generic workstation shell for every non-desk dashboard route
 * (analytics, pipeline, reports, alerts, settings).
 *
 * Provides a consistent command header:
 *   · tracked-caps route label ("§ ANALYTICS")
 *   · compact sans title for scan-heavy tools
 *   · optional right-aligned actions slot
 *   · dark elevated surface matching the trading desk chrome
 *
 * The children slot carries the page's own body. The wrapper stays compact
 * by default so trading and research pages can spend pixels on tools instead
 * of chrome.
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
  /**
   * v2 polish — pages that ship their own editorial italic-Newsreader hero
   * pass `hideHeader` so the chrome <header> doesn't stack above the hero.
   * The `<div role="region" aria-label>` landmark stays so screen readers
   * still get the page name; the `actions` slot is dropped (those pages
   * embed actions into their own hero).
   */
  hideHeader?: boolean;
}

export default function DashboardPageLayout({
  eyebrow,
  title,
  actions,
  children,
  className,
  pageLabel,
  hideHeader,
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
        "mx-auto flex w-full max-w-[1760px] 2xl:max-w-[1920px] flex-col gap-3 px-3 py-3 md:px-4 md:py-4",
        className
      )}
    >
      {hideHeader ? null : (
        <header className="relative overflow-hidden rounded-md border border-border-hair bg-bg-elev-1/88 px-3 py-3 shadow-[0_14px_42px_-34px_rgba(0,0,0,0.72)] md:px-4">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)] opacity-65"
          />
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="t-label uppercase tracking-wider text-primary/85">
                {eyebrow.replace("§ ", "")}
              </div>
              <h1
                className="mt-1 max-w-[32ch] break-words text-h2 font-semibold leading-tight tracking-tight text-ink-1000 md:max-w-none md:text-h1"
                style={{ letterSpacing: 0 }}
              >
                {title}
              </h1>
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>
            ) : null}
          </div>
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}
