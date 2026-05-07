import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import type { Quote } from "@/types";
import {
  addToUserWatchlist as apiAddToUserWatchlist,
  getUserWatchlist as apiGetUserWatchlist,
  removeFromUserWatchlist as apiRemoveFromUserWatchlist,
} from "@/lib/api";

// Exported so the cross-user logout helper (lib/auth/clearPersistedStores)
// can reset the in-memory watchlist back to the canonical seed without
// duplicating the literal.
export const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "SPY", "QQQ", "META", "AMD"];

// TODO(BUG-016): the dashboard currently observes ~295 GETs/min across
// portfolio/orders/quotes because most surfaces poll on their own
// intervals. The proper fix is a unified WebSocket stream for quotes +
// portfolio + orders so pages subscribe once and receive push updates
// (the `portfolio` WS channel already exists — see useDataPipeline — but
// the REST poll in parallel defeats its purpose). Until that lands:
//   • `useDataPipeline` defaults portfolio polling to 30s and gates it
//     on market hours when the user hasn't overridden the interval.
//   • React Query hooks (regime=5m, indices=1m, strategies=1m) remain
//     coarse-grained; see hooks/useQueries.ts.
// Follow-up owner: next WS wave (consolidate portfolio + quotes into one
// subscription, drop redundant REST polls).

/**
 * Slice-11 / SLG-1 (2026 design brief, TWS Mosaic pattern): symbol-link
 * color groups. Up to 4 groups; any panel can join a group via its
 * group-picker chip and the panel's symbol updates synchronously when
 * any other panel in the same group changes its symbol. Group 0 = "no
 * group" (panel uses its own selectedSymbol independently). Group ids
 * 1-4 follow the Bloomberg / IBKR convention with brand-coordinated
 * colors so the user can pin "research" panels to red, "watch" panels
 * to amber, etc.
 */
export type SymbolGroupId = 0 | 1 | 2 | 3 | 4;

interface MarketState {
  quotes: Record<string, Quote>;
  watchlist: string[];
  selectedSymbol: string;
  /**
   * Freshest quote timestamp seen, normalized to epoch milliseconds.
   * Tracked on write so the heartbeat consumer can read it in O(1) —
   * see long-session-audit-r4 P2 #14.
   */
  freshestTs: number;

  /**
   * Slice-11 / SLG-1: per-group active symbol. Group 0 is unused; groups
   * 1-4 are the user-pinnable symbol-link buckets. Default to SPY across
   * all groups so panels that join a group on first mount have something
   * sensible to display.
   */
  groupSymbols: Record<1 | 2 | 3 | 4, string>;

  setSelectedSymbol: (symbol: string) => void;
  setGroupSymbol: (group: 1 | 2 | 3 | 4, symbol: string) => void;
  /**
   * Add a symbol to the watchlist. Optimistic — the local array updates
   * synchronously so consumers reading state right after the call (e.g.
   * the HeroCTAs button) see the new symbol immediately. The server
   * sync runs as a background promise; on success the local array is
   * replaced with the server's authoritative ordering, on failure the
   * local optimistic add stays in place and a console warning fires.
   */
  addToWatchlist: (symbol: string) => void;
  /** Remove a symbol from the watchlist. Optimistic + background sync. */
  removeFromWatchlist: (symbol: string) => void;
  /**
   * Iter 17: pull the authoritative watchlist from the server and
   * replace the local array. No-op when ``authenticated=false`` (per-
   * browser fallback for unauth'd visitors). Should be called from a
   * top-level effect on app boot, gated on the auth query result.
   */
  hydrateFromServer: (authenticated: boolean) => Promise<void>;
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
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return parsed;
  }
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
      groupSymbols: { 1: "SPY", 2: "SPY", 3: "SPY", 4: "SPY" },

      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
      setGroupSymbol: (group, symbol) =>
        set((state) => ({
          groupSymbols: {
            ...state.groupSymbols,
            [group]: symbol.toUpperCase(),
          },
        })),

      // Iter 17: optimistic-local + background server-sync. The local
      // array updates synchronously so HeroCTAs (and any other watcher)
      // gets the new symbol before this function returns; the server
      // call runs in the background and replaces the local array with
      // the server's authoritative ordering on success. On failure
      // (offline, 401, 5xx) the optimistic add stays so the UX never
      // regresses below the pre-iter-15 local-only behaviour.
      addToWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => {
          if (state.watchlist.includes(upper)) return state;
          return { watchlist: [...state.watchlist, upper] };
        });
        // Fire-and-forget server sync. We deliberately do NOT await:
        // callers like HeroCTAs read state synchronously after the
        // click, and React's reconciliation should not block on the
        // network round-trip.
        void apiAddToUserWatchlist(upper)
          .then((fresh) => {
            set({ watchlist: fresh.symbols });
          })
          .catch((err) => {
            // 401 / network blip / server error — keep the local
            // optimistic add so the user's intent isn't silently lost.
            // eslint-disable-next-line no-console -- intentional diagnostic
            console.warn("[watchlist] server sync failed; keeping local-only", err);
          });
      },

      // long-session-audit-r4 P0 #4: also evict the corresponding quote
      // so the `quotes` record doesn't accumulate entries for symbols the
      // user no longer cares about. Without this the watchlist churn
      // (add/search/select/remove) leaks a quote entry per cycle.
      removeFromWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
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
        });
        void apiRemoveFromUserWatchlist(upper)
          .then((fresh) => {
            set({ watchlist: fresh.symbols });
          })
          .catch((err) => {
            // eslint-disable-next-line no-console -- intentional diagnostic
            console.warn("[watchlist] server sync failed; keeping local-only", err);
          });
      },

      hydrateFromServer: async (authenticated) => {
        if (!authenticated) {
          // Unauth'd visitor — keep the local persisted watchlist as a
          // per-browser fallback. The DataPipelineBridge already
          // rehydrated localStorage at this point so DEFAULT_WATCHLIST
          // is in place for first-time visitors.
          return;
        }
        try {
          const fresh = await apiGetUserWatchlist();
          set({ watchlist: fresh.symbols });
        } catch (err) {
          // Server unreachable on boot — keep the local copy so the
          // watchlist panel doesn't go blank on a transient outage.
          // eslint-disable-next-line no-console -- intentional diagnostic
          console.warn("[watchlist] hydrate failed; using local copy", err);
        }
      },

      updateQuote: (quote) =>
        set((state) => {
          const existing = state.quotes[quote.symbol];
          const quoteTs = tsNum(quote.timestamp);
          const incoming = quoteTs > 0 ? { ...quote, timestamp: quoteTs } : quote;
          const nextFreshestTs = quoteTs > state.freshestTs ? quoteTs : state.freshestTs;
          if (!existing) {
            // First time seeing this symbol — store as-is
            return {
              quotes: { ...state.quotes, [quote.symbol]: { ...incoming } },
              freshestTs: nextFreshestTs,
            };
          }
          // Merge but PRESERVE snapshot fields that WebSocket doesn't carry.
          // WebSocket only sends: symbol, bid, ask, last, volume, timestamp.
          // Snapshot provides: close, open, high, low, change, changePct.
          const merged = {
            ...existing,
            ...incoming,
            close: existing.close || incoming.close,
            open: existing.open || incoming.open,
            high: Math.max(existing.high || 0, incoming.high || 0) || existing.high,
            low: (existing.low && incoming.low) ? Math.min(existing.low, incoming.low) : existing.low || incoming.low,
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
            const qts = tsNum(q.timestamp);
            const incoming = qts > 0 ? { ...q, timestamp: qts } : q;
            // Mirror updateQuote: PRESERVE snapshot-only fields
            // (close/open/high/low) across WS updates. A raw spread
            // (`{...existing, ...q}`) would let a WS-only payload blow
            // away prior-close/open etc. with undefined because WS
            // delivers only bid/ask/last/volume/timestamp.
            const merged = existing
              ? {
                  ...existing,
                  ...incoming,
                  close: existing.close || incoming.close,
                  open: existing.open || incoming.open,
                  high: Math.max(existing.high || 0, incoming.high || 0) || existing.high,
                  low: (existing.low && incoming.low) ? Math.min(existing.low, incoming.low) : existing.low || incoming.low,
                }
              : { ...incoming };
            // Always recompute change/changePct from prev close
            if (merged.last && merged.close && merged.close > 0) {
              merged.change = +(merged.last - merged.close).toFixed(4);
              merged.changePct = +((merged.change / merged.close) * 100).toFixed(4);
            }
            next[q.symbol] = merged;
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
      // persona-9 #4 — declare version + migrate now so that any future
      // schema change (e.g. switching watchlist to objects, or persisting
      // selectedSymbol) lands behind a controlled migration rather than
      // silently rehydrating partial state. v0 → v1 is a no-op promotion;
      // future versions can branch on the persistedState shape.
      version: 1,
      migrate: (persistedState, version) => {
        if (version < 1) {
          // No-op — earlier persisted blobs are shape-compatible.
          return persistedState as MarketState;
        }
        return persistedState as MarketState;
      },
      // Persist watchlist + selectedSymbol so cross-tab sync (below) can
      // mirror both. quotes are deliberately excluded — they're noisy and
      // re-fetched on mount; freshestTs is derived from quotes.
      // SLG-1: groupSymbols persist so the colour-group assignments
      // survive a reload (the user has bound semantic meaning to them
      // — group 1 = "watching", group 2 = "in-trade", etc.).
      partialize: (state) => ({
        watchlist: state.watchlist,
        selectedSymbol: state.selectedSymbol,
        groupSymbols: state.groupSymbols,
      }),
      skipHydration: true,
    }
  )
);

// ─── Cross-tab sync (persona-10 #1) ──────────────────────────
//
// Zustand persist writes to localStorage; other tabs don't get notified
// without an explicit `storage` listener. We mirror watchlist +
// selectedSymbol + groupSymbols (SLG-1) across tabs so a watchlist
// add or colour-group reassign in tab A shows up in tab B without
// the user having to reload. quotes are intentionally NOT synced —
// they'd thrash on every tick and the per-tab WebSocket already
// keeps each tab in sync with the wire.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "alphadesk-watchlist") return;
    if (!e.newValue) return; // ignore localStorage clear
    try {
      const parsed = JSON.parse(e.newValue) as { state?: Partial<MarketState> };
      const incoming = parsed.state ?? {};
      const current = useMarketStore.getState();
      const nextWatchlist = Array.isArray(incoming.watchlist)
        ? incoming.watchlist
        : current.watchlist;
      const nextSelected =
        typeof incoming.selectedSymbol === "string"
          ? incoming.selectedSymbol
          : current.selectedSymbol;
      const nextGroupSymbols =
        incoming.groupSymbols && typeof incoming.groupSymbols === "object"
          ? { ...current.groupSymbols, ...incoming.groupSymbols }
          : current.groupSymbols;
      // Only call setState if something actually changed — otherwise we
      // trigger needless rerenders in every component subscribed to either
      // field.
      const groupsChanged =
        JSON.stringify(nextGroupSymbols) !== JSON.stringify(current.groupSymbols);
      if (
        nextSelected !== current.selectedSymbol ||
        nextWatchlist.join("|") !== current.watchlist.join("|") ||
        groupsChanged
      ) {
        useMarketStore.setState({
          watchlist: nextWatchlist,
          selectedSymbol: nextSelected,
          groupSymbols: nextGroupSymbols,
        });
      }
    } catch {
      // malformed payload — ignore rather than corrupt local state
    }
  });
}

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
  // Key on a primitive signature — `symbols` array identity is unstable
  // across renders even when its values are unchanged. Extracted to a
  // variable so the lint rule can statically verify the dependency.
  const symbolsKey = symbols.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on symbolsKey, not the unstable symbols array
  const stableSymbols = useMemo(() => [...symbols], [symbolsKey]);
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
