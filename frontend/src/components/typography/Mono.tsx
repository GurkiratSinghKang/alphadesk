import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Mono
 * ────
 * Tabular JetBrains Mono span — the required font for every number,
 * timestamp, and ticker in AlphaDesk. Thin wrapper over `.t-mono` plus
 * optional size variants (`.t-mono-micro`, `.t-num-display`).
 */
export type MonoSize = "micro" | "hint" | "body" | "display";

export interface MonoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: MonoSize;
  children: React.ReactNode;
}

const sizeClass: Record<MonoSize, string> = {
  micro: "t-mono-micro",
  hint: "text-[12px]",
  body: "text-[13px]",
  display: "t-num-display",
};

export default function Mono({
  size = "body",
  className,
  children,
  ...rest
}: MonoProps) {
  return (
    <span className={cn("t-mono", sizeClass[size], className)} {...rest}>
      {children}
    </span>
  );
}
