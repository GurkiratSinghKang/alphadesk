"use client";

import { useMemo } from "react";
import { useMarketStore, useQuotes } from "@/stores/market";
import { cn } from "@/lib/utils";

export function TickerTape() {
  const watchlist = useMarketStore((s) => s.watchlist);
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

  if (items.length === 0) return null;

  // Triple for seamless loop
  const tripled = useMemo(() => [...items, ...items, ...items], [items]);

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
      <div className="animate-marquee inline-flex gap-0 py-[3px]">
        {tripled.map((item, i) => {
          const up = item.change >= 0;
          return (
            <span
              key={`${item.symbol}-${i}`}
              className="inline-flex items-center gap-1.5 px-4 border-r border-border/10"
            >
              <span className="text-[11px] font-semibold text-foreground">
                {item.symbol}
              </span>
              <span className="text-[11px] tabular-nums text-foreground/80">
                ${item.price.toFixed(2)}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium tabular-nums",
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
