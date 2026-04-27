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
  TopBar,
  Watchlist,
  type ChartBar,
  type ChartRange,
  type OrderRow,
  type PositionTab,
  type StagedOrder,
} from "@/components/composites";
import { DashboardLayout } from "@/components/layouts";
// Wave 6α Fix 6 (persona-124 P0): MorningBrief was previously dead code —
// the component + its `useMorningBrief` query existed but nothing rendered
// it. Mount in the right-hand column above the Positions list, where the
// user's "what happened overnight" context naturally lives next to their
// book. Self-dismissing per-day (see MorningBrief.getDismissKey) so a
// trader who closes it doesn't see it resurrected on every nav.
import { MorningBrief } from "@/components/dashboard/MorningBrief";
import {
  cancelOrder,
  getBars,
  getOrders,
  getPortfolioSummary,
  getPositions,
  placeOrder,
} from "@/lib/api";
import { isMarketOpen } from "@/lib/marketHours";
import { ORDER_BAR_DEFAULTS, isValidOrderQty } from "@/lib/orderDefaults";
// `computeStrategyCounts` was used to render a "N / M" pill inside the
// dashboard's StrategyRail header; the rail is no longer on the
// dashboard (2026-04-20 redesign — it duplicated `/strategies`). The
// helper still lives in `@/lib/strategiesSummary` for use on the
// `/strategies` page header.
import {
  useIndices,
  useRegime,
  useStrategies,
} from "@/hooks/useQueries";
import { useShortcutHandler } from "@/hooks/useKeyboardShortcuts";
import { useMarketStore, useQuote, getFreshestQuoteTimestamp } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useUIStore } from "@/stores/ui";
import { useSparklineBars } from "@/hooks/useSparklineBars";
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

// BUG-005: unify desk nav with the (dashboard)/layout TopBar nav so docs
// references to "Dashboard" and "Trade" always resolve. The desk keeps its
// serif "αAlphaDesk" wordmark (rendered in the composites/TopBar), but the
// nav link set matches layout/TopBar.tsx exactly.
const NAV_ROUTES = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Strategies", href: "/strategies" },
  { label: "Trade", href: "/trade" },
  { label: "Analytics", href: "/analytics" },
  { label: "Alerts", href: "/alerts" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Reports", href: "/reports" },
];

// 2026-04-20 round 2 (REVERTED 2026-04-21): tried `export const dynamic
// = "force-dynamic"` and `revalidate = 0` to bust a stale prerender.
// Next.js 16 rejects both in a "use client" component — the build fails
// at prerender time with `Invalid revalidate value ... must be a
// non-negative number or false`, because client components can't own
// route-segment config. The prerender-cache bust has to live in a
// server-component wrapper (a future refactor) — for now, the
// raw-ssh deploy pipeline fully tears containers down + up with
// fresh chunks, so the stale-chunk problem is handled at the deploy
// layer instead.

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
  // BUG-017: `usePortfolioSummary` was firing a second /portfolio/summary
  // GET on every mount alongside the one `useDataPipeline` already issues
  // via `fetchPortfolioData()`. The store is the single source of truth
  // here — the pipeline effect keeps it fresh on its own interval.
  const { data: regimeResp } = useRegime();
  useIndices(); // warms the indices cache so the context bar stays fresh
  const { data: strategiesResp } = useStrategies();

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

  // Wave 32 persona-6 #1: number-key timeframes (1-8) dispatch
  // `chart:set-range:<RANGE>` actions; the desk owns range state, so it
  // intercepts the family handler and updates `setRange`. Uses the
  // page-scoped registry exported from `useKeyboardShortcuts`, which
  // rescues the previously-dead `useShortcutHandler` export.
  const handleChartRangeShortcut = useCallback((actionId: string) => {
    const value = actionId.split(":")[2];
    const valid: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];
    if (valid.includes(value as ChartRange)) {
      setRange(value as ChartRange);
    }
  }, []);
  useShortcutHandler("chart:set-range", handleChartRangeShortcut);
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
        // 2026-04-20 round 2: switched from always-daily to a
        // range-aware timeframe so zooming in on the chart actually
        // shows MORE granular data, not a compressed-daily view of
        // the same 2 bars. A user selecting `1D` now gets 5-minute
        // candles (≈78 bars across the 6.5h session); `1M` gets
        // 1-hour candles; `6M+` stays daily. Matches the behaviour
        // on TradingView / ToS / Webull where each timeframe pill
        // loads its own granularity.
        const [tf, limit] = rangeToTimeframe(range);
        const bars = await getBars(selectedSymbol, tf, limit);
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
      // BUG-017: previously this fired TWO GETs every 30s —
      // `/trades/orders?status=pending` and `/trades/orders?status=open`.
      // We now fetch the full order list ONCE and bucket client-side.
      // That cuts the desk page's per-minute order-endpoint footprint in
      // half and lets us use the freshly-fetched list to update the store
      // too (so the OrderBar's Orders tab doesn't need its own poll).
      let orders: Array<{ status?: string }> | null;
      try {
        orders = (await getOrders()) as Array<{ status?: string }>;
      } catch (err) {
        if (!hasWarned) {
          console.error(`[desk] getOrders() failed:`, err);
        }
        orders = null;
      }
      if (cancelled) return;

      if (orders === null) {
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
                  "Couldn't fetch working orders — showing last-known count. Retrying in 30s.",
              },
            })
          );
        }
        // Don't overwrite orderCount on error — keep the stale-but-real value.
        return;
      }

      hasWarned = false;
      // Round-11 / Y-3 (P0): include both ``partial`` and the raw
      // Alpaca-event name ``partial_fill`` — the OrderStatus union has
      // both variants but the working-set check used to match only one.
      // A partially-filled order would silently fall out of the count.
      const working = orders.filter(
        (o) =>
          o.status === "pending" ||
          o.status === "open" ||
          o.status === "partial" ||
          o.status === "partial_fill",
      );
      setOrderCount(working.length);
    }
    fetchCounts();
    const id = setInterval(fetchCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /* ─── Shaped props for the composites ──────────────────── */
  // Round-10 / V-1.01 (P0): every selector below was a fresh
  // function call in render, returning a new object/array each
  // cycle and breaking React.memo / useMemo on every consumer.
  // With ``tickHeartbeat`` ticking every 2s and per-symbol quote
  // pushes ~10Hz on liquid tickers, the desk was reshaping the
  // entire prop set continuously. Wrap each selector in useMemo
  // keyed on the actual inputs so the references stay stable.
  const marketOpen = isMarketOpen();
  const regime = useMemo(() => toRegime(regimeResp?.regime), [regimeResp?.regime]);
  const quote = useMemo(() => toQuote(selectedQuote ?? undefined), [selectedQuote]);
  // BUG-032: pass marketOpen so `toMetaCells` can render "unavailable"
  // instead of "—" when the session is closed and the cells will never
  // populate for this tape.
  const meta = useMemo(
    () => toMetaCells(selectedQuote ?? undefined, { marketOpen }),
    [selectedQuote, marketOpen],
  );
  const symbol = useMemo(() => toMarketSymbol(selectedSymbol), [selectedSymbol]);
  const contextCells = useMemo(
    () => toContextCells(portfolioSummary, positions as Position[], orderCount),
    [portfolioSummary, positions, orderCount],
  );
  // Phase-2 / SP-1 (Tufte): fetch 30-day daily closes for every open
  // position so the PositionsList row can render a sparkline beside
  // the strategy name. The hook batches via react-query so a 10-leg
  // book triggers 10 parallel cached fetches with 5-min staleTime.
  const positionSymbols = useMemo(
    () => Array.from(new Set((positions as Position[]).map((p) => p.symbol))),
    [positions],
  );
  const positionSparks = useSparklineBars(positionSymbols, { timeframe: "D", limit: 30 });
  const positionRows = useMemo(
    () =>
      toPositionRows(positions as Position[]).map((row) => ({
        ...row,
        spark30d: positionSparks[row.symbol],
      })),
    [positions, positionSparks],
  );
  const clock = useDeskClock();
  const memo = useMemo(() => emptyMemo(clock.slice(0, 8)), [clock]);

  // Round-10 / V-1.02 (P0): the 2s tickHeartbeat used to live here
  // and re-render the ENTIRE DeskPage just to keep the "Last tick"
  // StatusBar pill fresh — including the chart panel, watchlist,
  // positions, OrderBar. ~30 unnecessary parent renders per minute
  // even with the V-1.01 memoization. Now isolated into the
  // ``LastTickStatusPills`` component below: the parent renders the
  // initial pills synchronously, then the small child component
  // owns the heartbeat and re-renders only itself.
  // Phase-1 / SB-1: surface tradingMode + pipeline state into the
  // status rail. The mode pill is the most-consequential single
  // surface in the chrome — it's the user's only visual anchor that
  // the system is in PAPER vs LIVE state.
  const tradingMode = useUIStore((s) => s.tradingMode);
  const statusPillsBase = useMemo(
    () =>
      toStatusPills({
        brokerConnected: !portfolioSummary.is_demo,
        marketOpen,
        claudeHealthy: true,
        // initial value; LastTickStatusPills will refresh in place
        lastTickSec: undefined,
        // Phase-1 / SB-1: pipeline + mode pills.
        pipelineRunning: 0,  // TODO: wire to /api/v1/pipeline/status when it ships per-strategy progress
        pipelineTotal: 12,
        tradingMode,
      }),
    [portfolioSummary.is_demo, marketOpen, tradingMode],
  );

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
  // BUG-002 — inline-error state for the OrderBar. Parent owns this so a
  // 422/4xx from the backend renders both a toast AND a persistent red
  // message under the Place button. Cleared on every new submit attempt.
  const [orderError, setOrderError] = useState<string | null>(null);

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
      // Round-11 / Y-3: keep the working set in sync with the cancel-
      // count predicate above. Both the legacy ``partial`` and the raw
      // Alpaca ``partial_fill`` count.
      const workingStatuses = new Set(["pending", "open", "partial", "partial_fill"]);
      setOrderCount(
        (results[1].value as Array<{ status?: string }>).filter(
          (o) => o.status != null && workingStatuses.has(o.status),
        ).length,
      );
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
    // Reset any previous inline error on a fresh submit attempt.
    setOrderError(null);
    // Basic client-side validation — the OrderBar's inputs should already
    // have enforced most of this, but a last-line-of-defense guard keeps
    // us from firing a 422 at the backend.
    const symbol = (order.symbol || "").trim().toUpperCase();
    const qty = Number(order.quantity);
    const fail = (msg: string) => {
      toast({ type: "error", message: msg });
      setOrderError(msg);
    };
    if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      fail("Enter a valid symbol (1–10 letters/digits)");
      return;
    }
    if (!isValidOrderQty(qty)) {
      fail("Quantity must be a whole number between 1 and 999,999,999");
      return;
    }
    if ((order.type === "limit" || order.type === "stop_limit") && (order.price == null || !Number.isFinite(order.price))) {
      fail("Limit orders require a price");
      return;
    }
    const stopNum = order.stop ? Number(order.stop) : undefined;
    if ((order.type === "stop" || order.type === "stop_limit") && (stopNum == null || !Number.isFinite(stopNum))) {
      fail("Stop orders require a stop price");
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
      // BUG-002 — mirror the toast as an inline error on the OrderBar so
      // the user sees *why* their click did nothing even if the toast
      // stack was missed (timing, cursor off-screen, etc.).
      setOrderError(message);
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

  // Phase-2 / KP-1: listen for the Cmd+K palette's "Cancel all working
  // orders" event. Routes through the same cancelOrder + react-query
  // refresh as a manual click so optimistic state + final reconciliation
  // stays consistent.
  useEffect(() => {
    function onCancelAll() {
      const working = (ordersFromStore as Order[] | undefined)?.filter(
        (o) =>
          o.status === "pending" ||
          o.status === "submitted" ||
          o.status === "open" ||
          o.status === "partial" ||
          o.status === "partial_fill",
      ) ?? [];
      if (working.length === 0) {
        toast({ type: "info", message: "No working orders to cancel." });
        return;
      }
      Promise.allSettled(working.map((o) => cancelOrder(o.id))).then((rs) => {
        const ok = rs.filter((r) => r.status === "fulfilled").length;
        const fail = rs.length - ok;
        toast({
          type: fail === 0 ? "success" : fail === rs.length ? "error" : "info",
          message:
            fail === 0
              ? `Cancelled ${ok} working order${ok === 1 ? "" : "s"}.`
              : `Cancelled ${ok}/${rs.length}; ${fail} failed (broker may have filled them).`,
        });
        refreshPortfolio().catch(() => {});
      });
    }
    window.addEventListener("alphadesk:cancel-all-orders", onCancelAll as EventListener);
    return () => {
      window.removeEventListener("alphadesk:cancel-all-orders", onCancelAll as EventListener);
    };
  }, [ordersFromStore, toast, refreshPortfolio]);

  return (
    <DashboardLayout
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
          {/* BUG-022 — WCAG 2.4.6/1.3.1: dashboard previously had no <h1>.
              Visually-hidden heading provides a landmark for AT and
              document-outline tooling without altering the visual design. */}
          <h1 className="sr-only">Trading dashboard</h1>
          <TopBar
            currentRoute="/"
            routes={NAV_ROUTES}
            regime={regime}
            clockEt={clock}
            avatarInitial="α"
            // BUG-054 — surface the palette as a visible "Search ⌘K"
            // chip so users discover it without memorising the shortcut.
            onOpenSearch={() => useUIStore.getState().setCommandPaletteOpen(true)}
          />
        </div>
      }
      contextBar={<ContextBar cells={contextCells} />}
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
            errorMessage={orderError}
            // BUG-006 — defaults unified across `/` and `/trade` via
            // `ORDER_BAR_DEFAULTS` so a user bouncing between the two
            // pages sees the same pre-filled qty / type. Keep the
            // per-page `strategyId` wiring because that's data-derived.
            defaults={{
              ...ORDER_BAR_DEFAULTS,
              strategyId: selectedStrategyId,
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
          {/* Round-8 killer-move 1: Watchlist + Positions are the ONLY
              always-visible right-rail panels. MorningBrief and the
              AI Memo footer used to live here too — they both consume
              ~120-180 px of vertical chrome whether or not they have
              content, which violated the "calm, single-hero per page"
              principle. They now live in the BriefDrawer below
              (collapsed by default; toggleable per-session). The
              dashboard right rail breathes. */}
          <div className="shrink-0 max-h-[34vh] overflow-auto p-2">
            <Watchlist />
          </div>
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
          <BriefDrawer memo={memo} />
        </>
      }
      statusBar={
        <LastTickStatusBar
          base={statusPillsBase}
          buildVersion={BUILD_VERSION}
          marketOpen={marketOpen}
        />
      }
    />
  );
}

/**
 * Round-10 / V-1.02 (P0): owns the 2-second heartbeat that keeps the
 * "Last tick" pill's elapsed seconds fresh. Renders the StatusBar
 * directly so DeskPage can stay still — only this small child
 * re-renders on each tick. We mutate ``base`` to swap in a new last
 * pill rather than rebuild every pill from scratch (the toggle is
 * cheap because ``base`` is already memoised in the parent).
 */
function LastTickStatusBar({
  base,
  buildVersion,
  marketOpen,
}: {
  base: ReturnType<typeof import("./_desk/selectors").toStatusPills>;
  buildVersion: string;
  marketOpen: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Round-10 / V-1.12 (P2): pause the heartbeat when the tab is
    // hidden so we don't wake up the CPU 30 times/minute on background
    // tabs that the user has stashed for the day.
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(() => setTick((t) => t + 1), 2_000);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const lastTickSec = useMemo(() => {
    void tick; // dep so the value is recomputed on each heartbeat
    const ts = getFreshestQuoteTimestamp();
    if (!ts) return undefined;
    const epochMs = ts > 1e12 ? ts : ts * 1000;
    const delta = (Date.now() - epochMs) / 1000;
    return delta >= 0 && delta < 86_400 ? delta : undefined;
  }, [tick]);

  const pills = useMemo(() => {
    // Slice-3 / CH-1B (chart audit 2026-04-26): the previous code wrote
    // to ``next[next.length - 1]`` to refresh the Last-tick pill. After
    // SB-1 inserted Pipeline + Mode pills AFTER Last-tick, the index
    // drifted — the heartbeat now overwrote the Mode pill with a
    // "Feed idle" label, and the genuine Last-tick pill kept its
    // stale "Last tick —" copy. Result: the bottom rail showed
    // "Feed idle · market closed" TWICE (in the Last-tick slot and
    // in the misnamed Mode slot). Anchor the rewrite by matching
    // the pill label prefix so it tracks the correct pill regardless
    // of insertion order.
    if (base.length === 0) return base;
    const idx = base.findIndex(
      (p) =>
        p.label.startsWith("Last tick") ||
        p.label.startsWith("Feed idle"),
    );
    if (idx === -1) return base;
    const next = base.slice();
    next[idx] = {
      ...next[idx],
      label:
        lastTickSec != null
          ? `Last tick ${lastTickSec.toFixed(2)}s`
          : marketOpen
            ? "Last tick —"
            : "Feed idle · market closed",
    };
    return next;
  }, [base, lastTickSec, marketOpen]);

  return <StatusBar pills={pills} buildVersion={buildVersion} />;
}

/**
 * Round-8 killer-move 1: collapsible "Today's brief" drawer that hosts
 * MorningBrief + AI Memo. Pinned at the bottom of the right rail,
 * collapsed by default — gives the user a single line of context
 * ("View today's brief →") without consuming the 120-180 px the two
 * panels needed when they were always-mounted. Expansion state is
 * per-session (does not persist) so the user gets a clean rail every
 * morning by default but can keep the brief open for the rest of a
 * working session. The MorningBrief component still self-dismisses
 * once read, so opening the drawer twice in a day is a no-op for
 * dismissed sessions.
 */
function BriefDrawer({ memo }: { memo: Parameters<typeof AIMemoPanel>[0]["memo"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-slot="brief-drawer"
      className="shrink-0 border-t border-border-hair bg-bg"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Round-10 / X-9 (P1): ``min-h-11`` (44px) hits Apple HIG +
        // WCAG 2.5.5 touch-target floor. ``py-2`` alone gave ~36-40px
        // which was below the threshold on phones.
        className="flex w-full min-h-11 items-center justify-between px-4 py-2 text-left t-meta hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-gold-300"
      >
        <span>
          <span className="u-brand">Today&apos;s brief</span>
          <span className="ml-2 u-muted">— overnight + AI memo</span>
        </span>
        <span aria-hidden="true" className="u-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-border-hair">
          <MorningBrief />
          <AIMemoPanel memo={memo} />
        </div>
      )}
    </div>
  );
}

/* ─── Tiny helpers kept inline ──────────────────────────── */

// Range pill → (timeframe, bar-limit) lookup. Shorter ranges intentionally
// request finer timeframes so a user zooming to 1D sees the day's
// 5-minute candles, not a two-bar daily compression. Limits are calibrated
// to comfortably cover the range's calendar span:
//   1D  → 5-min bars, 78 bars per 6.5-hour session × some headroom
//   5D  → 15-min bars
//   1M  → 1-hour bars (~7 × 22 trading days)
//   3M+ → daily bars (`D`)
//   ALL → weekly bars so we don't pull 10 years of 1D data
//
// This mirrors the default stepping used by TradingView / ToS / Webull.
// The backend's `/api/v1/market/bars/<sym>` endpoint accepts the
// TimeFrame codes `1m, 5m, 15m, 1H, 4H, D, W, M` — see the mapping in
// `getBars` at lib/api.ts.
function rangeToTimeframe(
  r: ChartRange,
): [import("@/types").TimeFrame, number] {
  switch (r) {
    case "1D":  return ["5m",  100];   // ~6.5h session, some pre/post
    case "5D":  return ["15m", 140];   // 5 sessions × ~26 fifteen-min bars
    case "1M":  return ["1H",  160];   // 22 days × 7 hours
    case "3M":  return ["D",   66];
    case "6M":  return ["D",   132];
    case "YTD": return ["D",   260];
    case "1Y":  return ["D",   260];
    case "ALL": return ["W",   520];
  }
}

// isMarketOpen now lives in @/lib/marketHours and uses Intl America/New_York
// so it handles EST/EDT correctly year-round. See wave-8 audit finding.
