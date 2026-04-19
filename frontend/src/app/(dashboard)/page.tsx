"use client";

/**
 * Trading Desk — flagship page (Layer 4)
 * ──────────────────────────────────────
 * Composes the Layer-3 `DeskLayout` shell with the Layer-2 composites.
 * This file is intentionally thin: it reads data from stores/queries,
 * shapes it through `_desk/selectors.ts`, and renders. Styling lives
 * entirely in the primitives/composites/typography — this page invents
 * no colors and holds no markup beyond slot wiring.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AIMemoPanel,
  ContextBar,
  OrderBar,
  PositionsList,
  PriceChartPanel,
  StatusBar,
  StrategyRail,
  TopBar,
  type ChartBar,
  type ChartRange,
  type OrderRow,
  type PositionTab,
  type StagedOrder,
} from "@/components/composites";
import { DeskLayout } from "@/components/layouts";
import {
  cancelOrder,
  getBars,
  getOrders,
  getPortfolioSummary,
  getPositions,
  placeOrder,
} from "@/lib/api";
import { isMarketOpen } from "@/lib/marketHours";
import {
  useIndices,
  usePortfolioSummary,
  useRegime,
  useStrategies,
} from "@/hooks/useQueries";
import { useMarketStore, useQuote, getFreshestQuoteTimestamp } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useToast } from "@/hooks/useToast";
import type { Position, Order } from "@/types";

import {
  emptyMemo,
  toContextCells,
  toMarketSymbol,
  toMetaCells,
  toPositionRows,
  toQuote,
  toRailItems,
  toRegime,
  toStatusPills,
  toStrategyOptions,
} from "./_desk/selectors";
import { useDeskClock } from "./_desk/useDeskClock";

const NAV_ROUTES = [
  { label: "Desk", href: "/", active: true },
  { label: "Strategies", href: "/strategies/momentum-quality" },
  { label: "Analytics", href: "/analytics" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Alerts", href: "/alerts" },
];

const BUILD_VERSION =
  process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev";

export default function DeskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  // Wave 14 perf-audit-r3 P0 #3: `useQuote(selectedSymbol)` only rerenders
  // this page when the selected symbol's quote changes — not on every WS
  // tick for every other watchlist symbol.
  const selectedQuote = useQuote(selectedSymbol);

  const portfolioSummary = usePortfolioStore((s) => s.summary);
  const positions = usePortfolioStore((s) => s.positions);
  const ordersFromStore = usePortfolioStore((s) => s.orders);

  // Shape the portfolio store's `Order[]` onto the OrderRow contract the
  // PositionsList expects. Previously the Book panel's Orders tab was
  // cosmetic — clicking it just changed the header highlight. This mapper
  // is memoised on `ordersFromStore` so the tab renders real data.
  const orderRows = useMemo<OrderRow[]>(() => {
    return ordersFromStore.map((o) => {
      const firstLeg = o.legs?.[0];
      const rawAny = o as unknown as Record<string, unknown>;
      // Prefer the typed `price` field; fall back to `limit_price` on the
      // raw record for orders that came through the WS portfolio channel
      // (which still uses snake-case keys). Same deal for stop_price.
      const limitPrice =
        firstLeg?.price ??
        o.price ??
        (typeof rawAny.limit_price === "number" ? (rawAny.limit_price as number) : undefined);
      const stopPrice =
        typeof rawAny.stop_price === "number"
          ? (rawAny.stop_price as number)
          : undefined;
      return {
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        quantity: o.quantity,
        limitPrice,
        stopPrice,
        status: o.status,
        rejectReason:
          typeof rawAny.reject_reason === "string"
            ? (rawAny.reject_reason as string)
            : undefined,
      };
    });
  }, [ordersFromStore]);

  /* ─── Live market + portfolio data via React Query ─────── */
  const { data: regimeResp } = useRegime();
  useIndices(); // warms the indices cache so the context bar stays fresh
  const { data: strategiesResp } = useStrategies();
  const { data: portfolioResp } = usePortfolioSummary();

  useEffect(() => {
    if (portfolioResp) {
      usePortfolioStore.getState().setSummary(portfolioResp);
    }
  }, [portfolioResp]);

  /* ─── Selected strategy for rail highlight + order bar ── */
  const rail = useMemo(() => toRailItems(strategiesResp), [strategiesResp]);
  const strategyOptions = useMemo(() => toStrategyOptions(rail), [rail]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(
    () => rail[0]?.id ?? ""
  );
  useEffect(() => {
    if (!selectedStrategyId && rail[0]?.id) {
      setSelectedStrategyId(rail[0].id);
    }
  }, [rail, selectedStrategyId]);

  // Reciprocal to the strategy-detail "View trades →" button, which routes
  // back here with `?strategy={id}`. When that query param is present on
  // mount (or changes), auto-select the matching rail item so the user
  // lands on the desk with their strategy highlighted.
  useEffect(() => {
    const q = searchParams?.get("strategy");
    if (q && rail.some((r) => r.id === q)) {
      setSelectedStrategyId(q);
    }
  }, [searchParams, rail]);

  /* ─── Chart bars — daily + current range toggle ─────────── */
  const [range, setRange] = useState<ChartRange>("1M");
  const [series, setSeries] = useState<ChartBar[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsError, setBarsError] = useState(false);
  // Nonce bumped by `retryBars` so the fetch effect re-runs without needing
  // the symbol or range to change. PriceChartPanel calls it from the
  // error-state Retry button.
  const [barsNonce, setBarsNonce] = useState(0);
  const retryBars = useCallback(() => setBarsNonce((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    async function fetchBars() {
      setBarsLoading(true);
      setBarsError(false);
      try {
        const bars = await getBars(selectedSymbol, "D", rangeToLimit(range));
        if (!cancelled) setSeries(bars);
      } catch {
        if (!cancelled) {
          setSeries([]);
          setBarsError(true);
        }
      } finally {
        if (!cancelled) setBarsLoading(false);
      }
    }
    fetchBars();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, range, barsNonce]);

  /* ─── Book tab + live orders count for context bar ─────── */
  const [bookTab, setBookTab] = useState<PositionTab>("positions");
  const [orderCount, setOrderCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Track whether we've already warned this session so repeated 30s
    // polls don't spam toasts. Reset on success.
    let hasWarned = false;

    async function fetchCounts() {
      // Helper: fetch a status, return `null` on error so we can
      // distinguish "no orders" (0) from "request failed" (null).
      // Previously `.catch(() => [])` rendered a 5xx as "no open orders"
      // silently — user believes their order book is clean when it
      // really can't be retrieved.
      async function safeFetch(status: string): Promise<unknown[] | null> {
        try {
          return await getOrders(status);
        } catch (err) {
          // Only log the first failure per session to avoid console spam.
          if (!hasWarned) {
            console.error(`[desk] getOrders(${status}) failed:`, err);
          }
          return null;
        }
      }

      const [pending, open] = await Promise.all([
        safeFetch("pending"),
        safeFetch("open"),
      ]);
      if (cancelled) return;

      const anyError = pending === null || open === null;
      if (anyError) {
        // Dispatch a one-time system notification so the user sees that
        // the order count is stale. Keep the last-known count rather
        // than zeroing it — "No open orders" on a 5xx is misleading.
        if (!hasWarned && typeof window !== "undefined") {
          hasWarned = true;
          window.dispatchEvent(
            new CustomEvent("alphadesk:system-notify", {
              detail: {
                kind: "error",
                title: "Order list unavailable",
                message:
                  "Couldn't fetch pending/open orders — showing last-known count. Retrying in 30s.",
              },
            })
          );
        }
        // Don't overwrite orderCount on error — keep the stale-but-real value.
        return;
      }

      hasWarned = false;
      setOrderCount((pending?.length ?? 0) + (open?.length ?? 0));
    }
    fetchCounts();
    const id = setInterval(fetchCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /* ─── Shaped props for the composites ──────────────────── */
  const regime = toRegime(regimeResp?.regime);
  const quote = toQuote(selectedQuote ?? undefined);
  const meta = toMetaCells(selectedQuote ?? undefined);
  const symbol = toMarketSymbol(selectedSymbol);
  const contextCells = toContextCells(portfolioSummary, positions as Position[], orderCount);
  const positionRows = toPositionRows(positions as Position[]);
  const clock = useDeskClock();
  const memo = emptyMemo(clock.slice(0, 8));

  // Re-render every 2s so the "Last tick" pill's elapsed seconds stay fresh
  // without piggy-backing on a full-clock re-render.
  const [tickHeartbeat, setTickHeartbeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTickHeartbeat((t) => t + 1), 2_000);
    return () => clearInterval(id);
  }, []);
  const lastTickSec = useMemo(() => {
    // Referenced in deps so the memo re-evaluates on each heartbeat.
    void tickHeartbeat;
    // Wave 14 perf-audit-r3 P1 #2: was `Object.values(quotes).reduce(...)`
    // with `quotes` in the dep array — that recomputed on every WS tick.
    // `getFreshestQuoteTimestamp()` reads imperatively from the store so
    // this memo only re-runs on the 2s heartbeat.
    const ts = getFreshestQuoteTimestamp();
    if (!ts) return undefined;
    // Server timestamps are usually seconds — normalise if they look like ms.
    const epochMs = ts > 1e12 ? ts : ts * 1000;
    const delta = (Date.now() - epochMs) / 1000;
    return delta >= 0 && delta < 86_400 ? delta : undefined;
  }, [tickHeartbeat]);

  const statusPills = toStatusPills({
    brokerConnected: !portfolioSummary.is_demo,
    marketOpen: isMarketOpen(),
    claudeHealthy: true,
    // Always pass a tick value so the StatusBar renders 4 pills — even
    // when we have no data yet, show "Last tick —" rather than omit.
    lastTickSec,
  });

  /* ─── Event handlers — kept inline because they're trivial ─ */
  function handleNavigate(href: string) {
    router.push(href);
  }

  function handleSelectStrategy(id: string) {
    // Keep the visual highlight on the current desk for when the user
    // navigates back — then route to the strategy detail page per the
    // design spec (`qa/pages/strategies-detail.md`).
    setSelectedStrategyId(id);
    router.push(`/strategies/${id}`);
  }

  function handleSelectSymbol(symbol: string) {
    setSelectedSymbol(symbol);
  }

  const [orderBarResetTick, setOrderBarResetTick] = useState(0);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  /**
   * Refresh positions / orders / summary from the REST API.
   *
   * Wave 28 fix: previously the desk only updated via the 30-second
   * poll in `useDataPipeline` and the WebSocket `portfolio` channel.
   * Neither fires on immediate order-fill paths (Alpaca only publishes
   * ``order_submitted``, not fill events through this socket), so the
   * desk could show a stale empty Positions list for up to 30s after a
   * market order filled. Calling this helper in the success branch of
   * ``handleStageOrder`` closes the gap for the user who just placed
   * the order; the poll + WS still cover concurrent changes from
   * pipeline fills.
   */
  const refreshPortfolio = useCallback(async () => {
    const results = await Promise.allSettled([
      getPositions(),
      getOrders(), // default = all statuses after Wave 28 backend change
      getPortfolioSummary(),
    ]);
    if (results[0].status === "fulfilled") {
      usePortfolioStore.getState().setPositions(results[0].value);
    }
    if (results[1].status === "fulfilled") {
      usePortfolioStore.getState().setOrders(results[1].value);
      setOrderCount(results[1].value.filter((o) => o.status === "pending" || o.status === "partial").length);
    }
    if (results[2].status === "fulfilled") {
      usePortfolioStore.getState().setSummary(results[2].value);
    }
    // Also fan out a custom event so other panes listening for a
    // portfolio refresh (strategy rail, analytics, …) can re-pull their
    // own data without needing a ref to this callback.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:refresh-portfolio"));
    }
  }, []);

  async function handleStageOrder(order: StagedOrder) {
    // Submit the staged order to the real trading API. On success,
    // push the returned order into the local store, clear the OrderBar,
    // and toast. On failure, keep the form state and toast the error.
    if (submittingOrder) return;
    // Basic client-side validation — the OrderBar's inputs should already
    // have enforced most of this, but a last-line-of-defense guard keeps
    // us from firing a 422 at the backend.
    const symbol = (order.symbol || "").trim().toUpperCase();
    const qty = Number(order.quantity);
    if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      toast({ type: "error", message: "Enter a valid symbol (1–10 letters/digits)" });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ type: "error", message: "Quantity must be a positive number" });
      return;
    }
    if ((order.type === "limit" || order.type === "stop_limit") && (order.price == null || !Number.isFinite(order.price))) {
      toast({ type: "error", message: "Limit orders require a price" });
      return;
    }
    const stopNum = order.stop ? Number(order.stop) : undefined;
    if ((order.type === "stop" || order.type === "stop_limit") && (stopNum == null || !Number.isFinite(stopNum))) {
      toast({ type: "error", message: "Stop orders require a stop price" });
      return;
    }

    setSubmittingOrder(true);
    try {
      const placed: Order = await placeOrder({
        symbol,
        side: order.side,
        type: order.type,
        quantity: qty,
        price: order.price,
        stop_price: stopNum,
      });
      usePortfolioStore.getState().addOrder(placed);

      // Surface a clearer toast copy than the old "staged" wording — the
      // button is "Place order", so the user expects the action was to
      // place. Include a "View orders" action that jumps the Book to the
      // Orders tab so they can see the new row.
      toast({
        type: "success",
        message: `Order placed: ${qty} ${symbol} ${order.type} — ${placed.status ?? "pending"}`,
        action: {
          label: "View orders",
          onClick: () => setBookTab("orders"),
        },
      });

      // Bump a tick so OrderBar resets its internal field state via `key`.
      setOrderBarResetTick((t) => t + 1);

      // Post-fill refresh (persona-3 P0 #5). Kick off in the background
      // so we don't block the submit flow — the toast already fired.
      refreshPortfolio().catch(() => {
        /* already logged in each individual fetch helper */
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order submission failed";
      toast({ type: "error", message });
      // Keep the OrderBar populated so the user can correct + retry.
    } finally {
      setSubmittingOrder(false);
    }
  }

  /**
   * Cancel a working order from the Orders tab.
   *
   * Removes the order optimistically from the store so the UI updates
   * before the network roundtrip; on failure we re-pull to correct.
   */
  const handleCancelOrder = useCallback(
    async (id: string) => {
      try {
        await cancelOrder(id);
        usePortfolioStore
          .getState()
          .updateOrderStatus(id, "cancelled");
        toast({ type: "success", message: "Order cancelled" });
        // Refresh so the UI reflects the broker's final status (filled
        // vs cancelled race) and positions update if the cancel was a
        // no-op because the order already filled.
        refreshPortfolio().catch(() => {});
      } catch (err) {
        const message = err instanceof Error ? err.message : "Cancel failed";
        toast({ type: "error", message });
      }
    },
    [toast, refreshPortfolio]
  );

  return (
    <DeskLayout
      topBar={
        <div
          onClickCapture={(e) => {
            const a = (e.target as HTMLElement).closest("a[href]");
            if (a) {
              e.preventDefault();
              handleNavigate(a.getAttribute("href")!);
            }
          }}
        >
          <TopBar
            currentRoute="/"
            routes={NAV_ROUTES}
            regime={regime}
            clockEt={clock}
            avatarInitial="α"
          />
        </div>
      }
      contextBar={<ContextBar cells={contextCells} />}
      rail={
        <StrategyRail
          items={rail}
          selectedId={selectedStrategyId}
          onSelect={handleSelectStrategy}
        />
      }
      center={
        <>
          <PriceChartPanel
            symbol={symbol}
            quote={quote}
            meta={meta}
            series={series}
            activeRange={range}
            onRangeChange={setRange}
            isLoading={barsLoading}
            error={barsError}
            onRetry={retryBars}
            className="flex-1 min-h-0"
          />
          <OrderBar
            key={`orderbar-${orderBarResetTick}`}
            symbol={selectedSymbol}
            strategies={strategyOptions}
            onSubmit={handleStageOrder}
            submitting={submittingOrder}
            // Honest-default set (persona-3 P0 #7):
            //   qty = 1 (not 100) — accidental over-submission is worse
            //   type = market — first click doesn't error asking for a price
            defaults={{
              strategyId: selectedStrategyId,
              side: "buy",
              quantity: 1,
              type: "market",
            }}
            // The Alpaca base URL is always the paper endpoint in this
            // deployment (see backend config), so the button label is
            // accurate. If/when a LIVE config lands this string is a
            // one-line change.
            submitDestination="Submits to paper account"
            submitLabel="Place order"
          />
        </>
      }
      right={
        <>
          <div className="flex-1 min-h-0 overflow-auto">
            <PositionsList
              positions={positionRows}
              // Wire the Orders tab to real data (persona-3 #8) —
              // previously this tab rendered an empty state even when
              // the store had working orders. Cancel + tab click work
              // without a page navigation.
              orders={orderRows}
              onCancelOrder={handleCancelOrder}
              activeTab={bookTab}
              onTabChange={setBookTab}
              onRowClick={(id) => {
                // Orders tab passes the symbol directly; Positions tab
                // passes the composite row id (symbol-index).
                const pos = positionRows.find((r) => r.id === id);
                if (pos) {
                  handleSelectSymbol(pos.symbol);
                  return;
                }
                // Fallback: treat the id as a symbol (Orders tab path).
                handleSelectSymbol(id);
              }}
            />
          </div>
          <AIMemoPanel memo={memo} />
        </>
      }
      statusBar={<StatusBar pills={statusPills} buildVersion={BUILD_VERSION} />}
    />
  );
}

/* ─── Tiny helpers kept inline ──────────────────────────── */

function rangeToLimit(r: ChartRange): number {
  switch (r) {
    case "1D": return 2;
    case "5D": return 5;
    case "1M": return 22;
    case "3M": return 66;
    case "6M": return 132;
    case "YTD": return 260;
    case "1Y": return 260;
    case "ALL": return 1000;
  }
}

// isMarketOpen now lives in @/lib/marketHours and uses Intl America/New_York
// so it handles EST/EDT correctly year-round. See wave-8 audit finding.
