"use client";

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useAlertsStore } from "@/stores/alerts";
import { getSnapshot, getPositions, getOrders, getPortfolioSummary, getPortfolioGreeks } from "@/lib/api";
import type { Quote, Alert, Position, Order, PortfolioSummary, PortfolioGreeks } from "@/types";

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

function firstNumber(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function firstString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function normalizeWsPosition(raw: Record<string, unknown>): Position {
  return {
    symbol: firstString(raw, "symbol") ?? "",
    quantity: firstNumber(raw, "quantity", "qty"),
    side: (firstString(raw, "side") as Position["side"]) ?? undefined,
    avgCost: firstNumber(raw, "avgCost", "avg_cost"),
    currentPrice: firstNumber(raw, "currentPrice", "current_price"),
    unrealizedPnl: firstNumber(raw, "unrealizedPnl", "unrealized_pnl"),
    marketValue: firstNumber(raw, "marketValue", "market_value"),
    sector: firstString(raw, "sector"),
    strategy: firstString(raw, "strategy") ?? null,
  };
}

function normalizeWsOrder(raw: Record<string, unknown>): Order {
  const legsRaw = Array.isArray(raw.legs)
    ? (raw.legs as Array<Record<string, unknown>>)
    : [];
  const firstLeg = legsRaw[0] ?? {};
  return {
    id: firstString(raw, "id", "order_id") ?? "",
    symbol: firstString(firstLeg, "symbol") ?? firstString(raw, "symbol") ?? "",
    side: ((firstString(firstLeg, "side") ?? firstString(raw, "side") ?? "buy") as Order["side"]),
    type: ((firstString(firstLeg, "order_type", "type") ?? firstString(raw, "type") ?? "market") as Order["type"]),
    quantity: firstNumber(firstLeg, "qty", "quantity") || firstNumber(raw, "quantity", "qty"),
    price: firstNumber(firstLeg, "limit_price", "price") || firstNumber(raw, "price", "limit_price") || undefined,
    status: ((firstString(raw, "status") ?? "pending") as Order["status"]),
    legs: legsRaw.map((leg) => ({
      symbol: firstString(leg, "symbol") ?? "",
      side: ((firstString(leg, "side") ?? "buy") as "buy" | "sell"),
      quantity: firstNumber(leg, "qty", "quantity"),
      price: firstNumber(leg, "price", "limit_price") || undefined,
    })),
    strategy: firstString(raw, "strategy") ?? null,
    comboType: firstString(raw, "comboType", "combo_type") ?? null,
    rejectReason: firstString(raw, "rejectReason", "reject_reason") ?? null,
    filledAt: firstString(raw, "filledAt", "filled_at"),
    createdAt:
      firstString(raw, "createdAt", "created_at", "submitted_at") ??
      new Date().toISOString(),
  };
}

function normalizeWsSummary(raw: Record<string, unknown>): PortfolioSummary {
  const dayPnl = firstNumber(raw, "dayPnl", "day_pnl", "profit_loss", "realizedPnlToday", "realized_pnl_today");
  const equity = firstNumber(raw, "equity");
  const rawDayPnlPct = firstNumber(raw, "dayPnlPct", "day_pnl_pct");
  const lastEquity = equity - dayPnl;
  return {
    equity,
    cash: firstNumber(raw, "cash"),
    buyingPower: firstNumber(raw, "buyingPower", "buying_power"),
    totalMarketValue: firstNumber(raw, "totalMarketValue", "total_market_value"),
    unrealizedPnl: firstNumber(raw, "unrealizedPnl", "unrealized_pnl"),
    unrealizedPnlPct: firstNumber(raw, "unrealizedPnlPct", "unrealized_pnl_pct"),
    realizedPnlToday: firstNumber(raw, "realizedPnlToday", "realized_pnl_today"),
    positionsCount: firstNumber(raw, "positionsCount", "positions_count"),
    dayPnl,
    dayPnlPct: rawDayPnlPct || (lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0),
    is_demo: raw.is_demo === true || raw.source === "demo",
    lastUpdated: firstString(raw, "lastUpdated", "last_updated"),
    source: firstString(raw, "source"),
  };
}

function normalizeWsGreeks(raw: Record<string, unknown>): PortfolioGreeks {
  const byPositionRaw = raw.byPosition ?? raw.by_position;
  const byPosition = Array.isArray(byPositionRaw)
    ? byPositionRaw.map((entry) => {
        const p = entry as Record<string, unknown>;
        return {
          symbol: firstString(p, "symbol") ?? "",
          delta: firstNumber(p, "delta"),
          gamma: firstNumber(p, "gamma"),
          theta: firstNumber(p, "theta"),
          vega: firstNumber(p, "vega"),
        };
      })
    : undefined;
  return {
    netDelta: firstNumber(raw, "netDelta", "net_delta"),
    netGamma: firstNumber(raw, "netGamma", "net_gamma"),
    netTheta: firstNumber(raw, "netTheta", "net_theta"),
    netVega: firstNumber(raw, "netVega", "net_vega"),
    betaWeightedDelta: firstNumber(raw, "betaWeightedDelta", "beta_weighted_delta"),
    byPosition,
    isDemo: raw.is_demo === true,
  };
}

/**
 * Bridges the WebSocket + REST API to Zustand stores.
 * - Fetches initial market data for watchlist symbols
 * - Fetches initial portfolio data
 * - Routes incoming WS messages to the correct store via onMessage (no re-render)
 */
export function useDataPipeline(enabled: boolean = true) {
  const { subscribe, unsubscribe, onMessage, isConnected, wsStatus } = useWs();
  const hasFetched = useRef(false);

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

  // K-2 (round-6): drop the 30s REST polling cycle entirely. The
  // initial mount fetch above + WebSocket push (`portfolio` channel)
  // are now the only paths that mutate the portfolio store under
  // normal operation. The previous polling layer was the legacy
  // "BUG-016 closed-session back-off" — replaced by trusting the WS
  // stream + a single fallback refetch when WS has been down for more
  // than 60 s.
  //
  // Reconnect refetch: useWebSocket already calls fetchPortfolioData
  // exactly once on a reconnecting -> open transition, so a brief WS
  // blip auto-recovers without any timer here. This effect only fires
  // when the WS *fails to come back* within the 60 s grace window —
  // a rare edge but real (e.g. proxy outage, server restart that
  // exceeds MAX_RETRIES * BASE_DELAY).
  useEffect(() => {
    if (!enabled) return;
    if (isConnected) return;
    // Only the genuinely-disconnected statuses warrant a fallback poll.
    // While we're "connecting" for the first time we let the initial
    // mount fetch handle it.
    if (wsStatus !== "reconnecting" && wsStatus !== "failed") return;

    const handle = setTimeout(() => {
      fetchPortfolioData();
    }, 60_000);

    return () => clearTimeout(handle);
  }, [enabled, isConnected, wsStatus]);

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
          const mapped = rawPositions.map(normalizeWsPosition);
          usePortfolioStore
            .getState()
            .setPositions(mapped);
        }
        if (payload?.orders) {
          const rawOrders = payload.orders as Record<string, unknown>[];
          usePortfolioStore
            .getState()
            .setOrders(rawOrders.map(normalizeWsOrder));
        }
        if (payload?.summary) {
          const rawSummary = payload.summary as Record<string, unknown>;
          usePortfolioStore
            .getState()
            .setSummary(normalizeWsSummary(rawSummary));
        }
        if (payload?.greeks) {
          const rawGreeks = payload.greeks as Record<string, unknown>;
          usePortfolioStore
            .getState()
            .setGreeks(normalizeWsGreeks(rawGreeks));
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
        }
      })
    );

    // "agents" channel — reserved for future use
    unsubs.push(onMessage("agents", () => {}));

    return () => unsubs.forEach(fn => fn());
  }, [onMessage, enabled]);
}
