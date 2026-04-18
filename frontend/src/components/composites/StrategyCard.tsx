import * as React from "react";

import { cn } from "@/lib/utils";
import Sparkline from "@/components/primitives/Sparkline";

/**
 * StrategyCard (composite)
 * ────────────────────────
 * Editorial card matching `components-cards.html`:
 *   · 2px left accent — brand for profit, coral for loss
 *   · italic-serif name
 *   · tracked-caps subtitle ("STRATEGY 01 · SWING")
 *   · mono return (30px, 300 weight, sign-colored)
 *   · small 28px sparkline
 *   · meta row: positions · win rate · invested
 *   · reveals "open →" arrow on hover
 *
 * Used on the marketing strategy grid AND the dashboard home.
 * Anchors are semantic — clicking the card navigates.
 */
export interface StrategyCardProps {
  name: string;
  subtitle: string;
  returnPct: number;
  /** Controls accent tone + sign color. */
  isLoss: boolean;
  positions: number;
  winRatePct: number;
  /** Already formatted, e.g. "$18.2K". */
  invested: string;
  sparkline: number[];
  href: string;
  className?: string;
}

export default function StrategyCard({
  name,
  subtitle,
  returnPct,
  isLoss,
  positions,
  winRatePct,
  invested,
  sparkline,
  href,
  className,
}: StrategyCardProps) {
  const sign = returnPct >= 0 ? "+" : "−";
  const toneClass = isLoss ? "text-down-500" : "text-up-500";
  const accentClass = isLoss ? "before:bg-down-500" : "before:bg-brand";

  return (
    <a
      data-slot="strategy-card"
      href={href}
      className={cn(
        "group/strat relative overflow-hidden flex flex-col gap-2.5",
        "bg-bg-card border border-border rounded-md p-4",
        "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px]",
        "transition-colors transition-transform duration-150",
        "hover:bg-bg-elev-1 hover:border-border-strong hover:-translate-y-[1px]",
        "hover:before:w-[3px]",
        accentClass,
        className
      )}
    >
      <div className="flex justify-between items-start gap-2.5">
        <div>
          <div
            className="font-display italic text-[18px] text-ink-1000 leading-[1.1]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {name}
          </div>
          <div
            className="font-sans font-semibold text-[10px] uppercase text-fg-muted mt-[3px]"
            style={{ letterSpacing: "0.14em" }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "font-mono tabular-nums text-[30px] font-light leading-none",
          toneClass
        )}
        style={{ letterSpacing: "-0.02em" }}
      >
        {sign}
        {Math.abs(returnPct).toFixed(2)}%
      </div>

      <Sparkline
        data={sparkline}
        tone={isLoss ? "loss" : "profit"}
        width={200}
        height={28}
        className="h-7"
      />

      <div className="flex justify-between font-mono text-[10.5px] text-fg-muted">
        <span>{positions} positions</span>
        <span>
          Win <b className="text-fg font-medium">{winRatePct}%</b>
        </span>
        <span>
          Invested <b className="text-fg font-medium">{invested}</b>
        </span>
      </div>

      <span
        aria-hidden
        className={cn(
          "absolute right-3.5 bottom-3 font-display italic text-[13px] text-brand",
          "opacity-0 -translate-x-1.5 pointer-events-none",
          "transition-all duration-200",
          "group-hover/strat:opacity-100 group-hover/strat:translate-x-0"
        )}
        style={{ letterSpacing: "-0.01em" }}
      >
        open →
      </span>
    </a>
  );
}
