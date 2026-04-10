import { create } from "zustand";
import type { Quote } from "@/types";

interface MarketState {
  quotes: Map<string, Quote>;
  watchlist: string[];
  selectedSymbol: string;

  setSelectedSymbol: (symbol: string) => void;
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  updateQuote: (quote: Quote) => void;
  updateQuotes: (quotes: Quote[]) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  quotes: new Map(),
  watchlist: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "SPY", "QQQ", "META", "AMD"],
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
      const next = new Map(state.quotes);
      const existing = next.get(quote.symbol);
      next.set(quote.symbol, existing ? { ...existing, ...quote } : quote);
      return { quotes: next };
    }),

  updateQuotes: (quotes) =>
    set((state) => {
      const next = new Map(state.quotes);
      for (const q of quotes) {
        const existing = next.get(q.symbol);
        next.set(q.symbol, existing ? { ...existing, ...q } : q);
      }
      return { quotes: next };
    }),
}));
