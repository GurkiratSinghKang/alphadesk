import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Eyebrow
 * ───────
 * The signature tracked-caps metadata label. Thin wrapper over `.t-label`.
 * Render as `<span>` inside inline contexts, or `<div>` for block labels
 * above fields, lists, and section headers.
 *
 * P2-18: `.t-label` no longer force-casts uppercase (broke voice-control /
 * SR output where aria-label said "Submit order" but visible text was
 * "SUBMIT ORDER"). The Eyebrow primitive opts back into uppercase tracked
 * caps explicitly so existing eyebrow sites keep their design intent —
 * the source remains sentence-case and screen readers hear that, while
 * sighted users see the tracked all-caps treatment.
 */
export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  as?: "span" | "div" | "p";
  children: React.ReactNode;
}

export default function Eyebrow({
  as = "span",
  className,
  children,
  ...rest
}: EyebrowProps) {
  const Tag = as as React.ElementType;
  return (
    <Tag className={cn("t-label uppercase tracking-wider", className)} {...rest}>
      {children}
    </Tag>
  );
}
