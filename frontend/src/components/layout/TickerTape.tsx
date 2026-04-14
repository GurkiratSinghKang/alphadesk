"use client";

import { useMarketStore } from "@/stores/market";

export function TickerTape() {
  const watchlist = useMarketStore((s) => s.watchlist);
  const quotes = useMarketStore((s) => s.quotes);

  // Build ticker items from watchlist quotes
  const items = watchlist
    .map((sym) => {
      const q = quotes[sym];
      if (!q) return null;
      return { symbol: sym, price: q.last, change: q.change, changePct: q.changePct };
    })
    .filter(Boolean) as { symbol: string; price: number; change: number; changePct: number }[];

  // Don't render if no quotes available yet
  if (items.length === 0) return null;

  // Duplicate items so the marquee loops seamlessly
  const doubled = [...items, ...items];

  return (
    <div role="marquee" aria-label="Live market ticker tape" className="overflow-hidden overflow-x-hidden whitespace-nowrap border-b border-border/30 bg-[var(--surface)] max-w-full">
      <div className="animate-marquee inline-flex gap-6 py-1 px-4 text-[11px] tabular-nums">
        {doubled.map((item, i) => (
          <span key={`${item.symbol}-${i}`} className="flex items-center gap-1">
            <span className="font-medium text-foreground">{item.symbol}</span>
            <span className="text-foreground">${(item.price ?? 0).toFixed(2)}</span>
            <span className={(item.change ?? 0) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"}>
              {(item.change ?? 0) >= 0 ? "\u25B2" : "\u25BC"}{(item.changePct ?? 0) >= 0 ? "+" : ""}{(item.changePct ?? 0).toFixed(2)}%
            </span>
            {i < doubled.length - 1 && <span className="text-border ml-2">|</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
