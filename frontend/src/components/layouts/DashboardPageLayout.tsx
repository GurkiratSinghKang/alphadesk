"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import SectionRule from "@/components/typography/SectionRule";

/**
 * DashboardPageLayout (Layer 3 shell)
 * ───────────────────────────────────
 * Generic editorial shell for every non-desk dashboard route
 * (analytics, pipeline, reports, alerts, settings).
 *
 * Provides a consistent header:
 *   · tracked-caps Eyebrow ("§ ANALYTICS")
 *   · Newsreader italic Display title ("Portfolio analytics")
 *   · optional right-aligned actions slot
 *   · editorial hairline `<SectionRule />` below the header
 *
 * The children slot carries the page's own body — layout stays
 * opinion-free about internal spacing so existing panels keep working.
 * Max width 1280 matches the desk's center column comfort zone.
 */
export interface DashboardPageLayoutProps {
  /** Tracked-caps chapter tag rendered above the title, e.g. "§ ANALYTICS". */
  eyebrow: string;
  /** Italic-serif page title. */
  title: string;
  /** Optional right-aligned header slot for CTAs, status pills, filters. */
  actions?: React.ReactNode;
  /** Page body. */
  children: React.ReactNode;
  className?: string;
}

export default function DashboardPageLayout({
  eyebrow,
  title,
  actions,
  children,
  className,
}: DashboardPageLayoutProps) {
  return (
    <div
      data-slot="dashboard-page-layout"
      className={cn(
        "mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-8",
        className
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow as="div">{eyebrow}</Eyebrow>
          <Display size="md" as="h1">
            {title}
          </Display>
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </header>

      <SectionRule />

      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
