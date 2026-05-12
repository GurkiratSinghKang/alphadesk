"use client";

import { useMemo } from "react";
import { useHydratedWatchlist, useQuotes } from "@/stores/market";
import { cn } from "@/lib/utils";

export function TickerTape() {
  // Iter 23: gate on the hydration flag so the ticker doesn't paint the
  // DEFAULT_WATCHLIST 10 mega-caps for ~200ms before the server reply
  // overwrites with the user's actual symbols. `useHydratedWatchlist`
  // returns both in one selector to avoid two subscriptions.
  const { symbols: watchlist, isHydrating } = useHydratedWatchlist();
  // Wave 14 perf-audit-r3 P0 #3: `useQuotes(watchlist)` shallow-compares the
  // returned map so this component rerenders only when one of the watchlist
  // symbols actually changes, not on every unrelated quote tick.
  const quotes = useQuotes(watchlist);

  const items = useMemo(() => {
    return watchlist
      .map((sym) => {
        const q = quotes[sym];
        if (!q || !q.last) return null;
        const change = q.change ?? 0;
        const changePct = q.changePct ?? 0;
        return { symbol: sym, price: q.last, change, changePct };
      })
      .filter(Boolean) as { symbol: string; price: number; change: number; changePct: number }[];
  }, [watchlist, quotes]);

  // Rules-of-hooks: both useMemos must be called unconditionally on every
  // render. An earlier version bailed with `if (items.length === 0) return null;`
  // BETWEEN the two useMemos — when the ticker was empty on one render and
  // populated on the next, React counted fewer hooks the first time and
  // threw error #310 ("Rendered more hooks than during the previous render")
  // across the whole dashboard layout. That was the root cause of the
  // strategy-detail harness regression post-R7.
  const tripled = useMemo(() => [...items, ...items, ...items], [items]);

  // Iter 23: render nothing while hydrating — the ticker's already an
  // optional bar, and a 1-row skeleton flickering for 200ms is noisier
  // than just waiting for real symbols. Once `hydrated` flips we either
  // render the marquee (if we have quote data) or stay null (if items
  // is empty), preserving the original empty-state behaviour.
  if (isHydrating || items.length === 0) return null;

  return (
    <div
      // a11y audit r3 — `role="marquee"` is deprecated and not an ARIA 1.2
      // role; AT engines either ignore it or flag a warning. Use region +
      // aria-live="off" so the ticker is a named landmark without being
      // read on every tick.
      role="region"
      aria-label="Market ticker"
      aria-live="off"
      className="overflow-hidden whitespace-nowrap border-b border-border/20 bg-[var(--background)]"
    >
      {/* Wave 29 persona-5 #7: WCAG 2.3.3 / respects prefers-reduced-motion —
          the marquee animation is motion, so pause for users that ask to
          reduce it. TickerStrip already does this; TickerTape was missing. */}
      <div className="animate-marquee motion-reduce:animate-none inline-flex gap-0 py-[3px]">
        {tripled.map((item, i) => {
          const up = item.change >= 0;
          return (
            <span
              key={`${item.symbol}-${i}`}
              className="inline-flex items-center gap-1.5 px-4 border-r border-border/10"
            >
              <span className="text-label font-semibold text-foreground">
                {item.symbol}
              </span>
              <span className="text-label tabular-nums text-foreground/80">
                ${item.price.toFixed(2)}
              </span>
              <span
                className={cn(
                  "text-label font-medium tabular-nums",
                  up ? "text-[var(--profit)]" : "text-[var(--loss)]"
                )}
              >
                {up ? "+" : ""}{item.change.toFixed(2)} ({up ? "+" : ""}{item.changePct.toFixed(2)}%)
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
