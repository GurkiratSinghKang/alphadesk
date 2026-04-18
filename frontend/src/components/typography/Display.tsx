import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Display
 * ───────
 * Newsreader italic display text. Thin semantic wrapper over the
 * `.t-display-*` classes defined in design-tokens.css. Use for hero
 * headlines, strategy names, pull quotes.
 *
 * Default heading level maps to size if `as` is not specified.
 */
export interface DisplayProps extends React.HTMLAttributes<HTMLElement> {
  size?: "xl" | "lg" | "md";
  as?: "h1" | "h2" | "h3" | "p" | "div" | "span";
  children: React.ReactNode;
}

const sizeClass: Record<NonNullable<DisplayProps["size"]>, string> = {
  xl: "t-display-xl",
  lg: "t-display-lg",
  md: "t-display-md",
};

const defaultTag: Record<NonNullable<DisplayProps["size"]>, DisplayProps["as"]> = {
  xl: "h1",
  lg: "h2",
  md: "h3",
};

export default function Display({
  size = "xl",
  as,
  className,
  children,
  ...rest
}: DisplayProps) {
  const Tag = (as ?? defaultTag[size] ?? "div") as React.ElementType;
  return (
    <Tag className={cn(sizeClass[size], className)} {...rest}>
      {children}
    </Tag>
  );
}
