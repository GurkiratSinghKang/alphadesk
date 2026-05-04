import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionRule
 * ───────────
 * Editorial section separator — a hairline `.u-rule` with an optional
 * tracked-caps tag above it (e.g. "§ 01 · Principles"). Used to open
 * chapters in marketing, docs, and the design preview page.
 *
 * QA r1 B1: the tag is now a real heading element (defaults to `h2`).
 * Previously it rendered as a `<span>`, which was invisible to screen-reader
 * heading navigation across all docs/legal pages. Pass `tagAs="div"` for
 * non-section uses where a heading would create a skipped level.
 */
export interface SectionRuleProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional tracked-caps tag above the hairline. */
  tag?: string;
  /** Element to render the tag as. Default `h2` (for proper heading nav). */
  tagAs?: "h2" | "h3" | "h4" | "div";
}

export default function SectionRule({
  tag,
  tagAs = "h2",
  className,
  ...rest
}: SectionRuleProps) {
  const TagEl = tagAs as React.ElementType;
  return (
    <div className={cn("flex flex-col gap-3", className)} {...rest}>
      {tag ? <TagEl className="t-label">{tag}</TagEl> : null}
      <span className="u-rule" aria-hidden />
    </div>
  );
}
