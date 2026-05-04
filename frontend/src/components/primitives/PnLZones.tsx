import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PnLZones — Tastytrade-style four-zone P&L preview.
 *
 * Phase-2 / FZ-1 (2026 design brief):
 *
 *   • Green zone   = profit region (price range where the trade is up)
 *   • Red zone     = loss region (where the trade is down)
 *   • Gray zone    = breakeven (within ±1% of breakeven price)
 *   • Brown band   = expected-move ±1σ derived from option IV
 *
 * Tastytrade's research finding: making "where do I make money?" and
 * "is the expected move inside or outside the profit zone?" *visually
 * glanceable* turned the platform from a power-user tool into a
 * defensible thesis-engine. AlphaDesk borrows the same encoding.
 *
 * Anatomy: a single horizontal strip with shaded bands behind, the
 * underlying-price tick on top (vertical line), and an italic caption
 * underneath ("Expected move ±$3.42 by Fri").
 *
 * Use as the hero visual on the trade ticket below the order-entry
 * fields. Size: 100% width × 32 px height by default.
 */

export interface PnLZonesProps {
  /** Current price of the underlying. Renders a tick on the strip. */
  underlying: number;
  /**
   * The price range the strip covers. Pick a sensible window from the
   * caller (e.g. underlying ± 2σ if you have IV, otherwise ±15%).
   */
  priceMin: number;
  priceMax: number;
  /**
   * Profit-zone bounds [low, high]. Inclusive. Anywhere the underlying
   * lands inside this range at expiration is a profitable outcome.
   */
  profitZone: [number, number] | null;
  /**
   * Optional breakeven price(s). For a credit spread there's typically
   * one BE; for a long straddle there are two (call BE, put BE). The
   * gray "breakeven" wash is rendered ±0.5% of each entry.
   */
  breakevens?: number[];
  /**
   * Expected move (1σ) shaded band, e.g. ``[underlying - 3.42, underlying + 3.42]``
   * for a $3.42 expected move. Renders the warm "expected-move" brown.
   */
  expectedMove?: [number, number];
  /** Optional caption below the strip — italic editorial. */
  caption?: string;
  /** Accessible label for screen readers. */
  label: string;
  className?: string;
}

export default function PnLZones({
  underlying,
  priceMin,
  priceMax,
  profitZone,
  breakevens,
  expectedMove,
  caption,
  label,
  className,
}: PnLZonesProps) {
  const range = priceMax - priceMin;
  if (range <= 0) return null;
  const pct = (price: number) =>
    Math.max(0, Math.min(100, ((price - priceMin) / range) * 100));

  const profitLeft = profitZone ? pct(profitZone[0]) : 0;
  const profitWidth = profitZone ? pct(profitZone[1]) - profitLeft : 0;
  const lossLeftLow = 0;
  const lossWidthLow = profitZone ? pct(profitZone[0]) : 100;
  const lossLeftHigh = profitZone ? pct(profitZone[1]) : 100;
  const lossWidthHigh = 100 - lossLeftHigh;

  const expectedLeft = expectedMove ? pct(expectedMove[0]) : 0;
  const expectedWidth = expectedMove ? pct(expectedMove[1]) - expectedLeft : 0;

  const underlyingPct = pct(underlying);

  return (
    <div
      data-slot="pnl-zones"
      role="img"
      aria-label={label}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <div className="relative h-8 w-full overflow-hidden rounded-sm border border-[color:var(--border)]">
        {/* Loss zones — render before profit so profit takes precedence
            on overlap (which shouldn't happen but defensive). */}
        {profitZone && lossWidthLow > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 bg-[color:var(--loss)]/35"
            style={{ left: `${lossLeftLow}%`, width: `${lossWidthLow}%` }}
          />
        )}
        {profitZone && lossWidthHigh > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 bg-[color:var(--loss)]/35"
            style={{ left: `${lossLeftHigh}%`, width: `${lossWidthHigh}%` }}
          />
        )}
        {!profitZone && (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[color:var(--loss)]/20"
          />
        )}
        {/* Profit zone */}
        {profitZone && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 bg-[color:var(--profit)]/40"
            style={{ left: `${profitLeft}%`, width: `${profitWidth}%` }}
          />
        )}
        {/* Expected-move band — Tastytrade signature. Brown ribbon
            sitting on top of the profit/loss zones at lower opacity
            so the layered semantics still read. */}
        {expectedMove && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 border-x border-dashed border-[color:var(--fg-strong)]/40 bg-[color:var(--brand)]/15"
            style={{ left: `${expectedLeft}%`, width: `${expectedWidth}%` }}
          />
        )}
        {/* Breakeven washes — gray verticals at each BE. */}
        {breakevens?.map((be) => {
          const beLeft = pct(be);
          // Width = 1% of the strip so the wash is a 4px gray rule.
          return (
            <span
              key={be}
              aria-hidden="true"
              className="absolute top-0 bottom-0 bg-[color:var(--fg-muted)]/40"
              style={{ left: `${Math.max(0, beLeft - 0.5)}%`, width: "1%" }}
            />
          );
        })}
        {/* Underlying-price tick — bold vertical line (the "you are here"). */}
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-[2px] bg-[color:var(--fg-strong)]"
          style={{ left: `calc(${underlyingPct}% - 1px)` }}
        />
      </div>
      {/* Scale labels */}
      <div className="flex items-center justify-between font-mono text-label text-[color:var(--fg-muted)]">
        <span>${priceMin.toFixed(2)}</span>
        <span className="font-display italic text-label text-[color:var(--fg-strong)]">
          ${underlying.toFixed(2)}
        </span>
        <span>${priceMax.toFixed(2)}</span>
      </div>
      {caption && (
        <p className="font-display italic text-label text-[color:var(--fg-muted)]">
          {caption}
        </p>
      )}
    </div>
  );
}
