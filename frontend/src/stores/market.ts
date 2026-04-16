import { create } from "zustand";
import { persist } from "zustand/middleware";
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
          // Merge but PRESERVE the close (prev day close) from the initial snapshot.
          // WebSocket quotes don't carry close, so don't let it get overwritten.
          const merged = {
            ...existing,
            ...quote,
            close: existing.close || quote.close, // keep original close
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
            // Recompute change/changePct from prev close when missing
            if (merged.last && merged.close && merged.close > 0 && !merged.changePct) {
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
    }
  )
);
