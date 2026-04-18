import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import type { Quote } from "@/types";

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "SPY", "QQQ", "META", "AMD"];

interface MarketState {
  quotes: Record<string, Quote>;
  watchlist: string[];
  selectedSymbol: string;

  setSelectedSymbol: (symbol: string) => void;
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  updateQuote: (quote: Quote) => void;
  updateQuotes: (quotes: Quote[]) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set) => ({
      quotes: {},
      watchlist: DEFAULT_WATCHLIST,
      selectedSymbol: "SPY",

      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

      addToWatchlist: (symbol) =>
        set((state) => {
          const upper = symbol.toUpperCase();
          if (state.watchlist.includes(upper)) return state;
          return { watchlist: [...state.watchlist, upper] };
        }),

      removeFromWatchlist: (symbol) =>
        set((state) => ({
          watchlist: state.watchlist.filter((s) => s !== symbol),
        })),

      updateQuote: (quote) =>
        set((state) => {
          const existing = state.quotes[quote.symbol];
          if (!existing) {
            // First time seeing this symbol — store as-is
            return { quotes: { ...state.quotes, [quote.symbol]: { ...quote } } };
          }
          // Merge but PRESERVE snapshot fields that WebSocket doesn't carry.
          // WebSocket only sends: symbol, bid, ask, last, volume, timestamp.
          // Snapshot provides: close, open, high, low, change, changePct.
          const merged = {
            ...existing,
            ...quote,
            close: existing.close || quote.close,
            open: existing.open || quote.open,
            high: Math.max(existing.high || 0, quote.high || 0) || existing.high,
            low: (existing.low && quote.low) ? Math.min(existing.low, quote.low) : existing.low || quote.low,
          };
          // Recompute change/changePct from prev close when a real-time price arrives
          if (merged.last && merged.close && merged.close > 0) {
            merged.change = +(merged.last - merged.close).toFixed(4);
            merged.changePct = +((merged.change / merged.close) * 100).toFixed(4);
          }
          return { quotes: { ...state.quotes, [quote.symbol]: merged } };
        }),

      updateQuotes: (quotes) =>
        set((state) => {
          const next = { ...state.quotes };
          for (const q of quotes) {
            const existing = next[q.symbol];
            const merged = existing ? { ...existing, ...q } : { ...q };
            // Always recompute change/changePct from prev close
            if (merged.last && merged.close && merged.close > 0) {
              merged.change = +(merged.last - merged.close).toFixed(4);
              merged.changePct = +((merged.change / merged.close) * 100).toFixed(4);
            }
            next[q.symbol] = merged;
          }
          return { quotes: next };
        }),
    }),
    {
      name: "alphadesk-watchlist",
      partialize: (state) => ({ watchlist: state.watchlist }),
      skipHydration: true,
    }
  )
);

// ─── Scoped selectors (perf-audit-r3 P0 #3) ──────────────────
//
// `useMarketStore((s) => s.quotes)` returns the whole `Record<string, Quote>`
// and rerenders every consumer on every tick. Use these per-symbol helpers
// instead: they only rerender when the specific symbol's quote changes by
// reference (which happens when `updateQuote` merges that symbol).

/** Subscribe to a single symbol's quote. Rerenders only when that symbol updates. */
export function useQuote(symbol: string): Quote | null {
  return useMarketStore((s) => s.quotes[symbol] ?? null);
}

/**
 * Subscribe to a small set of symbols' quotes at once. Shallow-compares the
 * returned object so the component rerenders only when one of the requested
 * symbols changes. Intended for broadcast surfaces like TickerTape / Movers
 * where the component truly needs multiple symbols at once but should not
 * rerender on unrelated ticks.
 *
 * `symbols` should be stable-identity across renders (e.g. a memoised list).
 */
export function useQuotes(symbols: readonly string[]): Record<string, Quote> {
  const stableSymbols = useMemo(() => [...symbols], [symbols.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMarketStore(
    useShallow((s) => {
      const out: Record<string, Quote> = {};
      for (const sym of stableSymbols) {
        const q = s.quotes[sym];
        if (q) out[sym] = q;
      }
      return out;
    })
  );
}

/**
 * Compute the freshest quote timestamp across the store, as epoch-seconds.
 * Not a hook — intended to be called imperatively on a heartbeat so consumers
 * don't subscribe to the whole quotes map. Returns undefined when no quotes
 * have arrived.
 */
export function getFreshestQuoteTimestamp(): number | undefined {
  const quotes = useMarketStore.getState().quotes;
  let max = 0;
  for (const sym in quotes) {
    const t = Number(quotes[sym]?.timestamp) || 0;
    if (t > max) max = t;
  }
  return max || undefined;
}
