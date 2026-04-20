import * as React from "react";

import { cn } from "@/lib/utils";
import type { TickerEntry } from "./types";

/**
 * TickerStrip (composite · marketing marquee)
 * ───────────────────────────────────────────
 * SMOOTH infinite scroll using a CSS `@keyframes marquee` that translates
 * 50% so a single duplicated content block wraps seamlessly. The strip
 * defaults to paused (WCAG 2.2.2: continuously-animating content must be
 * pauseable). Pass `paused={false}` for marketing.
 *
 * Accessibility:
 *  - hover on the wrapper pauses the animation
 *  - respects `prefers-reduced-motion` — pauses permanently in that case
 *  - `aria-label` names the strip so screen readers announce it
 */
export interface TickerStripProps {
  tickers: TickerEntry[];
  /** When true, animation pauses. Defaults to true (accessibility-first). */
  paused?: boolean;
  /** Seconds per full 50% translate. Default 60s. */
  durationSec?: number;
  className?: string;
}

export default function TickerStrip({
  tickers,
  paused = true,
  durationSec = 60,
  className,
}: TickerStripProps) {
  // Duplicate the content once so the -50% translate loops seamlessly.
  const doubled = React.useMemo(
    () => [...tickers, ...tickers].map((t, i) => ({ ...t, _k: i })),
    [tickers]
  );

  if (tickers.length === 0) return null;

  return (
    <div
      data-slot="ticker-strip"
      // a11y audit r3 — `role="marquee"` is a deprecated HTML role that is
      // NOT part of ARIA 1.2. Replaced with `role="region"` + aria-label so
      // the strip is a named landmark. `aria-live="off"` because the ticker
      // updates too frequently to be announced politely.
      role="region"
      aria-label="Market ticker"
      aria-live="off"
      data-paused={paused || undefined}
      className={cn(
        // BUG-052 — `overflow-hidden` lets the marquee's transform paint
        // over the border in Safari's compositor. `overflow: clip` (via
        // the `overflow-clip` Tailwind util) hard-clips the animated
        // track to the element's padding-box, eliminating the 1px
        // bleed-through on the bottom border at hi-dpi.
        "overflow-clip whitespace-nowrap py-6 border-b border-border",
        "group/ticker",
        className
      )}
    >
      <style>{`
        @keyframes ad-marquee {
          from { transform: translate3d(0,0,0); }
          to   { transform: translate3d(-50%,0,0); }
        }
        [data-slot="ticker-strip"] > .ad-marquee-track {
          display: inline-flex;
          gap: 56px;
          min-width: 200%;
          animation: ad-marquee ${durationSec}s linear infinite;
          animation-play-state: running;
          will-change: transform;
        }
        [data-slot="ticker-strip"][data-paused] > .ad-marquee-track,
        [data-slot="ticker-strip"]:hover > .ad-marquee-track,
        [data-slot="ticker-strip"]:focus-within > .ad-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-slot="ticker-strip"] > .ad-marquee-track {
            animation-play-state: paused !important;
          }
        }
        /* BUG-052 pause marquee on touch devices where :hover never fires */
        @media (hover: none), (pointer: coarse) {
          [data-slot="ticker-strip"] > .ad-marquee-track {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <div className="ad-marquee-track">
        {doubled.map((t) => {
          // Sign the formatted magnitude, not the raw delta, so a value
          // like -0.004 (which rounds to "0.00") doesn't ticker as
          // "−0.00%". Preserves the down-colour only when the displayed
          // digits are actually non-zero.
          const absStr = Math.abs(t.deltaPct).toFixed(2);
          const isDown = t.deltaPct < 0 && parseFloat(absStr) !== 0;
          const sign = isDown ? "−" : "+";
          return (
            <span
              key={`${t.symbol}-${t._k}`}
              className="font-mono text-[12px] text-fg-muted inline-flex items-baseline gap-2"
              style={{ letterSpacing: "0.03em" }}
            >
              <span>{t.symbol}</span>
              <b className="text-fg font-medium">{t.price}</b>
              <span className={isDown ? "text-down-500" : "text-up-500"}>
                {sign}
                {absStr}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
