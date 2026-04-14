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
          return { quotes: { ...state.quotes, [quote.symbol]: existing ? { ...existing, ...quote } : quote } };
        }),

      updateQuotes: (quotes) =>
        set((state) => {
          const next = { ...state.quotes };
          for (const q of quotes) {
            const existing = next[q.symbol];
            next[q.symbol] = existing ? { ...existing, ...q } : q;
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
