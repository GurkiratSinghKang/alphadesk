"use client";

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useAlertsStore } from "@/stores/alerts";
import { getSnapshot, getPositions, getOrders, getPortfolioSummary, getPortfolioGreeks } from "@/lib/api";
import type { Quote, Alert, OHLCVBar } from "@/types";

/**
 * Bridges the WebSocket + REST API to Zustand stores.
 * - Fetches initial market data for watchlist symbols
 * - Fetches initial portfolio data
 * - Routes incoming WS messages to the correct store
 */
export function useDataPipeline() {
  const { lastMessage, subscribe } = useWs();
  const hasFetched = useRef(false);

  // Subscribe to WS channels on mount
  useEffect(() => {
    subscribe("quotes");
    subscribe("portfolio");
    subscribe("alerts");
    subscribe("agents");
  }, [subscribe]);

  // Fetch initial data on mount (with retry)
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    const fetchInitialData = (attempt = 1) => {
      const { watchlist, selectedSymbol } = useMarketStore.getState();

      // Fetch initial quotes for watchlist
      getSnapshot(watchlist)
        .then((snapshot) => {
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
            const quotes: Quote[] = Object.values(snapshot);
            if (quotes.length) {
              useMarketStore.getState().updateQuotes(quotes);
            }
          })
          .catch(() => {});
      }

      // Fetch portfolio data
      getPositions()
        .then((positions) => usePortfolioStore.getState().setPositions(positions))
        .catch((err) => {
          console.warn("[DataPipeline] Positions fetch failed:", err.message);
        });

      getOrders()
        .then((orders) => usePortfolioStore.getState().setOrders(orders))
        .catch((err) => {
          console.warn("[DataPipeline] Orders fetch failed:", err.message);
        });

      getPortfolioSummary()
        .then((summary) => usePortfolioStore.getState().setSummary(summary))
        .catch((err) => {
          console.warn("[DataPipeline] Summary fetch failed:", err.message);
        });

      getPortfolioGreeks()
        .then((greeks) => usePortfolioStore.getState().setGreeks(greeks))
        .catch((err) => {
          console.warn("[DataPipeline] Greeks fetch failed:", err.message);
        });
    };

    fetchInitialData();
  }, []);

  // Route WS messages to stores
  useEffect(() => {
    if (!lastMessage) return;

    const { channel, data } = lastMessage;

    switch (channel) {
      case "quotes": {
        const quote = data as Quote;
        if (quote?.symbol) {
          useMarketStore.getState().updateQuote(quote);
        }
        break;
      }
      case "portfolio": {
        const payload = data as Record<string, unknown>;
        if (payload?.positions) {
          const rawPositions = payload.positions as Record<string, unknown>[];
          const mapped = rawPositions.map((p) => ({
            symbol: (p.symbol as string) ?? "",
            quantity: (p.quantity as number) ?? (p.qty as number) ?? 0,
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
        break;
      }
      case "alerts": {
        const alert = data as Alert;
        if (alert?.id) {
          useAlertsStore.getState().addAlert(alert);
        }
        break;
      }
      case "agents": {
        // Agent status updates can be handled here in the future
        break;
      }
    }
  }, [lastMessage]);
}
