"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface LimitationsSectionProps {
  items: string[];
  className?: string;
}

/**
 * LimitationsSection
 * ──────────────────
 * Editorial bulleted list with an amber vertical accent on the left edge
 * to signal caution without using a tonal background. Items render in
 * italic serif to match the rest of the strategy page's voice.
 */
export default function LimitationsSection({
  items,
  className,
}: LimitationsSectionProps) {
  if (!items || items.length === 0) return null;
  return (
    <ul
      className={cn(
        "flex flex-col gap-3 border-l-2 border-amber/60 pl-5",
        className
      )}
    >
      {items.map((it, i) => (
        <li
          key={i}
          className="font-display italic text-[15px] leading-relaxed text-fg-dim"
        >
          {it}
        </li>
      ))}
    </ul>
  );
}
