import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Section
 * ────────
 * v2 redesign — recurring identity band used at the top of every
 * page and as the standard heading for any composed surface (Hero,
 * RegimePanel, ControlModule groups, BackendKeys, RuntimeControls,
 * etc.). Pairs an italic Newsreader display title with a tracked-caps
 * eyebrow + optional right-aligned action slot, and an optional
 * hairline rule below.
 *
 * The italic display + brand eyebrow combination is THE editorial
 * signature of v2 — every Phase 1 page composes it.
 *
 * Voice: declarative, sentence case for h2 / h1; ALL CAPS for the
 * eyebrow with brand color.
 */
export type SectionLevel = 1 | 2;

export interface SectionProps {
  /** Tracked-caps eyebrow above the title (rendered in brand). */
  eyebrow?: string;
  /** Italic Newsreader display title. */
  title: string;
  /** Optional one-line description rendered below the title (italic, dim). */
  description?: string;
  /** Right-aligned slot for actions, filters, count chips, etc. */
  right?: React.ReactNode;
  /**
   * Heading level — `1` uses the larger display ladder for page-top
   * Sections; `2` (default) uses the section-level display.
   */
  level?: SectionLevel;
  /**
   * Whether to render a hairline rule below the heading. Default true.
   * Set to false when stacking multiple Sections in a single card.
   */
  rule?: boolean;
  /** Body content rendered below the heading + rule. */
  children?: React.ReactNode;
  className?: string;
  /** Optional className for the inner heading row. */
  headerClassName?: string;
  /** Optional className for the body wrapper. */
  bodyClassName?: string;
}

/**
 * Renders the editorial identity band: eyebrow + display title +
 * optional description on the left, right slot inline. The display
 * is italic Newsreader at level-2, scaled larger at level-1.
 */
export default function Section({
  eyebrow,
  title,
  description,
  right,
  level = 2,
  rule = true,
  children,
  className,
  headerClassName,
  bodyClassName,
}: SectionProps) {
  const titleClass =
    level === 1
      ? "font-display italic text-display-md text-fg leading-[1.1]"
      : "font-display italic text-section-display text-fg";

  return (
    <section
      data-slot="section"
      data-level={level}
      className={cn("flex flex-col gap-3", className)}
    >
      <header
        className={cn(
          "flex items-end justify-between gap-4 flex-wrap",
          headerClassName,
        )}
      >
        <div className="min-w-0 flex flex-col gap-1">
          {eyebrow && (
            <span
              className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-brand"
              data-slot="section-eyebrow"
            >
              {eyebrow}
            </span>
          )}
          <h2 className={titleClass} data-slot="section-title">
            {title}
          </h2>
          {description && (
            <p className="font-display italic text-body-sm text-fg-muted">
              {description}
            </p>
          )}
        </div>
        {right && (
          <div className="shrink-0 flex items-center gap-2" data-slot="section-right">
            {right}
          </div>
        )}
      </header>
      {rule && (
        <hr
          aria-hidden
          className="h-px border-0 bg-gradient-to-r from-border to-transparent from-[88px] m-0"
          data-slot="section-rule"
        />
      )}
      {children && (
        <div className={cn("flex flex-col gap-3", bodyClassName)} data-slot="section-body">
          {children}
        </div>
      )}
    </section>
  );
}
