"use client";

import * as React from "react";

import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";

export interface SignalSectionProps {
  thesis: string;
  edge?: string;
  howItWorks?: string[];
  className?: string;
}

/**
 * SignalSection
 * ─────────────
 * Renders the strategy thesis (editorial 2-col prose when long) and an
 * ordered list of mechanics. All pulled from `strategy-content.ts`.
 */
export default function SignalSection({
  thesis,
  edge,
  howItWorks,
  className,
}: SignalSectionProps) {
  const paragraphs = thesis.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const twoCol = paragraphs.length >= 2;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div
        className={cn(
          "grid gap-6",
          twoCol ? "md:grid-cols-2" : "md:grid-cols-1"
        )}
      >
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="font-display italic text-[15.5px] leading-relaxed text-fg"
          >
            {p}
          </p>
        ))}
      </div>

      {edge ? (
        <div className="rounded-md border-l-2 border-brand bg-bg-elev-1 py-3 pl-4 pr-4">
          <p className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.18em" }}>
            Edge
          </p>
          <p className="mt-1 font-display italic text-[15px] text-fg">
            {edge}
          </p>
        </div>
      ) : null}

      {howItWorks && howItWorks.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-3">
          {howItWorks.map((step, i) => (
            <li
              key={i}
              className="flex gap-4 border-b border-border-hair pb-3 last:border-0"
            >
              <Mono className="pt-0.5 text-[12px] text-fg-hint">
                {String(i + 1).padStart(2, "0")}
              </Mono>
              <p className="font-sans text-[13.5px] leading-relaxed text-fg-dim">
                {step}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
