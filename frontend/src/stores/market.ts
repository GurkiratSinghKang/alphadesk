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
  /**
   * Freshest quote timestamp seen, in whatever unit `Quote.timestamp`
   * carries (epoch-seconds today). Tracked on write so the heartbeat
   * consumer can read it in O(1) — see long-session-audit-r4 P2 #14.
   */
  freshestTs: number;

  setSelectedSymbol: (symbol: string) => void;
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  updateQuote: (quote: Quote) => void;
  updateQuotes: (quotes: Quote[]) => void;
  /**
   * Bulk eviction: drop any quote whose symbol is not in `keepSymbols`.
   * Useful for periodic GC after watchlist/position churn so the record
   * doesn't accumulate stale entries from formerly-held positions.
   */
  pruneQuotes: (keepSymbols: readonly string[]) => void;
}

/** Safely coerce a quote timestamp to a number, returning 0 on invalid input. */
function tsNum(ts: unknown): number {
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set) => ({
      quotes: {},
      watchlist: DEFAULT_WATCHLIST,
      selectedSymbol: "SPY",
      freshestTs: 0,

      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

      addToWatchlist: (symbol) =>
        set((state) => {
          const upper = symbol.toUpperCase();
          if (state.watchlist.includes(upper)) return state;
          return { watchlist: [...state.watchlist, upper] };
        }),

      // long-session-audit-r4 P0 #4: also evict the corresponding quote
      // so the `quotes` record doesn't accumulate entries for symbols the
      // user no longer cares about. Without this the watchlist churn
      // (add/search/select/remove) leaks a quote entry per cycle.
      removeFromWatchlist: (symbol) =>
        set((state) => {
          if (!(symbol in state.quotes) && !state.watchlist.includes(symbol)) {
            return state;
          }
          const nextQuotes = { ...state.quotes };
          delete nextQuotes[symbol];
          return {
            watchlist: state.watchlist.filter((s) => s !== symbol),
            quotes: nextQuotes,
          };
        }),

      updateQuote: (quote) =>
        set((state) => {
          const existing = state.quotes[quote.symbol];
          const quoteTs = tsNum(quote.timestamp);
          const nextFreshestTs = quoteTs > state.freshestTs ? quoteTs : state.freshestTs;
          if (!existing) {
            // First time seeing this symbol — store as-is
            return {
              quotes: { ...state.quotes, [quote.symbol]: { ...quote } },
              freshestTs: nextFreshestTs,
            };
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
          return {
            quotes: { ...state.quotes, [quote.symbol]: merged },
            freshestTs: nextFreshestTs,
          };
        }),

      updateQuotes: (quotes) =>
        set((state) => {
          const next = { ...state.quotes };
          let maxTs = state.freshestTs;
          for (const q of quotes) {
            const existing = next[q.symbol];
            const merged = existing ? { ...existing, ...q } : { ...q };
            // Always recompute change/changePct from prev close
            if (merged.last && merged.close && merged.close > 0) {
              merged.change = +(merged.last - merged.close).toFixed(4);
              merged.changePct = +((merged.change / merged.close) * 100).toFixed(4);
            }
            next[q.symbol] = merged;
            const qts = tsNum(q.timestamp);
            if (qts > maxTs) maxTs = qts;
          }
          return { quotes: next, freshestTs: maxTs };
        }),

      pruneQuotes: (keepSymbols) =>
        set((state) => {
          const keep = new Set(keepSymbols);
          const nextQuotes: Record<string, Quote> = {};
          let maxTs = 0;
          let changed = false;
          for (const sym in state.quotes) {
            if (keep.has(sym)) {
              const q = state.quotes[sym];
              nextQuotes[sym] = q;
              const qts = tsNum(q.timestamp);
              if (qts > maxTs) maxTs = qts;
            } else {
              changed = true;
            }
          }
          if (!changed) return state;
          return { quotes: nextQuotes, freshestTs: maxTs };
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
 * Read the freshest quote timestamp across the store, as epoch-seconds.
 * Not a hook — intended to be called imperatively on a heartbeat so consumers
 * don't subscribe to the whole quotes map. Returns undefined when no quotes
 * have arrived.
 *
 * long-session-audit-r4 P2 #14: was previously an O(n) walk of the entire
 * quotes record on every call. Now O(1) — the store maintains `freshestTs`
 * on every write. Combined with P0 #4's eviction, this keeps the heartbeat
 * consumer cheap even after days of watchlist churn.
 */
export function getFreshestQuoteTimestamp(): number | undefined {
  const ts = useMarketStore.getState().freshestTs;
  return ts > 0 ? ts : undefined;
}
