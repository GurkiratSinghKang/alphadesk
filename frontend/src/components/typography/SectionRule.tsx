import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionRule
 * ───────────
 * Editorial section separator — a hairline `.u-rule` with an optional
 * tracked-caps tag above it (e.g. "§ 01 · Principles"). Used to open
 * chapters in marketing, docs, and the design preview page.
 */
export interface SectionRuleProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional tracked-caps tag above the hairline. */
  tag?: string;
}

export default function SectionRule({
  tag,
  className,
  ...rest
}: SectionRuleProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)} {...rest}>
      {tag ? <span className="t-label">{tag}</span> : null}
      <span className="u-rule" aria-hidden />
    </div>
  );
}
