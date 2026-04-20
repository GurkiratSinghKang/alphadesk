"use client";

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useAlertsStore } from "@/stores/alerts";
import { usePreferencesStore } from "@/stores/preferences";
import { getSnapshot, getPositions, getOrders, getPortfolioSummary, getPortfolioGreeks } from "@/lib/api";
import { isMarketOpen } from "@/lib/marketHours";
import type { Quote, Alert } from "@/types";

/**
 * Module-level so the initial-fetch effect and the polling effect
 * share one definition. Pure side-effect; nothing React-specific to
 * close over.
 *
 * Exported for Wave C (persona 74 P0 #2) so ``useWebSocket`` can call
 * this directly on a reconnecting -> open transition without needing a
 * React Query cache key. The four REST endpoints below are the only
 * portfolio state that the WS stream does not itself refresh (quotes
 * arrive over WS; positions/orders/summary/greeks don't).
 */
export function fetchPortfolioData() {
  getPositions()
    .then((positions) => {
      usePortfolioStore.getState().setPositions(positions);
    })
    .catch((err) => {
      console.warn("[DataPipeline] Positions fetch failed:", err.message);
    });

  getOrders()
    .then((orders) => {
      usePortfolioStore.getState().setOrders(orders);
    })
    .catch((err) => {
      console.warn("[DataPipeline] Orders fetch failed:", err.message);
    });

  getPortfolioSummary()
    .then((summary) => {
      usePortfolioStore.getState().setSummary(summary);
    })
    .catch((err) => {
      console.warn("[DataPipeline] Summary fetch failed:", err.message);
    });

  getPortfolioGreeks()
    .then((greeks) => {
      usePortfolioStore.getState().setGreeks(greeks);
    })
    .catch((err) => {
      console.warn("[DataPipeline] Greeks fetch failed:", err.message);
    });
}

/**
 * Bridges the WebSocket + REST API to Zustand stores.
 * - Fetches initial market data for watchlist symbols
 * - Fetches initial portfolio data
 * - Routes incoming WS messages to the correct store via onMessage (no re-render)
 */
export function useDataPipeline(enabled: boolean = true) {
  const { subscribe, unsubscribe, onMessage } = useWs();
  const hasFetched = useRef(false);
  // Persona-8 #1: portfolio refresh used to be a hardcoded 30s. Wire the
  // user pref so the Settings → Data Refresh slider actually changes
  // something. Stored as seconds in `preferences.data.refreshInterval`,
  // clamped in the setter to [10, 300] s.
  const refreshIntervalSec = usePreferencesStore((s) => s.data.refreshInterval);

  // Subscribe to WS channels on mount, unsubscribe on unmount
  useEffect(() => {
    if (!enabled) return;
    subscribe("quotes");
    subscribe("portfolio");
    subscribe("alerts");
    subscribe("agents");
    subscribe("bars");
    return () => {
      unsubscribe("quotes");
      unsubscribe("portfolio");
      unsubscribe("alerts");
      unsubscribe("agents");
      unsubscribe("bars");
    };
  }, [subscribe, unsubscribe, enabled]);

  // Fetch initial data on mount (with retry). One-shot — the polling
  // interval lives in a sibling effect so it can re-arm on refresh-rate
  // pref changes without re-running the initial fetch.
  useEffect(() => {
    if (!enabled) return;
    if (hasFetched.current) return;
    hasFetched.current = true;
    let cancelled = false;

    const fetchInitialData = (attempt = 1) => {
      const { watchlist, selectedSymbol } = useMarketStore.getState();

      // Fetch initial quotes for watchlist
      getSnapshot(watchlist)
        .then((snapshot) => {
          if (cancelled) return;
          const quotes: Quote[] = Object.values(snapshot);
          if (quotes.length) {
            useMarketStore.getState().updateQuotes(quotes);
          }
        })
        .catch((err) => {
          console.warn(`[DataPipeline] Snapshot fetch failed (attempt ${attempt}):`, err.message);
          if (attempt === 1) {
            setTimeout(() => fetchInitialData(2), 3000);
          }
        });

      // Also fetch quote for the selected symbol if not in watchlist
      if (!watchlist.includes(selectedSymbol)) {
        getSnapshot([selectedSymbol])
          .then((snapshot) => {
            if (cancelled) return;
            const quotes: Quote[] = Object.values(snapshot);
            if (quotes.length) {
              useMarketStore.getState().updateQuotes(quotes);
            }
          })
          .catch(() => {});
      }

      // Fetch portfolio data
      fetchPortfolioData();
    };

    fetchInitialData();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Periodic portfolio refresh — interval driven by user pref
  // (Settings → Data Refresh). Re-arms when the pref changes so a slider
  // tweak takes effect on the next tick instead of the next reload.
  //
  // BUG-016: when the market is closed the broker's portfolio values
  // cannot change (no prints → no unrealized P&L drift), so polling adds
  // load without surfacing new information. We therefore back off to 5×
  // the normal cadence when the session is closed; an open session stays
  // at the user-configured rate. Real fix (consolidated WS portfolio
  // stream) is tracked in stores/market.ts BUG-016 TODO.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      // Re-evaluate market state on every tick so we can't get stuck in
      // a closed-cadence after the 09:30 ET open.
      const baseSec = Number.isFinite(refreshIntervalSec) && refreshIntervalSec >= 10
        ? Math.min(refreshIntervalSec, 300)
        : 30;
      // Closed-session back-off clamped at 5 minutes — the Settings
      // slider's hard ceiling — so nobody waits 25m for an off-hours
      // summary refresh after opening the app on a Sunday.
      const seconds = isMarketOpen() ? baseSec : Math.min(baseSec * 5, 300);
      return seconds * 1000;
    };

    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (cancelled) return;
      handle = setTimeout(() => {
        fetchPortfolioData();
        arm();
      }, tick());
    };
    arm();
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    };
  }, [enabled, refreshIntervalSec]);

  // Route WS messages to stores via channel callbacks (no React re-renders)
  //
  // NEW-BUG fix: `enabled` MUST be in the dep array. Store hydration is
  // async (`DataPipelineBridge` flips `enabled` false → true after the
  // persist rehydrate resolves), so the very first invocation early-returns
  // and — prior to this fix — never re-ran because the deps list only
  // mentioned `onMessage`. The result was that quotes/portfolio/alerts/bars
  // WS channels were silently un-routed for the rest of the session, and
  // the dashboard appeared to be getting real-time data (the snapshot REST
  // calls succeed) while actually only refreshing on the 30s portfolio
  // poll. Adding `enabled` ensures the effect re-registers once the stores
  // are hydrated.
  useEffect(() => {
    if (!enabled) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onMessage("quotes", (msg) => {
        const quote = msg.data as Quote;
        if (quote?.symbol) {
          useMarketStore.getState().updateQuote(quote);
        }
      })
    );

    unsubs.push(
      onMessage("portfolio", (msg) => {
        const payload = msg.data as Record<string, unknown>;
        if (payload?.positions) {
          const rawPositions = payload.positions as Record<string, unknown>[];
          const mapped = rawPositions.map((p) => ({
            symbol: (p.symbol as string) ?? "",
            quantity: (p.quantity as number) ?? (p.qty as number) ?? 0,
            side: (p.side as "long" | "short") ?? undefined,
            avgCost: (p.avg_cost as number) ?? (p.avgCost as number) ?? 0,
            currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
            unrealizedPnl: (p.unrealized_pnl as number) ?? (p.unrealizedPnl as number) ?? 0,
            marketValue: (p.market_value as number) ?? (p.marketValue as number) ?? 0,
          }));
          usePortfolioStore
            .getState()
            .setPositions(mapped as import("@/types").Position[]);
        }
        if (payload?.orders) {
          usePortfolioStore
            .getState()
            .setOrders(payload.orders as import("@/types").Order[]);
        }
        if (payload?.summary) {
          usePortfolioStore
            .getState()
            .setSummary(payload.summary as import("@/types").PortfolioSummary);
        }
        if (payload?.greeks) {
          usePortfolioStore
            .getState()
            .setGreeks(payload.greeks as import("@/types").PortfolioGreeks);
        }
      })
    );

    unsubs.push(
      onMessage("alerts", (msg) => {
        const alert = msg.data as Alert;
        if (alert?.id) {
          useAlertsStore.getState().addAlert(alert);

          // Show toast notification for price alerts
          if (alert.type === "price" && alert.message) {
            // Dispatch a custom event for the toast system to pick up
            // (useToast requires React context, so we use the event bridge)
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("alphadesk:price-alert", {
                  detail: { message: alert.message, symbol: alert.symbol },
                })
              );
            }
          }
        }
      })
    );

    // "bars" channel — real-time minute bar updates for charts
    unsubs.push(
      onMessage("bars", (msg) => {
        const bar = msg.data as { symbol: string; open: number; high: number; low: number; close: number; volume: number; timestamp: string };
        if (bar?.symbol && bar?.close) {
          // Update the quote's last price from the bar close
          useMarketStore.getState().updateQuote({
            symbol: bar.symbol,
            last: bar.close,
            high: bar.high,
            low: bar.low,
            volume: bar.volume,
          } as Quote);
          // Dispatch bar event for TradingChart to consume
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("alphadesk:bar-update", { detail: bar })
            );
          }
        }
      })
    );

    // "agents" channel — reserved for future use
    unsubs.push(onMessage("agents", () => {}));

    return () => unsubs.forEach(fn => fn());
  }, [onMessage, enabled]);
}
