import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Eyebrow
 * ───────
 * The signature tracked-caps metadata label. Thin wrapper over `.t-label`.
 * Render as `<span>` inside inline contexts, or `<div>` for block labels
 * above fields, lists, and section headers.
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
    <Tag className={cn("t-label", className)} {...rest}>
      {children}
    </Tag>
  );
}
