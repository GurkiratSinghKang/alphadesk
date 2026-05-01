import * as React from "react";

import { cn } from "@/lib/utils";
import Sparkline from "@/components/primitives/Sparkline";

/**
 * StrategyCard (composite)
 * ────────────────────────
 * Editorial card matching `components-cards.html`:
 *   · 2px left accent — brand for profit, coral for loss
 *   · italic-serif name
 *   · uppercase subtitle ("STRATEGY 01 · SWING")
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
  /**
   * BUG-055 — precise dollar value (e.g. "$4,923.17") rendered as a `title`
   * tooltip on the Invested cell. Optional; falls back to the abbreviated
   * ``invested`` string so the tooltip is always non-empty.
   */
  investedPrecise?: string;
  sparkline: number[];
  href: string;
  /**
   * BUG-028 — strategies without a backtest (Manual / Discretionary is
   * the canonical case: it's a ledger-backed bucket for user-initiated
   * trades, not a simulated strategy) should not render `—` for return /
   * win-rate, which reads like "no data yet" and hides the fact that
   * these metrics are *not applicable*. When true, the card renders an
   * explicit "No backtest — discretionary bucket" line instead of the
   * misleading return / win-rate row.
   */
  noBacktest?: boolean;
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
  investedPrecise,
  sparkline,
  href,
  noBacktest = false,
  className,
}: StrategyCardProps) {
  // Display at 2dp rounds `-0.003` → `0.00`; combined with the raw sign
  // of `returnPct` that rendered as "−0.00%", which is both visually
  // wrong (negative zero) and semantically wrong (a near-flat return
  // shouldn't read as a loss). Decide the sign from the *displayed*
  // magnitude so anything that rounds to 0.00 is formatted "+0.00%".
  const roundedAbs = Math.abs(returnPct);
  const roundedStr = roundedAbs.toFixed(2);
  const isDisplayedNegative = returnPct < 0 && parseFloat(roundedStr) !== 0;
  const sign = isDisplayedNegative ? "−" : "+";
  const toneClass = isLoss ? "text-down-500" : "text-up-500";
  const accentClass = isLoss ? "before:bg-down-500" : "before:bg-brand";
  // BUG-055 — positions-aware guard. An "Invested $4.9K · 0 positions" card
  // is a data contradiction: once all positions exit, cost basis has to be
  // $0. Force both the display and the precise tooltip to "$0" so the card
  // never contradicts itself even if the caller forgot to zero the prop.
  const displayInvested = positions === 0 ? "$0" : invested;
  const investedTooltip = positions === 0
    ? "$0.00"
    : (investedPrecise ?? invested);

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
            style={{ letterSpacing: 0 }}
          >
            {name}
          </div>
          <div
            className="font-sans font-semibold text-[12px] uppercase text-fg-muted mt-[3px]"
            style={{ letterSpacing: 0 }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      {noBacktest ? (
        <div
          className="font-display italic text-[16px] leading-tight text-fg-muted"
          style={{ letterSpacing: 0 }}
        >
          No backtest
          <span className="block font-sans not-italic text-[12px] mt-0.5 text-fg-hint">
            Discretionary bucket — P&amp;L tracked from trade ledger.
          </span>
        </div>
      ) : (
        <div
          className={cn(
            "font-mono tabular-nums text-[30px] font-light leading-none",
            toneClass
          )}
          style={{ letterSpacing: 0 }}
        >
          {sign}
          {roundedStr}%
        </div>
      )}

      {!noBacktest && (
        <Sparkline
          data={sparkline}
          tone={isLoss ? "loss" : "profit"}
          width={200}
          height={28}
          className="h-7"
        />
      )}

      <div className="flex justify-between font-mono text-[12px] text-fg-muted">
        <span>{positions} positions</span>
        {noBacktest ? (
          <span className="italic text-fg-hint">Manual trades</span>
        ) : (
          <span>
            Win <b className="text-fg font-medium">{winRatePct}%</b>
          </span>
        )}
        <span
          title={investedTooltip}
          aria-label={`Invested ${investedTooltip}`}
        >
          Invested <b className="text-fg font-medium">{displayInvested}</b>
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
        style={{ letterSpacing: 0 }}
      >
        open →
      </span>
    </a>
  );
}
