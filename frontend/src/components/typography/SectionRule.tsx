import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionRule
 * ───────────
 * Editorial section separator — a hairline `.u-rule` with an optional
 * tracked-caps tag above it (e.g. "§ 01 · Principles"). Used to open
 * chapters in marketing, docs, and the design preview page.
 *
 * QA r1 B1: the tag was promoted to a real heading element to fix
 * screen-reader navigation. However, defaulting to `h2` caused a WCAG
 * 1.3.1 hierarchy bug across docs/legal/about/privacy/terms/risk: every
 * visual eyebrow rendered as `<h2>`, polluting the heading outline.
 *
 * Batch F (P1-12): default is now `div` (visual eyebrow only). Pass
 * `tagAs="h2"` explicitly at top-level section opens where the eyebrow
 * IS the section's semantic heading. Use `className="t-h2"` on the
 * SectionRule to upgrade visual styling when promoting to a real h2 —
 * the wrapper passes className through to the outer flex container.
 */
export interface SectionRuleProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional tracked-caps tag above the hairline. */
  tag?: string;
  /** Element to render the tag as. Default `div` — pass `"h2"` for
   *  semantic page-section opens (top-level chapter headings). */
  tagAs?: "h2" | "h3" | "h4" | "div";
}

export default function SectionRule({
  tag,
  tagAs = "div",
  className,
  ...rest
}: SectionRuleProps) {
  const TagEl = tagAs as React.ElementType;
  return (
    <div className={cn("flex flex-col gap-3", className)} {...rest}>
      {tag ? <TagEl className="t-label uppercase tracking-wider">{tag}</TagEl> : null}
      <span className="u-rule" aria-hidden />
    </div>
  );
}
