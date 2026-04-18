"use client";

import * as React from "react";

import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";

/**
 * StrategyHero
 * ────────────
 * Editorial hero header for `strategies/[id]`. Eyebrow "STRATEGY · {category}",
 * Newsreader italic strategy name, optional italic-serif sub-line description,
 * right-aligned 4-cell metric plate. Purely presentational.
 */
export interface MetricCell {
  label: string;
  /** Pre-formatted value. Pass `null` or the em-dash to render the awaiting state. */
  value: string | null;
  /** Optional tone override — defaults to neutral. */
  tone?: "profit" | "loss" | "neutral";
}

export interface StrategyHeroProps {
  categoryLabel: string;
  name: string;
  description?: string | null;
  cells: MetricCell[];
  className?: string;
}

function toneClass(tone: MetricCell["tone"]): string {
  if (tone === "profit") return "text-profit";
  if (tone === "loss") return "text-loss";
  return "text-fg";
}

export default function StrategyHero({
  categoryLabel,
  name,
  description,
  cells,
  className,
}: StrategyHeroProps) {
  return (
    <header
      data-slot="strategy-hero"
      className={cn(
        "flex flex-col gap-8 border-b border-border-hair pb-8 lg:flex-row lg:items-start lg:justify-between",
        className
      )}
    >
      <div className="flex max-w-[640px] flex-col gap-3">
        <Eyebrow as="div">{`STRATEGY \u00b7 ${categoryLabel}`}</Eyebrow>
        <Display size="lg" as="h1">
          {name}
        </Display>
        {description ? (
          <p className="font-display italic text-[16px] leading-snug text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:gap-x-10">
        {cells.map((c) => {
          const empty = c.value == null || c.value === "\u2014" || c.value === "—";
          return (
            <div
              key={c.label}
              className="flex flex-col gap-1 border-l border-border-hair pl-4"
            >
              <dt>
                <Eyebrow as="span">{c.label}</Eyebrow>
              </dt>
              <dd>
                {empty ? (
                  <span className="font-display italic text-[15px] text-fg-hint">
                    &mdash;
                  </span>
                ) : (
                  <Mono size="display" className={cn(toneClass(c.tone))}>
                    {c.value}
                  </Mono>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </header>
  );
}
