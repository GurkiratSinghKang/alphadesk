import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * EditorialNameplate (composite)
 * ──────────────────────────────
 * The masthead used on docs, marketing, and the design system README:
 *
 *   α · AlphaDesk · Vol. X · Issue Y · Title · Date
 *
 * Renders as a top-of-page band: big italic-serif wordmark on the left,
 * vol/issue/date metadata inline with `·` separators, tracked-caps title
 * on the right. Purely presentational.
 */
export interface EditorialNameplateProps {
  volume: string;
  issue: string;
  title: string;
  /** Pre-formatted date string. */
  date: string;
  className?: string;
}

export default function EditorialNameplate({
  volume,
  issue,
  title,
  date,
  className,
}: EditorialNameplateProps) {
  return (
    <header
      data-slot="editorial-nameplate"
      className={cn(
        "flex items-baseline gap-4 flex-wrap pb-4 border-b border-border-hair",
        className
      )}
    >
      <div
        className="flex items-baseline gap-1.5 font-display italic text-[32px] text-ink-1000"
        style={{ letterSpacing: "-0.02em", lineHeight: 1 }}
      >
        <span className="text-brand">α</span>
        <span>AlphaDesk</span>
      </div>

      <span
        className="font-display italic text-[14px] text-fg-muted"
        aria-hidden
      >
        ·
      </span>

      <span
        className="font-sans font-semibold text-[10.5px] uppercase text-fg-muted"
        style={{ letterSpacing: "0.18em" }}
      >
        Vol. {volume}
      </span>

      <span className="font-display italic text-[14px] text-fg-muted" aria-hidden>
        ·
      </span>

      <span
        className="font-sans font-semibold text-[10.5px] uppercase text-fg-muted"
        style={{ letterSpacing: "0.18em" }}
      >
        Issue {issue}
      </span>

      <span className="font-display italic text-[14px] text-fg-muted" aria-hidden>
        ·
      </span>

      <span
        className="font-display italic text-[15px] text-fg"
        style={{ letterSpacing: "-0.005em" }}
      >
        {title}
      </span>

      <span
        className="ml-auto font-mono text-[10.5px] text-fg-hint"
        style={{ letterSpacing: "0.05em" }}
      >
        {date}
      </span>
    </header>
  );
}
