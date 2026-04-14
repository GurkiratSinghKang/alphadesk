"use client";

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useAlertsStore } from "@/stores/alerts";
import { getSnapshot, getPositions, getOrders, getPortfolioSummary, getPortfolioGreeks } from "@/lib/api";
import type { Quote, Alert } from "@/types";

/**
 * Bridges the WebSocket + REST API to Zustand stores.
 * - Fetches initial market data for watchlist symbols
 * - Fetches initial portfolio data
 * - Routes incoming WS messages to the correct store via onMessage (no re-render)
 */
export function useDataPipeline() {
  const { subscribe, unsubscribe, onMessage } = useWs();
  const hasFetched = useRef(false);

  // Subscribe to WS channels on mount, unsubscribe on unmount (prevents double-sub in Strict Mode)
  useEffect(() => {
    subscribe("quotes");
    subscribe("portfolio");
    subscribe("alerts");
    subscribe("agents");
    return () => {
      unsubscribe("quotes");
      unsubscribe("portfolio");
      unsubscribe("alerts");
      unsubscribe("agents");
    };
  }, [subscribe, unsubscribe]);

  // Fetch initial data on mount (with retry) + periodic portfolio refresh
  useEffect(() => {
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

    const fetchPortfolioData = () => {
      if (cancelled) return;

      getPositions()
        .then((positions) => {
          if (cancelled) return;
          usePortfolioStore.getState().setPositions(positions);
        })
        .catch((err) => {
          console.warn("[DataPipeline] Positions fetch failed:", err.message);
        });

      getOrders()
        .then((orders) => {
          if (cancelled) return;
          usePortfolioStore.getState().setOrders(orders);
        })
        .catch((err) => {
          console.warn("[DataPipeline] Orders fetch failed:", err.message);
        });

      getPortfolioSummary()
        .then((summary) => {
          if (cancelled) return;
          usePortfolioStore.getState().setSummary(summary);
        })
        .catch((err) => {
          console.warn("[DataPipeline] Summary fetch failed:", err.message);
        });

      getPortfolioGreeks()
        .then((greeks) => {
          if (cancelled) return;
          usePortfolioStore.getState().setGreeks(greeks);
        })
        .catch((err) => {
          console.warn("[DataPipeline] Greeks fetch failed:", err.message);
        });
    };

    fetchInitialData();

    // Refresh portfolio summary every 30s for real-time P&L updates
    const portfolioInterval = setInterval(fetchPortfolioData, 30_000);

    return () => {
      cancelled = true;
      clearInterval(portfolioInterval);
    };
  }, []);

  // Route WS messages to stores via channel callbacks (no React re-renders)
  useEffect(() => {
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

    // "agents" channel — reserved for future use
    unsubs.push(onMessage("agents", () => {}));

    return () => unsubs.forEach(fn => fn());
  }, [onMessage]);
}
