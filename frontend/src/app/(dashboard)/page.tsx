"use client";

/**
 * AlphaDesk root dashboard.
 *
 * This route is the graphless operating picture: account state, risk posture,
 * strategy health, and next actions. The full chart and order ticket live on
 * /trade so the dashboard can stay focused on decision support.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementType, ReactNode, RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BriefcaseBusiness,
  Clock3,
  ListChecks,
  Radio,
  ShieldCheck,
  Target,
  WalletCards,
} from "lucide-react";

import {
  ContextBar,
  PositionsList,
  StatusBar,
  TopBar,
  type OrderRow,
  type PositionTab,
  Watchlist,
} from "@/components/composites";
import { DashboardLayout } from "@/components/layouts";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/button";
import {
  cancelOrder,
  getOrders,
  getPortfolioSummary,
  getPositions,
  getStrategies,
  placeOrder,
  toggleStrategy,
  type PipelineStatus,
} from "@/lib/api";
import { isMarketOpen } from "@/lib/marketHours";
import { isWorkingOrderStatus } from "@/lib/orders";
import { cn, formatCurrency, formatGreek, formatPercent } from "@/lib/utils";
// `computeStrategyCounts` was used to render a "N / M" pill inside the
// dashboard's StrategyRail header; the rail is no longer on the
// dashboard (2026-04-20 redesign — it duplicated `/strategies`). The
// helper still lives in `@/lib/strategiesSummary` for use on the
// `/strategies` page header.
import {
  useIndices,
  usePipelineStatus,
  useRegime,
  useStrategies,
} from "@/hooks/useQueries";
import { useMarketStore, useQuote, getFreshestQuoteTimestamp } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useUIStore } from "@/stores/ui";
import { useSparklineBars } from "@/hooks/useSparklineBars";
import { useToast } from "@/hooks/useToast";
import type { Position, Order, PortfolioGreeks, PortfolioSummary } from "@/types";

import {
  toContextCells,
  toPositionRows,
  toQuote,
  toRailItems,
  toRegime,
  toStatusPills,
  type RawStrategy,
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
  const bookPanelRef = useRef<HTMLDivElement | null>(null);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  // Wave 14 perf-audit-r3 P0 #3: `useQuote(selectedSymbol)` only rerenders
  // this page when the selected symbol's quote changes — not on every WS
  // tick for every other watchlist symbol.
  const selectedQuote = useQuote(selectedSymbol);

  const portfolioSummary = usePortfolioStore((s) => s.summary);
  const positions = usePortfolioStore((s) => s.positions);
  const ordersFromStore = usePortfolioStore((s) => s.orders);
  const greeks = usePortfolioStore((s) => s.greeks);

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
  const { data: indicesResp } = useIndices();
  const strategiesQuery = useStrategies();
  const strategiesResp = strategiesQuery.data;
  const { data: pipelineStatus } = usePipelineStatus();

  /* ─── Selected strategy for dashboard focus + deep links ─ */
  const rail = useMemo(() => toRailItems(strategiesResp), [strategiesResp]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(
    () => rail[0]?.id ?? ""
  );
  const selectedStrategy = useMemo(
    () => rail.find((s) => s.id === selectedStrategyId) ?? rail[0],
    [rail, selectedStrategyId],
  );
  const activeStrategyCount = useMemo(
    () => rail.filter((s) => s.status === "active").length,
    [rail],
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
      let orders: Order[] | null;
      try {
        orders = await getOrders();
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
      usePortfolioStore.getState().setOrders(orders);
      const working = orders.filter((o) => isWorkingOrderStatus(o.status));
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
  const brokerStatus =
    portfolioSummary.is_demo === true || portfolioSummary.source === "demo"
      ? "not_linked"
      : portfolioSummary.source === "alpaca" || portfolioSummary.is_demo === false
        ? "connected"
        : "pending";

  // SB-1 pipeline pill: the live running count is owned by the
  // ``LastTickStatusBar`` leaf below — ``usePipelineStatus`` lives
  // there so the desk page doesn't re-render every 60s when the
  // poller refreshes. Defaults to 0 here; the leaf overwrites.
  const statusPillsBase = useMemo(
    () =>
      toStatusPills({
        brokerConnected: brokerStatus === "connected",
        brokerStatus,
        marketOpen,
        claudeHealthy: true,
        // initial value; LastTickStatusPills will refresh in place
        lastTickSec: undefined,
        pipelineRunning: 0,
        pipelineTotal: rail.length,
        tradingMode,
      }),
    [brokerStatus, marketOpen, rail.length, tradingMode],
  );

  /* ─── Event handlers — kept inline because they're trivial ─ */
  function handleNavigate(href: string) {
    router.push(href);
  }

  function handleOpenOrders() {
    setBookTab("orders");
    window.requestAnimationFrame(() => {
      const panel = bookPanelRef.current;
      if (!panel) return;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      panel.focus({ preventScroll: true });
    });
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
      setOrderCount(
        (results[1].value as Array<{ status?: string }>).filter((o) =>
          isWorkingOrderStatus(o.status),
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
        (o) => isWorkingOrderStatus(o.status),
      ) ?? [];
      if (working.length === 0) {
        toast({ type: "info", message: "No working orders to cancel." });
        return;
      }
      // Cap concurrency at 5 in flight — Alpaca rate-limits at 200
      // req/min and a heavy desk can trip it on a "cancel all" burst.
      const CONCURRENCY = 5;
      let cursor = 0;
      const results: PromiseSettledResult<unknown>[] = new Array(working.length);
      async function worker() {
        while (cursor < working.length) {
          const i = cursor++;
          try {
            const v = await cancelOrder(working[i].id);
            results[i] = { status: "fulfilled", value: v };
          } catch (err) {
            results[i] = { status: "rejected", reason: err };
          }
        }
      }
      Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, working.length) }, worker),
      ).then(() => {
        const ok = results.filter((r) => r?.status === "fulfilled").length;
        const fail = results.length - ok;
        const allFailed = ok === 0 && fail > 0;
        toast({
          type: fail === 0 ? "success" : allFailed ? "error" : "info",
          message:
            fail === 0
              ? `Cancelled ${ok} working order${ok === 1 ? "" : "s"}.`
              : `Cancelled ${ok}/${results.length}; ${fail} failed (broker may have filled them).`,
        });
        refreshPortfolio().catch(() => {});
      });
    }
    window.addEventListener("alphadesk:cancel-all-orders", onCancelAll as EventListener);
    return () => {
      window.removeEventListener("alphadesk:cancel-all-orders", onCancelAll as EventListener);
    };
  }, [ordersFromStore, toast, refreshPortfolio]);

  // KP-1 dispatchers (CommandPalette → flatten-symbol /
  // pause-all-strategies) had no listeners; toasts said "Flattening
  // AAPL…" but nothing closed. Wire them here.
  // (The ``alphadesk:open-shortcuts`` consumer lives in
  // ``useKeyboardShortcuts`` where the overlay state is owned.)
  useEffect(() => {
    // In-flight guards. Holding the keybind would otherwise fire one
    // market order per repeat tick before the position store catches
    // up, double-flattening the position. Same for pause-all (the
    // second invocation could re-toggle a still-active strategy).
    const flatteningInflight = new Set<string>();
    let pauseAllInflight = false;
    async function onFlatten(e: Event) {
      const detail = (e as CustomEvent<{ symbol?: string }>).detail;
      const sym = detail?.symbol ?? "";
      if (!sym) return;
      if (flatteningInflight.has(sym)) {
        toast({ type: "info", message: `Already flattening ${sym}…` });
        return;
      }
      const positions = usePortfolioStore.getState().positions ?? [];
      const pos = positions.find((p) => p.symbol === sym);
      if (!pos || !pos.quantity) {
        toast({ type: "info", message: `No open position in ${sym}.` });
        return;
      }
      flatteningInflight.add(sym);
      try {
        await placeOrder({
          symbol: sym,
          side: pos.quantity > 0 ? "sell" : "buy",
          type: "market",
          quantity: Math.abs(pos.quantity),
        });
        toast({ type: "success", message: `Flatten ${sym} order submitted.` });
        refreshPortfolio().catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Flatten failed";
        toast({ type: "error", message: msg });
      } finally {
        flatteningInflight.delete(sym);
      }
    }
    async function onPauseAll() {
      if (pauseAllInflight) {
        toast({ type: "info", message: "Pause-all already in progress…" });
        return;
      }
      pauseAllInflight = true;
      try {
        const strategies = await getStrategies();
        const names = strategies
          .filter((s) => s.status === "active")
          .map((s) => s.id);
        if (names.length === 0) {
          toast({ type: "info", message: "No active strategies to pause." });
          return;
        }
        // Cap concurrency at 4 — toggle hits the same backend rate
        // bucket as the order endpoints; an unbounded fan-out across
        // 50 strategies could trip rate-limits / DB lock contention.
        const CONCURRENCY = 4;
        let cursor = 0;
        async function worker() {
          while (cursor < names.length) {
            const i = cursor++;
            try {
              await toggleStrategy(names[i]);
            } catch {
              /* per-strategy failure surfaces in the strategies page */
            }
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker),
        );
        toast({ type: "success", message: `Paused ${names.length} strategies.` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Pause-all failed";
        toast({ type: "error", message: msg });
      } finally {
        pauseAllInflight = false;
      }
    }
    window.addEventListener("alphadesk:flatten-symbol", onFlatten as EventListener);
    window.addEventListener("alphadesk:pause-all-strategies", onPauseAll as EventListener);
    return () => {
      window.removeEventListener("alphadesk:flatten-symbol", onFlatten as EventListener);
      window.removeEventListener("alphadesk:pause-all-strategies", onPauseAll as EventListener);
    };
  }, [toast, refreshPortfolio]);

  // Slice-4 / CH-3B: route the chart's "+ alert" affordance to /alerts.
  // The CustomEvent carries { symbol, price, source } so the alerts page
  // can pre-fill its form and the user lands in a one-keystroke confirm.
  useEffect(() => {
    function onAddAlert(e: Event) {
      const detail = (e as CustomEvent<{
        symbol?: string;
        price?: number;
      }>).detail;
      const sym = detail?.symbol ?? "";
      const price = detail?.price;
      if (!sym || !Number.isFinite(price as number)) return;
      const url = `/alerts?prefillSymbol=${encodeURIComponent(sym)}&prefillPrice=${(price as number).toFixed(2)}`;
      router.push(url);
    }
    window.addEventListener("alphadesk:add-price-alert", onAddAlert as EventListener);
    return () => {
      window.removeEventListener("alphadesk:add-price-alert", onAddAlert as EventListener);
    };
  }, [router]);

  // Slice-5 / CH-3A: route the chart's Shift-click "place limit"
  // affordance to /trade. NinjaTrader pattern — chart click maps to
  // an order ticket pre-filled with side + limit price. The /trade
  // page already accepts ?contract=&side=&qty=&limit= deep-link
  // params (Round-5 F-2/F-3); we use those.
  useEffect(() => {
    function onPlaceLimit(e: Event) {
      const detail = (e as CustomEvent<{
        symbol?: string;
        price?: number;
        side?: "buy" | "sell";
      }>).detail;
      const sym = detail?.symbol ?? "";
      const price = detail?.price;
      const side = detail?.side ?? "buy";
      if (!sym || !Number.isFinite(price as number)) return;
      const url = `/trade?symbol=${encodeURIComponent(sym)}&side=${side}&qty=1&type=limit&limit=${(price as number).toFixed(2)}`;
      router.push(url);
    }
    window.addEventListener("alphadesk:place-limit-from-chart", onPlaceLimit as EventListener);
    return () => {
      window.removeEventListener("alphadesk:place-limit-from-chart", onPlaceLimit as EventListener);
    };
  }, [router]);

  return (
    <DashboardLayout
      topBar={
        <div
          onClickCapture={(e) => {
            if (
              e.defaultPrevented ||
              e.button !== 0 ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey
            ) {
              return;
            }
            const a = (e.target as HTMLElement).closest("a[href]");
            const target = a?.getAttribute("target");
            if (target && target !== "_self") return;
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
        <DashboardCommandCenter
          summary={portfolioSummary}
          positions={positions as Position[]}
          orders={ordersFromStore as Order[]}
          greeks={greeks}
          openOrders={orderCount}
          marketOpen={marketOpen}
          regimeLabel={regime.label ?? regime.regime}
          regimeTone={regime.regime}
          selectedSymbol={selectedSymbol}
          selectedQuote={quote}
          selectedStrategyName={selectedStrategy?.name ?? "No strategy selected"}
          activeStrategyCount={activeStrategyCount}
          totalStrategyCount={rail.length}
          strategies={strategiesResp ?? []}
          strategiesLoading={strategiesQuery.isLoading}
          strategiesError={strategiesQuery.isError}
          pipelineStatus={pipelineStatus}
          indices={indicesResp?.indices ?? []}
          clockEt={clock}
          onTrade={() => router.push(`/trade?symbol=${encodeURIComponent(selectedSymbol)}`)}
          onPipeline={() => router.push("/pipeline")}
          onStrategies={() => router.push("/strategies")}
          onStrategyClick={handleSelectStrategy}
          onOpenOrders={handleOpenOrders}
        />
      }
      right={
        <DashboardInsightRail
          positions={positionRows}
          orders={orderRows}
          activeTab={bookTab}
          onTabChange={setBookTab}
          onCancelOrder={handleCancelOrder}
          bookPanelRef={bookPanelRef}
          onSelectSymbol={(id) => {
            const pos = positionRows.find((r) => r.id === id);
            handleSelectSymbol(pos?.symbol ?? id);
          }}
        />
      }
      statusBar={
        <LastTickStatusBar
          base={statusPillsBase}
          buildVersion={BUILD_VERSION}
          marketOpen={marketOpen}
          pipelineTotal={rail.length}
        />
      }
    />
  );
}

type IndexSnapshot = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  prev_close?: number;
  is_demo?: boolean;
};

function DashboardCommandCenter({
  summary,
  positions,
  orders,
  greeks,
  openOrders,
  marketOpen,
  regimeLabel,
  regimeTone,
  selectedSymbol,
  selectedQuote,
  selectedStrategyName,
  activeStrategyCount,
  totalStrategyCount,
  strategies,
  strategiesLoading,
  strategiesError,
  pipelineStatus,
  indices,
  clockEt,
  onTrade,
  onPipeline,
  onStrategies,
  onStrategyClick,
  onOpenOrders,
}: {
  summary: PortfolioSummary;
  positions: Position[];
  orders: Order[];
  greeks: PortfolioGreeks;
  openOrders: number;
  marketOpen: boolean;
  regimeLabel: string;
  regimeTone: ReturnType<typeof toRegime>["regime"];
  selectedSymbol: string;
  selectedQuote: ReturnType<typeof toQuote>;
  selectedStrategyName: string;
  activeStrategyCount: number;
  totalStrategyCount: number;
  strategies: RawStrategy[];
  strategiesLoading: boolean;
  strategiesError: boolean;
  pipelineStatus?: PipelineStatus;
  indices: IndexSnapshot[];
  clockEt: string;
  onTrade: () => void;
  onPipeline: () => void;
  onStrategies: () => void;
  onStrategyClick: (id: string) => void;
  onOpenOrders: () => void;
}) {
  const account = useMemo(() => buildAccountSnapshot(summary, positions), [summary, positions]);
  const strategyCards = useMemo(
    () => buildStrategyCards(strategies).slice(0, 4),
    [strategies],
  );
  const marketRows = useMemo(
    () => normalizeIndices(indices).slice(0, 5),
    [indices],
  );
  const actionItems = useMemo(
    () =>
      buildActionItems({
        marketOpen,
        openOrders,
        positions,
        orders,
        activeStrategyCount,
        totalStrategyCount,
        pipelineStatus,
      }),
    [marketOpen, openOrders, positions, orders, activeStrategyCount, totalStrategyCount, pipelineStatus],
  );
  const quoteTone =
    selectedQuote.change > 0
      ? "text-profit"
      : selectedQuote.change < 0
        ? "text-loss"
        : "text-fg-muted";
  const regimeChipTone =
    regimeTone === "bear" || regimeTone === "crisis"
      ? "loss"
      : regimeTone === "bull"
        ? "profit"
        : "amber";
  const dayTone =
    account.dayPnl > 0
      ? "text-profit"
      : account.dayPnl < 0
        ? "text-loss"
        : "text-fg";
  const quoteValue =
    selectedQuote.last > 0
      ? `${formatCurrency(selectedQuote.last)} · ${selectedQuote.changePct >= 0 ? "+" : ""}${selectedQuote.changePct.toFixed(2)}%`
      : "Waiting for quote";
  const pipelineValue = pipelineStatus?.stage ?? pipelineStatus?.last_result ?? "Ready";

  return (
    <div
      data-slot="dashboard-command-center"
      className="min-h-0 flex-1 overflow-y-auto bg-bg"
    >
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-3 p-4 pb-8 xl:p-5">
        <section
          aria-labelledby="dashboard-command-title"
          className="dashboard-hero dashboard-section overflow-hidden"
        >
          <header className="flex flex-col gap-3 border-b border-border-hair px-5 py-4 md:flex-row md:items-end md:justify-between md:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-label text-fg-hint">Dashboard</span>
                <StatusChip
                  tone={marketOpen ? "profit" : "muted"}
                  label={marketOpen ? "Market open" : "Market closed"}
                />
                <StatusChip tone={regimeChipTone} label={regimeLabel} />
              </div>
              <h2
                id="dashboard-command-title"
                className="mt-2 text-[22px] font-semibold leading-tight text-ink-1000 md:text-[26px]"
                style={{ letterSpacing: 0 }}
              >
                Operating picture
              </h2>
              <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">
                Review attention, risk, and strategy gates before opening the trade ticket.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
              <span className="rounded-sm border border-border-hair bg-bg-elev-2 px-2.5 py-1 font-mono">
                {clockEt}
              </span>
              <span className="rounded-sm border border-border-hair bg-bg-elev-2 px-2.5 py-1 font-mono">
                {summary.source ? `Source ${summary.source}` : account.ready ? "Broker snapshot" : "Waiting for broker"}
              </span>
            </div>
          </header>

          <div className="grid gap-px bg-border-hair lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 bg-bg-elev-1 p-4 md:p-5">
              <div className="grid gap-px overflow-hidden rounded-md border border-border-hair bg-border-hair sm:grid-cols-2 xl:grid-cols-4">
                <SummaryMetric
                  label="Book equity"
                  value={
                    account.ready ? (
                      <AnimatedNumber
                        value={account.equity}
                        format={formatCurrency}
                        className="t-num-xl text-gold-300"
                      />
                    ) : (
                      <span className="t-num-xl text-fg-muted">—</span>
                    )
                  }
                  detail={account.ready ? "Current account value" : "Awaiting broker"}
                  icon={WalletCards}
                />
                <SummaryMetric
                  label="Day P&L"
                  value={
                    account.ready ? (
                      <AnimatedNumber
                        value={account.dayPnl}
                        format={(v) => `${v >= 0 ? "+" : "-"}${formatCurrency(Math.abs(v))}`}
                        className={cn("t-num-xl", dayTone)}
                      />
                    ) : (
                      <span className="t-num-xl text-fg-muted">—</span>
                    )
                  }
                  detail={account.ready ? `${formatCurrency(summary.realizedPnlToday)} realized · ${formatCurrency(summary.unrealizedPnl)} unrealized` : "Awaiting broker"}
                  icon={ActivityIcon}
                />
                <SummaryMetric
                  label="Buying power"
                  value={<span className={cn("t-num-xl", account.ready ? "text-ink-1000" : "text-fg-muted")}>{account.ready ? formatCurrency(summary.buyingPower) : "—"}</span>}
                  detail={account.ready ? `${formatPercent(account.cashPct)} cash buffer` : "Awaiting broker"}
                  icon={BriefcaseBusiness}
                />
                <SummaryMetric
                  label="Open risk"
                  value={<span className={cn("t-num-xl", account.ready ? "text-ink-1000" : "text-fg-muted")}>{account.ready ? formatPercent(account.grossExposurePct) : "—"}</span>}
                  detail={account.ready ? `${positions.length} positions · ${openOrders} working` : "Awaiting broker"}
                  icon={ShieldCheck}
                />
              </div>
            </div>

            <div className="min-w-0 bg-bg-elev-1 p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="t-label text-fg-hint">Session</span>
                <span className={cn("rounded-sm px-2 py-1 font-mono text-[11px]", pipelineStatus?.running ? "bg-profit/10 text-profit" : "bg-bg-elev-2 text-fg-muted")}>
                  {pipelineStatus?.running ? "Pipeline running" : "Pipeline idle"}
                </span>
              </div>
              <div className="mt-3 divide-y divide-border-hair rounded-md border border-border-hair">
                <SessionRow
                  label="Selected ticker"
                  title={selectedSymbol}
                  value={quoteValue}
                  toneClass={quoteTone}
                />
                <SessionRow
                  label="Strategy focus"
                  title={selectedStrategyName}
                  value={`${activeStrategyCount}/${totalStrategyCount || 0} active`}
                  toneClass="text-brand"
                />
                <SessionRow
                  label="Pipeline"
                  title={pipelineStatus?.running ? "Running" : "Idle"}
                  value={pipelineValue}
                  toneClass={pipelineStatus?.running ? "text-profit" : "text-fg-muted"}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 2xl:grid-cols-[0.95fr_1.05fr]">
          <ActionPanel
            items={actionItems}
            onTrade={onTrade}
            onOpenOrders={onOpenOrders}
            onPipeline={onPipeline}
          />
          <RiskPanel account={account} greeks={greeks} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <StrategyPanel
            strategies={strategyCards}
            activeStrategyCount={activeStrategyCount}
            totalStrategyCount={totalStrategyCount}
            loading={strategiesLoading}
            error={strategiesError}
            onStrategyClick={onStrategyClick}
            onStrategies={onStrategies}
          />
          <MarketPulsePanel
            indices={marketRows}
            marketOpen={marketOpen}
            regimeLabel={regimeLabel}
          />
        </section>
      </div>
    </div>
  );
}

function DashboardInsightRail({
  positions,
  orders,
  activeTab,
  onTabChange,
  onCancelOrder,
  bookPanelRef,
  onSelectSymbol,
}: {
  positions: ReturnType<typeof toPositionRows>;
  orders: OrderRow[];
  activeTab: PositionTab;
  onTabChange: (tab: PositionTab) => void;
  onCancelOrder: (id: string) => void;
  bookPanelRef: RefObject<HTMLDivElement | null>;
  onSelectSymbol: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden bg-bg">
      <div
        data-slot="dashboard-rail-scroll"
        className="min-h-0 flex-1 space-y-3 overflow-auto p-3"
      >
        <div
          ref={bookPanelRef}
          data-slot="dashboard-book"
          tabIndex={-1}
          className="overflow-hidden rounded-md border border-border-hair bg-bg-elev-1/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/70"
        >
          <PositionsList
            positions={positions}
            orders={orders}
            onCancelOrder={onCancelOrder}
            activeTab={activeTab}
            onTabChange={onTabChange}
            onRowClick={onSelectSymbol}
            showJournal={false}
          />
        </div>
        <Watchlist />
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ElementType;
}) {
  return (
    <div className="min-w-0 bg-bg-elev-1 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-fg-hint">{label}</span>
        <Icon className="size-3.5 text-fg-muted" aria-hidden />
      </div>
      <div className="mt-2 min-w-0 truncate">{value}</div>
      <p className="mt-1.5 truncate text-[13px] text-fg-muted">{detail}</p>
    </div>
  );
}

function ActionPanel({
  items,
  onTrade,
  onOpenOrders,
  onPipeline,
}: {
  items: readonly ActionItem[];
  onTrade: () => void;
  onOpenOrders: () => void;
  onPipeline: () => void;
}) {
  return (
    <section aria-labelledby="next-actions-title" className="dashboard-section">
      <PanelHeader
        id="next-actions-title"
        icon={ListChecks}
        title="Needs attention"
        detail="Highest priority first"
      />
      <div className="grid gap-2 p-3 md:grid-cols-3 2xl:grid-cols-1">
        {items.map((item, index) => {
          const onClick =
            item.action === "orders" ? onOpenOrders : item.action === "pipeline" ? onPipeline : onTrade;
          return (
            <button
              key={item.title}
              type="button"
              onClick={onClick}
              className="dashboard-row card-stagger group text-left"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <div className="flex items-start gap-3">
                <span className={cn("mt-1 size-2 rounded-full", item.tone === "profit" ? "bg-profit" : item.tone === "loss" ? "bg-loss" : item.tone === "amber" ? "bg-amber" : "bg-fg-muted")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[14px] font-medium text-ink-1000">{item.title}</p>
                    <ArrowRight className="size-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-fg-muted">{item.detail}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RiskPanel({ account, greeks }: { account: AccountSnapshot; greeks: PortfolioGreeks }) {
  const hasGreekExposure =
    Math.abs(greeks.betaWeightedDelta) > 0 ||
    Math.abs(greeks.netTheta) > 0 ||
    Math.abs(greeks.netVega) > 0;
  const betaDetail = greeks.isDemo
    ? "Greeks unavailable from broker"
    : hasGreekExposure
      ? "SPY-adjusted delta exposure"
      : "No option/equity delta exposure";

  return (
    <section aria-labelledby="risk-posture-title" className="dashboard-section">
      <PanelHeader
        id="risk-posture-title"
        icon={ShieldCheck}
        title="Risk posture"
        detail="Exposure, concentration, Greeks"
      />
      <div className="grid gap-3 p-3 md:grid-cols-3">
        {account.ready ? (
          <>
            <RiskMeter label="Gross exposure" value={account.grossExposurePct} detail={`${formatCurrency(account.grossMarketValue)} at work`} />
            <RiskMeter label="Cash buffer" value={account.cashPct} detail={formatCurrency(account.cash)} />
            <RiskStat label="Largest position" value={account.largestPosition?.symbol ?? "—"} detail={account.largestPosition ? `${formatPercent(account.largestPosition.pct)} of equity` : "No open positions"} />
            <RiskStat
              label="Beta-weighted Δ"
              value={greeks.isDemo ? "—" : formatGreek(greeks.betaWeightedDelta, 2)}
              detail={betaDetail}
              tone={greeks.isDemo ? "muted" : Math.abs(greeks.betaWeightedDelta) > account.equity * 0.5 ? "loss" : "default"}
            />
            <RiskStat
              label="Net θ / ν"
              value={greeks.isDemo ? "—" : `${formatGreek(greeks.netTheta, 2)} / ${formatGreek(greeks.netVega, 2)}`}
              detail={greeks.isDemo ? "Options risk feed unavailable" : "Daily decay / vol sensitivity"}
              tone={greeks.isDemo ? "muted" : "default"}
            />
            <RiskStat label="2% shock estimate" value={formatCurrency(account.twoPctShock)} detail="Gross exposure stress loss" tone={account.twoPctShock > 0 ? "loss" : "muted"} />
          </>
        ) : (
          <>
            <RiskStat label="Gross exposure" value="—" detail="Waiting for broker snapshot" tone="muted" />
            <RiskStat label="Cash buffer" value="—" detail="Waiting for broker snapshot" tone="muted" />
            <RiskStat label="Largest position" value="—" detail="Waiting for positions" tone="muted" />
            <RiskStat label="Beta-weighted Δ" value="—" detail="Waiting for Greeks" tone="muted" />
            <RiskStat label="Net θ / ν" value="—" detail="Waiting for options risk feed" tone="muted" />
            <RiskStat label="2% shock estimate" value="—" detail="Waiting for exposure" tone="muted" />
          </>
        )}
      </div>
    </section>
  );
}

export function StrategyPanel({
  strategies,
  activeStrategyCount,
  totalStrategyCount,
  loading = false,
  error = false,
  onStrategyClick,
  onStrategies,
}: {
  strategies: StrategyCardData[];
  activeStrategyCount: number;
  totalStrategyCount: number;
  loading?: boolean;
  error?: boolean;
  onStrategyClick: (id: string) => void;
  onStrategies: () => void;
}) {
  const emptyCopy = error
    ? "Strategy data unavailable. Open Strategies for the full status page."
    : loading
    ? "Strategy data is loading."
    : "No strategies configured yet.";

  return (
    <section aria-labelledby="strategy-ops-title" className="dashboard-section">
      <PanelHeader
        id="strategy-ops-title"
        icon={Target}
        title="Strategy exceptions"
        detail={`${activeStrategyCount}/${totalStrategyCount || 0} active`}
        actionLabel="Strategies"
        onAction={onStrategies}
      />
      <div className="grid gap-2 p-3 md:grid-cols-2">
        {strategies.length > 0 ? (
          strategies.map((strategy, index) => (
            <button
              key={strategy.id}
              type="button"
              onClick={() => onStrategyClick(strategy.id)}
              className="dashboard-row card-stagger group text-left"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink-1000">{strategy.name}</p>
                  <p className="mt-1 truncate text-[13px] text-fg-muted">
                    {strategy.positions} positions · {formatCurrency(strategy.invested, true)} invested
                  </p>
                </div>
                <span className={cn("font-mono text-[13px]", strategy.returnPct > 0 ? "text-profit" : strategy.returnPct < 0 ? "text-loss" : "text-fg-muted")}>
                  {strategy.returnPct === 0 ? "—" : formatPercent(strategy.returnPct)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusChip tone={strategy.readinessTone} label={strategy.readinessLabel} />
                <span className="min-w-0 truncate text-[12px] text-fg-muted">{strategy.readinessDetail}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="col-span-full px-3 py-8 text-center text-[13px] text-fg-muted">
            {emptyCopy}
          </div>
        )}
      </div>
    </section>
  );
}

function MarketPulsePanel({
  indices,
  marketOpen,
  regimeLabel,
}: {
  indices: MarketIndexRow[];
  marketOpen: boolean;
  regimeLabel: string;
}) {
  return (
    <section aria-labelledby="market-pulse-title" className="dashboard-section">
      <PanelHeader
        id="market-pulse-title"
        icon={Radio}
        title="Market context"
        detail={marketOpen ? "Live session" : "Closed session"}
      />
      <div className="grid gap-px bg-border-hair md:grid-cols-[0.8fr_1.2fr]">
        <div className="bg-bg-elev-1 p-4">
          <span className="t-label text-fg-hint">Regime</span>
          <p className="mt-2 text-[22px] font-medium text-ink-1000">{regimeLabel}</p>
          <p className="mt-2 text-[13px] leading-snug text-fg-muted">
            Use the strategy pages for thesis depth; this surface keeps the day&apos;s operating state visible.
          </p>
        </div>
        <div className="divide-y divide-border-hair bg-bg-elev-1">
          {indices.length > 0 ? (
            indices.map((idx) => (
              <div key={idx.symbol} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-[14px] font-medium text-ink-1000">{idx.symbol}</p>
                  <p className="truncate text-[12px] text-fg-muted">{idx.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[14px] text-ink-1000">{idx.price > 0 ? formatCurrency(idx.price) : "—"}</p>
                  <p className={cn("font-mono text-[12px]", idx.changePct >= 0 ? "text-profit" : "text-loss")}>
                    {idx.changePct >= 0 ? "+" : ""}{idx.changePct.toFixed(2)}%
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-fg-muted">Index data is loading.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function PanelHeader({
  id,
  icon: Icon,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  id: string;
  icon: ElementType;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border-hair px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <div className="min-w-0">
          <h3 id={id} className="truncate text-[14px] font-semibold text-ink-1000">{title}</h3>
          <p className="mt-0.5 truncate text-[12px] text-fg-muted">{detail}</p>
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
          <ArrowRight aria-hidden />
        </Button>
      ) : null}
    </header>
  );
}

function SessionRow({
  label,
  title,
  value,
  toneClass,
}: {
  label: string;
  title: string;
  value: string;
  toneClass: string;
}) {
  return (
    <div className="bg-bg-elev-1 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-fg-hint">{label}</span>
        <p className={cn("shrink-0 truncate font-mono text-[12px]", toneClass)}>{value}</p>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-medium text-ink-1000">{title}</p>
      </div>
    </div>
  );
}

function RiskMeter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="dashboard-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-fg-hint">{label}</span>
        <span className="font-mono text-[13px] text-ink-1000">{formatPercent(value)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-sm bg-bg-elev-2">
        <div className="h-full rounded-sm bg-brand transition-all duration-500" style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 truncate text-[13px] text-fg-muted">{detail}</p>
    </div>
  );
}

function RiskStat({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "loss" | "muted";
}) {
  return (
    <div className="dashboard-card p-4">
      <span className="t-label text-fg-hint">{label}</span>
      <p className={cn("mt-3 truncate font-mono text-[20px]", tone === "loss" ? "text-loss" : tone === "muted" ? "text-fg-muted" : "text-ink-1000")}>
        {value}
      </p>
      <p className="mt-2 truncate text-[13px] text-fg-muted">{detail}</p>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "profit" | "loss" | "amber" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px]",
        tone === "profit" && "border-profit/30 bg-profit/10 text-profit",
        tone === "loss" && "border-loss/30 bg-loss/10 text-loss",
        tone === "amber" && "border-amber/30 bg-amber/10 text-amber",
        tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone === "profit" ? "bg-profit" : tone === "loss" ? "bg-loss" : tone === "amber" ? "bg-amber" : "bg-fg-muted")} aria-hidden />
      {label}
    </span>
  );
}

const ActivityIcon = Clock3;

type AccountSnapshot = ReturnType<typeof buildAccountSnapshot>;
type StrategyCardData = ReturnType<typeof buildStrategyCards>[number];
type MarketIndexRow = ReturnType<typeof normalizeIndices>[number];
type ActionItem = ReturnType<typeof buildActionItems>[number];

function buildAccountSnapshot(summary: PortfolioSummary, positions: Position[]) {
  const equity = Number.isFinite(summary.equity) ? summary.equity : 0;
  const cash = Number.isFinite(summary.cash) ? summary.cash : 0;
  const ready = Boolean(
    summary.lastUpdated ||
      summary.source ||
      summary.is_demo !== undefined ||
      positions.length > 0 ||
      [summary.equity, summary.cash, summary.buyingPower, summary.totalMarketValue].some(
        (value) => Number.isFinite(value) && value !== 0,
      ),
  );
  const grossMarketValue = positions.reduce((sum, p) => sum + Math.abs(p.marketValue ?? 0), 0);
  const grossExposurePct = equity > 0 ? (grossMarketValue / equity) * 100 : 0;
  const cashPct = equity > 0 ? (cash / equity) * 100 : 0;
  const dayPnl =
    Number.isFinite(summary.dayPnl)
      ? summary.dayPnl
      : (summary.realizedPnlToday ?? 0) + (summary.unrealizedPnl ?? 0);
  const largestPosition = positions.reduce<null | { symbol: string; pct: number; value: number }>((best, p) => {
    const value = Math.abs(p.marketValue ?? 0);
    if (!best || value > best.value) {
      return {
        symbol: p.symbol,
        pct: equity > 0 ? (value / equity) * 100 : 0,
        value,
      };
    }
    return best;
  }, null);

  return {
    ready,
    equity,
    cash,
    dayPnl,
    grossMarketValue,
    grossExposurePct,
    cashPct,
    twoPctShock: grossMarketValue * 0.02,
    largestPosition,
  };
}

function buildStrategyCards(strategies: RawStrategy[]) {
  return [...strategies]
    .sort((a, b) => {
      const severityDelta = strategySeverity(b) - strategySeverity(a);
      if (severityDelta !== 0) return severityDelta;
      return Math.abs(b.invested_amount ?? 0) - Math.abs(a.invested_amount ?? 0);
    })
    .map((strategy) => {
      const returnPct = Number.isFinite(strategy.total_return_pct) ? strategy.total_return_pct : 0;
      const positions = Number.isFinite(strategy.active_positions_count) ? strategy.active_positions_count : 0;
      const winRate = Number.isFinite(strategy.win_rate) ? strategy.win_rate : -1;
      const status = (strategy.status ?? "").toLowerCase() === "active" ? "active" : "paused";
      const readiness = strategyReadiness({
        liveDisabled: strategy.live_disabled === true,
        paperOnly: strategy.paper_only === true,
        status,
        winRate,
        positions,
        sharpe: strategy.sharpe_ratio,
      });
      return {
        id: strategy.id,
        name: strategy.name || strategy.id,
        status,
        returnPct,
        positions,
        invested: Number.isFinite(strategy.invested_amount) ? strategy.invested_amount : 0,
        ...readiness,
      };
    });
}

function strategySeverity(strategy: RawStrategy) {
  const status = (strategy.status ?? "").toLowerCase();
  const winRate = Number.isFinite(strategy.win_rate) ? strategy.win_rate : 100;
  if (strategy.live_disabled === true) return 6;
  if (strategy.paper_only === true) return 5;
  if (status !== "active") return 4;
  if (winRate < 45) return 3;
  if ((strategy.active_positions_count ?? 0) > 0) return 2;
  return 1;
}

function strategyReadiness({
  liveDisabled,
  paperOnly,
  status,
  winRate,
  positions,
  sharpe,
}: {
  liveDisabled: boolean;
  paperOnly: boolean;
  status: "active" | "paused";
  winRate: number;
  positions: number;
  sharpe?: number | null;
}): { readinessLabel: string; readinessDetail: string; readinessTone: "profit" | "loss" | "amber" | "muted" } {
  if (liveDisabled) {
    return {
      readinessLabel: "Live blocked",
      readinessDetail: "Risk gate requires review before live capital.",
      readinessTone: "loss",
    };
  }
  if (paperOnly) {
    return {
      readinessLabel: "Paper only",
      readinessDetail: "Tracked, but not promoted to live execution.",
      readinessTone: "amber",
    };
  }
  if (status !== "active") {
    return {
      readinessLabel: "Paused",
      readinessDetail: "Disabled until the strategy is re-enabled.",
      readinessTone: "amber",
    };
  }
  if (winRate < 0) {
    return {
      readinessLabel: positions > 0 ? "Open only" : "No closed trades",
      readinessDetail: positions > 0 ? "Exposure exists; no closed-trade hit rate yet." : "Waiting for enough ledger history.",
      readinessTone: "muted",
    };
  }
  const sharpeText = typeof sharpe === "number" && Number.isFinite(sharpe) && sharpe !== 0 ? ` · Sharpe ${sharpe.toFixed(2)}` : "";
  return {
    readinessLabel: `${winRate.toFixed(0)}% win rate`,
    readinessDetail: `${positions} open position${positions === 1 ? "" : "s"}${sharpeText}`,
    readinessTone: winRate >= 55 ? "profit" : winRate >= 45 ? "amber" : "loss",
  };
}

function normalizeIndices(indices: IndexSnapshot[]) {
  return indices.map((idx) => ({
    symbol: idx.symbol,
    name: idx.name,
    price: Number.isFinite(idx.price) ? idx.price : 0,
    changePct: Number.isFinite(idx.change_pct) ? idx.change_pct : 0,
  }));
}

function buildActionItems({
  marketOpen,
  openOrders,
  positions,
  orders,
  activeStrategyCount,
  totalStrategyCount,
  pipelineStatus,
}: {
  marketOpen: boolean;
  openOrders: number;
  positions: Position[];
  orders: Order[];
  activeStrategyCount: number;
  totalStrategyCount: number;
  pipelineStatus?: PipelineStatus;
}) {
  const rejected = orders.filter((o) => o.status === "rejected").length;
  const activeRatio = totalStrategyCount > 0 ? activeStrategyCount / totalStrategyCount : 0;
  const largest = positions.reduce<Position | null>((best, pos) => {
    if (!best) return pos;
    return Math.abs(pos.marketValue ?? 0) > Math.abs(best.marketValue ?? 0) ? pos : best;
  }, null);
  const items: Array<{ title: string; detail: string; tone: "profit" | "loss" | "amber" | "muted"; action: "orders" | "trade" | "pipeline" }> = [];

  if (rejected > 0) {
    items.push({
      title: `${rejected} rejected order${rejected === 1 ? "" : "s"}`,
      detail: "Open the book and inspect broker or risk-gate reasons before submitting again.",
      tone: "loss",
      action: "orders",
    });
  }
  if (openOrders > 0) {
    items.push({
      title: `Review ${openOrders} working order${openOrders === 1 ? "" : "s"}`,
      detail: "Confirm stale limits, partial fills, and cancels before adding risk.",
      tone: "amber",
      action: "orders",
    });
  }
  if (largest && Math.abs(largest.marketValue ?? 0) > 0) {
    items.push({
      title: `${largest.symbol} is the largest exposure`,
      detail: `${formatCurrency(Math.abs(largest.marketValue ?? 0))} market value. Check concentration before new entries.`,
      tone: "muted",
      action: "trade",
    });
  }
  items.push({
    title: pipelineStatus?.running ? "Pipeline running" : activeRatio < 0.5 ? "Strategies mostly paused" : "Strategy pipeline ready",
    detail: pipelineStatus?.stage ?? pipelineStatus?.last_result ?? `${activeStrategyCount}/${totalStrategyCount || 0} strategies are enabled.`,
    tone: pipelineStatus?.running ? "profit" : activeRatio < 0.5 ? "amber" : "muted",
    action: "pipeline",
  });
  if (items.length < 3) {
    items.push({
      title: marketOpen ? "Trade from the dedicated ticket" : "Market is closed",
      detail: marketOpen ? "Open Trade for charting, staging, and broker confirmation." : "Use the dashboard for review; queue only when intentional.",
      tone: marketOpen ? "profit" : "muted",
      action: "trade",
    });
  }
  return items.slice(0, 3);
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
  pipelineTotal: fallbackPipelineTotal,
}: {
  base: ReturnType<typeof import("./_desk/selectors").toStatusPills>;
  buildVersion: string;
  marketOpen: boolean;
  pipelineTotal: number;
}) {
  // Round-15 / persona-10 P0: pipeline poller lives in the leaf, not
  // the parent — the 60s refetch only re-renders this small subtree
  // (was forcing the entire desk to re-render every minute).
  const { data: pipelineStatus } = usePipelineStatus();
  const pipelineRunningCount = pipelineStatus?.progress
    ? Object.values(pipelineStatus.progress).filter((v) => Number(v) < 100).length
    : pipelineStatus?.running
      ? 1
      : 0;
  const pipelineTotal = pipelineStatus?.progress
    ? Object.keys(pipelineStatus.progress).length
    : fallbackPipelineTotal;

  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    // Round-10 / V-1.12 (P2): pause the heartbeat when the tab is
    // hidden so we don't wake up the CPU 30 times/minute on background
    // tabs that the user has stashed for the day.
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id != null) return;
      setNowMs(Date.now());
      id = setInterval(() => setNowMs(Date.now()), 2_000);
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
    const ts = getFreshestQuoteTimestamp();
    if (!ts || nowMs <= 0) return undefined;
    const epochMs = ts > 1e12 ? ts : ts * 1000;
    const delta = (nowMs - epochMs) / 1000;
    return delta >= 0 && delta < 86_400 ? delta : undefined;
  }, [nowMs]);

  const pills = useMemo(() => {
    // Anchor pill rewrites by label prefix — index drift after insertion
    // order changes was a real regression in slice-3 / CH-1B.
    if (base.length === 0) return base;
    const next = base.slice();
    const tickIdx = next.findIndex(
      (p) =>
        p.label.startsWith("Last tick") ||
        p.label.startsWith("Feed idle"),
    );
    if (tickIdx !== -1) {
      next[tickIdx] = {
        ...next[tickIdx],
        label:
          lastTickSec != null
            ? `Last tick ${lastTickSec.toFixed(2)}s`
            : marketOpen
              ? "Last tick —"
              : "Feed idle · market closed",
      };
    }
    // Pipeline pill — overwrite with live count from the leaf-owned
    // useQuery. Match ``Pipeline N/M`` prefix so insertion order can
    // change without breaking us.
    const pipeIdx = next.findIndex((p) => p.label.startsWith("Pipeline"));
    if (pipeIdx !== -1) {
      next[pipeIdx] = {
        ...next[pipeIdx],
        label: `Pipeline ${pipelineRunningCount}/${pipelineTotal}`,
      };
    }
    return next;
  }, [base, lastTickSec, marketOpen, pipelineRunningCount, pipelineTotal]);

  return <StatusBar pills={pills} buildVersion={buildVersion} />;
}

/* ─── Tiny helpers kept inline ──────────────────────────── */

// isMarketOpen now lives in @/lib/marketHours and uses Intl America/New_York
// so it handles EST/EDT correctly year-round. See wave-8 audit finding.
