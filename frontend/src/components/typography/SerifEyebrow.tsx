import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SerifEyebrow
 * ────────────
 * Italic-serif gold eyebrow — the alternative to `<Eyebrow>`, used above
 * hero slides and marketing section leads. Wraps `.t-eyebrow-italic`.
 */
export interface SerifEyebrowProps extends React.HTMLAttributes<HTMLElement> {
  as?: "span" | "div" | "p";
  children: React.ReactNode;
}

export default function SerifEyebrow({
  as = "span",
  className,
  children,
  ...rest
}: SerifEyebrowProps) {
  const Tag = as as React.ElementType;
  return (
    <Tag className={cn("t-eyebrow-italic", className)} {...rest}>
      {children}
    </Tag>
  );
}
