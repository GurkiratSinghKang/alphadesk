"use client";

/**
 * AlphaDesk root dashboard.
 *
 * This route is the graphless operating picture: account state, risk posture,
 * strategy health, and next actions. The full chart and order ticket live on
 * /trade so the dashboard can stay focused on decision support.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementType, RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ChartLineUp,
  ClockCounterClockwise,
  ClipboardText,
  FileText,
  Fingerprint,
  Gauge,
  ListChecks,
  Pulse,
  ShieldCheck,
  ShieldWarning,
  Siren,
  Sparkle,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";

import {
  ContextBar,
  PositionsList,
  StatusBar,
  TopBar,
  type OrderRow,
  type PositionTab,
} from "@/components/composites";
import { DashboardLayout } from "@/components/layouts";
import { Button } from "@/components/ui/button";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
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
import { StrategyPanel } from "./_desk/StrategyPanel";

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

  /* ─── Destructive action confirmation ──────────────────── */
  const destructive = useDestructiveAction();

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
  // BUG-11: Capital Canvas on the dashboard route is the book-equity hero.
  // Strip the emphasis Book equity cell from the persistent ContextBar so it
  // doesn't duplicate the Capital Canvas focal point. Other routes keep the
  // full bar (including the equity hero) since they don't have a Canvas.
  const contextCells = useMemo(() => {
    const all = toContextCells(portfolioSummary, positions as Position[], orderCount);
    // Dashboard (/) already has Capital Canvas as the equity hero — hide the
    // ContextBar Book equity cell to avoid a duplicate emphasis display.
    return all.filter((cell) => !cell.emphasis);
  }, [portfolioSummary, positions, orderCount]);
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
   * Execute a cancel after user confirms via the DestructiveConfirmModal.
   */
  const executeCancelOrder = useCallback(
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

  /**
   * Cancel a working order from the Orders tab.
   *
   * Shows a confirmation modal before firing the cancel request.
   */
  const handleCancelOrder = useCallback(
    (id: string) => {
      const o = ordersFromStore.find((ord) => ord.id === id);
      const rawAny = o as unknown as Record<string, unknown> | undefined;
      const limitPrice =
        o?.price ??
        (typeof rawAny?.limit_price === "number" ? (rawAny.limit_price as number) : undefined);
      const priceStr = limitPrice != null ? `$${limitPrice.toFixed(2)}` : "market";
      const qty = o?.quantity ?? "";
      const sym = o?.symbol ?? "";
      const side = o?.side ?? "";
      destructive.request({
        title: "Cancel order",
        description: `Working ${side} ${qty} ${sym} at ${priceStr}.`,
        consequences: [
          "Removes the order from the broker's working queue.",
          "Any partial fills already executed remain on the book.",
        ],
        confirmLabel: "Cancel order",
        onConfirm: () => executeCancelOrder(id),
      });
    },
    [ordersFromStore, executeCancelOrder]
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
    <>
    <DashboardLayout
      className="h-full min-h-0"
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
          selectedSymbol={selectedSymbol}
          selectedQuote={quote}
          onTrade={() => router.push(`/trade?symbol=${encodeURIComponent(selectedSymbol)}`)}
          onAlert={() => router.push(`/alerts?prefillSymbol=${encodeURIComponent(selectedSymbol)}`)}
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
    {destructive.pending && (
      <DestructiveConfirmModal
        open={true}
        onOpenChange={(open) => !open && destructive.dismiss()}
        loading={destructive.loading}
        title={destructive.pending.title}
        description={destructive.pending.description}
        consequences={destructive.pending.consequences}
        confirmLabel={destructive.pending.confirmLabel}
        onConfirm={destructive.fire}
      />
    )}
    </>
  );
}

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
  clockEt: string;
  onTrade: () => void;
  onPipeline: () => void;
  onStrategies: () => void;
  onStrategyClick: (id: string) => void;
  onOpenOrders: () => void;
}) {
  const account = useMemo(() => buildAccountSnapshot(summary, positions), [summary, positions]);
  const strategyCards = useMemo(
    () => buildStrategyCards(strategies).filter((strategy) => strategy.exception).slice(0, 4),
    [strategies],
  );
  const actionItems = useMemo(
    () =>
      buildActionItems({
        openOrders,
        positions,
        orders,
	        activeStrategyCount,
	        totalStrategyCount,
	        strategiesLoading,
	        pipelineStatus,
	      }),
	    [openOrders, positions, orders, activeStrategyCount, totalStrategyCount, strategiesLoading, pipelineStatus],
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
  const quoteValue =
    selectedQuote.last > 0
      ? `${formatCurrency(selectedQuote.last)} · ${selectedQuote.changePct >= 0 ? "+" : ""}${selectedQuote.changePct.toFixed(2)}%`
      : "Waiting for quote";
  const pipelineValue = pipelineStatus?.stage ?? pipelineStatus?.last_result ?? "Ready";
  const pnlTone =
    account.dayPnl > 0
      ? "text-profit"
      : account.dayPnl < 0
        ? "text-loss"
        : "text-fg-muted";
  const pnlSign = account.dayPnl > 0 ? "+" : "";
  const riskEscalations = useMemo(
    () => buildRiskEscalations({
      account,
      greeks,
      orders,
      openOrders,
      pipelineStatus,
    }),
    [account, greeks, orders, openOrders, pipelineStatus],
  );
  const dashboardReadiness = useMemo(
    () =>
      buildDashboardReadiness({
        account,
        selectedQuote,
        marketOpen,
        pipelineStatus,
        strategiesError,
      }),
    [account, selectedQuote, marketOpen, pipelineStatus, strategiesError],
  );
  const auditItems = useMemo(
    () =>
      buildAuditItems({
        summary,
        selectedSymbol,
        selectedQuote,
        marketOpen,
        pipelineStatus,
        clockEt,
      }),
    [summary, selectedSymbol, selectedQuote, marketOpen, pipelineStatus, clockEt],
  );
  const escalationCount = riskEscalations.filter((item) => item.tone !== "profit").length;
  const [clockTime, clockDate] = clockEt.split(" · ");

  return (
    <div
      data-slot="dashboard-command-center"
      className="relative min-h-0 flex-1 overflow-y-auto bg-bg"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(236,230,210,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(236,230,210,0.03)_1px,transparent_1px)] bg-[size:72px_72px]"
      />
      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-4 pb-8 md:p-6">
        <section
          aria-labelledby="dashboard-command-title"
          className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_60px_-36px_rgba(16,22,17,0.34)]"
        >
          <MobilePriorityBrief
            items={actionItems}
            risk={riskEscalations[0]}
            marketOpen={marketOpen}
            regimeLabel={regimeLabel}
            escalationCount={escalationCount}
            grossExposure={account.ready ? formatPercent(account.grossExposurePct) : "Locked"}
            cashBuffer={account.ready ? formatPercent(account.cashPct) : "Locked"}
            openOrders={openOrders}
            readiness={dashboardReadiness}
            onTrade={onTrade}
            onOpenOrders={onOpenOrders}
            onPipeline={onPipeline}
          />
          <header className="hidden gap-px bg-border-hair lg:grid lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.22fr)]">
            <div className="min-w-0">
              <div className="h-full bg-bg-elev-1 px-4 py-4 md:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-label text-fg-hint">AlphaDesk control room</span>
                  <StatusChip tone={dashboardReadiness.tone} label={dashboardReadiness.label} />
                  <StatusChip tone={regimeChipTone} label={regimeLabel} />
                </div>
                <h2
                  id="dashboard-command-title"
                  className="mt-3 text-h1 font-semibold leading-[1.04] tracking-tight text-ink-1000 md:text-display-sm"
                  style={{ letterSpacing: 0 }}
                >
                  Control room
                </h2>
                <p className="mt-2 max-w-[44ch] text-body-sm leading-relaxed text-fg-muted">
                  Exceptions, exposure, and broker state in the first scan.
                </p>
                <div className="mt-4 rounded-md border border-border-hair bg-bg px-3 py-3">
                  <p className="t-label text-fg-hint">System readiness</p>
                  <p className="mt-1 text-body-sm font-semibold leading-snug text-ink-1000">
                    {dashboardReadiness.title}
                  </p>
                  <p className="mt-1 text-body-sm leading-relaxed text-fg-muted">
                    {dashboardReadiness.detail}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusChip
                    tone={escalationCount > 0 ? "amber" : "profit"}
                    label={`${escalationCount} risk gate${escalationCount === 1 ? "" : "s"}`}
                  />
                  <StatusChip
                    tone={pipelineStatus?.running ? "profit" : "muted"}
                    label={pipelineStatus?.running ? "Pipeline live" : "Pipeline idle"}
                  />
                </div>
              </div>
            </div>

            {/* BUG-11: Book equity removed — Capital Canvas below is the equity hero.
                Keeping Day P/L, Clock, and Strategies for the Command Room scan. */}
            <div className="hidden gap-px bg-border-hair sm:grid sm:grid-cols-3">
              <CommandMetric
                label="Day P/L"
                value={account.ready ? `${pnlSign}${formatCurrency(account.dayPnl, true)}` : "Awaiting"}
                detail={`${account.positionsCount} open line${account.positionsCount === 1 ? "" : "s"}`}
                valueClassName={pnlTone}
              />
              <CommandMetric
                label="Clock"
                value={clockTime ?? clockEt}
                detail={[clockDate, marketOpen ? "US cash session" : "Off-session"].filter(Boolean).join(" · ")}
              />
              <CommandMetric
                label="Strategies"
                value={`${activeStrategyCount}/${totalStrategyCount || 0}`}
                detail="Enabled systems"
                valueClassName="text-brand"
              />
            </div>
          </header>

          <div className="hidden gap-px bg-border-hair lg:grid xl:grid-cols-[minmax(320px,0.82fr)_minmax(320px,0.72fr)_minmax(0,1.05fr)]">
            <DecisionQueue
              items={actionItems}
              onTrade={onTrade}
              onOpenOrders={onOpenOrders}
              onPipeline={onPipeline}
            />
            <RiskEscalationPanel
              items={riskEscalations}
              account={account}
            />
            <PortfolioCanvas
              account={account}
              greeks={greeks}
              selectedSymbol={selectedSymbol}
              quoteValue={quoteValue}
              quoteTone={quoteTone}
              onTrade={onTrade}
            />
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <RiskPanel account={account} greeks={greeks} />
          <section className="grid gap-5 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] xl:grid-cols-1">
            <AuditTrailPanel items={auditItems} />
            <SessionSnapshot
              selectedSymbol={selectedSymbol}
              quoteValue={quoteValue}
              quoteTone={quoteTone}
              selectedStrategyName={selectedStrategyName}
              activeStrategyCount={activeStrategyCount}
              totalStrategyCount={totalStrategyCount}
              pipelineStatus={pipelineStatus}
              pipelineValue={pipelineValue}
              onPipeline={onPipeline}
            />
            <StrategyPanel
              strategies={strategyCards}
              activeStrategyCount={activeStrategyCount}
              totalStrategyCount={totalStrategyCount}
              loading={strategiesLoading}
              error={strategiesError}
              onStrategyClick={onStrategyClick}
              onStrategies={onStrategies}
            />
          </section>
        </section>
      </div>
    </div>
  );
}

function MobilePriorityBrief({
  items,
  risk,
  marketOpen,
  regimeLabel,
  escalationCount,
  grossExposure,
  cashBuffer,
  openOrders,
  readiness,
  onTrade,
  onOpenOrders,
  onPipeline,
}: {
  items: readonly ActionItem[];
  risk?: RiskEscalation;
  marketOpen: boolean;
  regimeLabel: string;
  escalationCount: number;
  grossExposure: string;
  cashBuffer: string;
  openOrders: number;
  readiness: DashboardReadiness;
  onTrade: () => void;
  onOpenOrders: () => void;
  onPipeline: () => void;
}) {
  const primary = items[0];
  const actionTone = primary?.tone ?? "profit";
  const actionTitle = primary?.title ?? "No interventions pending";
  const actionDetail =
    primary?.detail ??
    "Exposure, orders, and strategy state are inside policy bands. Open Trade when you want to act.";
  const actionLabel =
    primary?.action === "orders"
      ? "Review orders"
      : primary?.action === "pipeline"
        ? "Open pipeline"
        : "Open trade";
  const actionHandler =
    primary?.action === "orders"
      ? onOpenOrders
      : primary?.action === "pipeline"
        ? onPipeline
        : onTrade;
  const ActionIcon =
    actionTone === "loss"
      ? WarningCircle
      : primary?.action === "pipeline"
        ? Pulse
        : ListChecks;
  const riskTone = risk?.tone ?? "profit";

  return (
    <div
      data-slot="dashboard-mobile-action-first"
      className="border-b border-border-hair bg-bg-elev-1 lg:hidden"
    >
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-label text-fg-hint">Control room</span>
          <StatusChip tone={readiness.tone} label={readiness.label} />
          <StatusChip tone={escalationCount > 0 ? "amber" : "profit"} label={`${escalationCount} gate${escalationCount === 1 ? "" : "s"}`} />
        </div>
        <div className="mt-3 rounded-md border border-border-hair bg-bg px-3 py-3">
          <p className="text-body-sm font-semibold leading-snug text-ink-1000">
            {readiness.title}
          </p>
          <p className="mt-1 line-clamp-2 text-body-sm leading-snug text-fg-muted">
            {readiness.detail}
          </p>
        </div>

        <button
          type="button"
          onClick={actionHandler}
          data-slot="dashboard-mobile-primary-action"
          className="mt-3 grid min-h-[116px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-brand/30 bg-brand/10 px-3.5 py-3.5 text-left transition-[border-color,background-color,transform] active:scale-[0.99]"
        >
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-sm border",
              actionTone === "profit" && "border-profit/25 bg-profit/10 text-profit",
              actionTone === "loss" && "border-loss/25 bg-loss/10 text-loss",
              actionTone === "amber" && "border-amber/25 bg-amber/10 text-amber",
              actionTone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
            )}
          >
            <ActionIcon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-body font-semibold leading-tight text-ink-1000">
              {actionTitle}
            </span>
            <span className="mt-2 block line-clamp-2 text-body-sm leading-snug text-fg-muted">
              {actionDetail}
            </span>
            <span className="mt-3 inline-flex min-h-8 items-center rounded-sm bg-brand px-3 text-label font-semibold text-primary-foreground">
              {actionLabel}
            </span>
          </span>
          <ArrowRight className="mt-1 size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>

        <div
          data-slot="dashboard-mobile-priority-rail"
          className="mt-3 grid grid-cols-2 gap-2"
        >
          <MobilePriorityDatum
            label="Risk gate"
            value={risk?.metric ?? "Clear"}
            detail={risk?.title ?? "Policy gates clear"}
            valueClassName={riskTone === "loss" ? "text-loss" : riskTone === "amber" ? "text-amber" : riskTone === "profit" ? "text-profit" : "text-fg-muted"}
          />
          <MobilePriorityDatum
            label="Gross exposure"
            value={grossExposure}
            detail="Market value at work"
          />
          <MobilePriorityDatum
            label="Cash buffer"
            value={cashBuffer}
            detail="Buying room"
          />
          <MobilePriorityDatum
            label="Session"
            value={openOrders > 0 ? `${openOrders} open` : marketOpen ? "Cash session" : "Review mode"}
            detail={openOrders > 0 ? "Orders need review" : regimeLabel === "unknown" ? "No open orders" : regimeLabel}
          />
        </div>
      </div>
    </div>
  );
}

function MobilePriorityDatum({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-hair bg-bg px-3 py-2.5">
      <p className="t-label text-fg-hint">{label}</p>
      <p className={cn("mt-1 truncate font-mono text-body leading-tight text-ink-1000", valueClassName)}>
        {value}
      </p>
      {detail ? <p className="mt-1 truncate text-label text-fg-muted">{detail}</p> : null}
    </div>
  );
}

function CommandMetric({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-hair bg-bg px-4 py-3 shadow-[0_14px_34px_-28px_rgba(16,22,17,0.36)]">
      <p className="t-label text-fg-hint">{label}</p>
      <p className={cn("mt-2 font-mono text-[clamp(14px,1.2vw,18px)] leading-tight text-ink-1000", valueClassName)}>
        {value}
      </p>
      <p className="mt-2 text-body-sm leading-snug text-fg-muted">{detail}</p>
    </div>
  );
}

function PortfolioCanvas({
  account,
  greeks,
  selectedSymbol,
  quoteValue,
  quoteTone,
  onTrade,
}: {
  account: AccountSnapshot;
  greeks: PortfolioGreeks;
  selectedSymbol: string;
  quoteValue: string;
  quoteTone: string;
  onTrade: () => void;
}) {
  const exposurePct = account.ready ? Math.max(0, Math.min(140, account.grossExposurePct)) : 0;
  const cashPct = account.ready ? Math.max(0, Math.min(100, account.cashPct)) : 0;
  const shockTone = account.twoPctShock > account.equity * 0.015 ? "text-loss" : "text-fg-muted";

  return (
    <div className="surface-scan relative min-h-[360px] overflow-hidden bg-bg p-5 md:p-6">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--brand),transparent_42%,var(--profit)_64%,transparent)] opacity-70"
      />
      <div className="flex h-full min-w-0 flex-col justify-between gap-7">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkle className="size-4 text-brand" aria-hidden />
            <p className="t-label text-fg-hint">Capital canvas</p>
          </div>
          <p className="mt-4 break-words font-mono text-[clamp(34px,3.4vw,52px)] font-medium leading-[0.92] tracking-tight text-ink-1000">
            {account.ready ? formatCurrency(account.equity) : "Awaiting"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={cn("font-mono text-body", account.dayPnl > 0 ? "text-profit" : account.dayPnl < 0 ? "text-loss" : "text-fg-muted")}>
              {account.ready ? `${account.dayPnl > 0 ? "+" : ""}${formatCurrency(account.dayPnl)} today` : "Waiting for account state"}
            </span>
            <span className="h-1 w-1 rounded-full bg-border-strong" aria-hidden />
            <span className="font-mono text-body text-fg-muted">
              {account.positionsCount} position{account.positionsCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SmallDatum
            label="Largest line"
            value={account.largestPosition?.symbol ?? "None"}
            detail={account.largestPosition ? `${formatPercent(account.largestPosition.pct)} of equity` : "No dominant exposure"}
          />
          <SmallDatum
            label="Gross market value"
            value={account.ready ? formatCurrency(account.grossMarketValue, true) : "Locked"}
            detail="Absolute notional at work"
          />
          <SmallDatum
            label="Beta-weighted delta"
            value={greeks.isDemo ? "Review" : formatGreek(greeks.betaWeightedDelta, 2)}
            detail={greeks.isDemo ? "Broker Greeks unavailable" : "Portfolio sensitivity"}
          />
        </div>

        <div className="rounded-md border border-border-hair bg-bg-elev-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="t-label text-fg-hint">Exposure runway</p>
              <p className="mt-1 text-body-sm text-fg-muted">
                {selectedSymbol} handoff · <span className={cn("font-mono", quoteTone)}>{quoteValue}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onTrade}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-sm bg-brand px-3 text-body-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Open execution
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-sm bg-bg-elev-2">
            <div
              className={cn(
                "h-full rounded-sm transition-[width] duration-500",
                account.grossExposurePct > 85 ? "bg-loss" : account.grossExposurePct > 55 ? "bg-amber" : "bg-brand",
              )}
              style={{ width: `${Math.min(100, exposurePct)}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <SmallDatum label="Gross" value={account.ready ? formatPercent(account.grossExposurePct) : "Locked"} />
            <SmallDatum label="Cash buffer" value={account.ready ? formatPercent(cashPct) : "Locked"} />
            <SmallDatum label="2% shock" value={account.ready ? formatCurrency(account.twoPctShock, true) : "Locked"} valueClassName={shockTone} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallDatum({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-border-hair bg-bg px-3 py-3">
      <p className="t-label text-fg-hint">{label}</p>
      <p className={cn("mt-2 whitespace-nowrap font-mono text-[clamp(14px,1.08vw,17px)] leading-tight text-ink-1000", valueClassName)}>
        {value}
      </p>
      {detail ? <p className="mt-2 line-clamp-2 text-body-sm leading-snug text-fg-muted">{detail}</p> : null}
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
  selectedSymbol,
  selectedQuote,
  onTrade,
  onAlert,
  onSelectSymbol,
}: {
  positions: ReturnType<typeof toPositionRows>;
  orders: OrderRow[];
  activeTab: PositionTab;
  onTabChange: (tab: PositionTab) => void;
  onCancelOrder: (id: string) => void;
  bookPanelRef: RefObject<HTMLDivElement | null>;
  selectedSymbol: string;
  selectedQuote: ReturnType<typeof toQuote>;
  onTrade: () => void;
  onAlert: () => void;
  onSelectSymbol: (id: string) => void;
}) {
  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(236,230,210,0.045)_1px,transparent_1px)] bg-[size:100%_56px]"
      />
      <div
        data-slot="dashboard-rail-scroll"
        className="relative min-h-0 flex-1 space-y-4 overflow-auto p-4"
      >
        <FocusTickerPanel
          symbol={selectedSymbol}
          quote={selectedQuote}
          onTrade={onTrade}
          onAlert={onAlert}
        />
        <div
          ref={bookPanelRef}
          data-slot="dashboard-book"
          tabIndex={-1}
          className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_48px_-38px_rgba(16,22,17,0.42)] focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/70"
        >
          <div className="border-b border-border-hair px-4 py-3">
            <p className="t-label text-fg-hint">Live book</p>
            <p className="mt-1 text-body-sm text-fg-muted">
              Positions and order state stay here so the dashboard can stay decision-led.
            </p>
          </div>
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
      </div>
    </div>
  );
}

function FocusTickerPanel({
  symbol,
  quote,
  onTrade,
  onAlert,
}: {
  symbol: string;
  quote: ReturnType<typeof toQuote>;
  onTrade: () => void;
  onAlert: () => void;
}) {
  const hasQuote = quote.last > 0;
  const tone = quote.change > 0 ? "text-profit" : quote.change < 0 ? "text-loss" : "text-fg-muted";
  return (
    <section
      aria-label="Selected ticker controls"
      className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 text-fg shadow-[0_18px_48px_-34px_rgba(16,22,17,0.52)]"
    >
      <div className="relative px-5 py-5">
        <div
          aria-hidden
          className="absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)]"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="t-label text-fg-hint">Selected ticker</p>
          <span
            className={cn(
              "size-2.5 rounded-full",
              quote.change > 0 ? "bg-profit" : quote.change < 0 ? "bg-loss" : "bg-fg-muted",
            )}
            aria-hidden
          />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-numeric-hero font-medium leading-none tracking-tight text-fg">{symbol}</p>
            <p className={cn("mt-2 font-mono text-body", tone)}>
              {hasQuote
                ? `${formatCurrency(quote.last)} · ${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`
                : "Waiting for quote"}
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border-hair">
        <button
          type="button"
          onClick={onTrade}
          className="flex min-h-12 items-center justify-center gap-2 bg-bg px-3 py-3 text-body-sm font-semibold text-fg transition-transform hover:-translate-y-0.5 hover:bg-brand/10"
        >
          <ChartLineUp className="size-4" aria-hidden />
          Trade
        </button>
        <button
          type="button"
          onClick={onAlert}
          className="flex min-h-12 items-center justify-center gap-2 bg-bg px-3 py-3 text-body-sm font-semibold text-fg transition-transform hover:-translate-y-0.5 hover:bg-brand/10"
        >
          <ClipboardText className="size-4" aria-hidden />
          Alert
        </button>
      </div>
    </section>
  );
}

function DecisionQueue({
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
    <div className="min-w-0 bg-bg-elev-1 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <p className="t-label text-fg-hint">Action stack</p>
            <p className="mt-1 text-body-sm leading-snug text-fg-muted">
              One visible queue, one next screen, no scavenger hunt.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3">
        {items.length > 0 ? items.map((item, index) => {
          const onClick =
            item.action === "orders" ? onOpenOrders : item.action === "pipeline" ? onPipeline : onTrade;
          const Icon = item.tone === "loss" ? WarningCircle : item.action === "pipeline" ? Pulse : Stack;
          return (
            <button
              key={item.title}
              type="button"
              onClick={onClick}
              className="card-stagger group grid min-h-[104px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border-hair bg-bg px-4 py-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-brand/35 hover:bg-brand/5"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <span className={cn(
                "flex size-9 items-center justify-center rounded-sm border",
                item.tone === "profit" && "border-profit/20 bg-profit/10 text-profit",
                item.tone === "loss" && "border-loss/20 bg-loss/10 text-loss",
                item.tone === "amber" && "border-amber/20 bg-amber/10 text-amber",
                item.tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
              )}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-body font-semibold leading-tight text-ink-1000">{item.title}</p>
                <p className="mt-2 line-clamp-2 text-body-sm leading-snug text-fg-muted">{item.detail}</p>
              </div>
              <ArrowRight className="mt-1 size-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          );
        }) : (
          <div className="rounded-md border border-border-hair bg-bg px-4 py-6">
            <div className="flex size-10 items-center justify-center rounded-sm bg-profit/10 text-profit">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <p className="mt-4 text-body font-semibold text-ink-1000">No interventions pending</p>
            <p className="mt-2 max-w-xl text-body-sm leading-snug text-fg-muted">
              Orders, exposure, and pipeline state are inside normal bounds. Open Trade when you want to act.
            </p>
            <Button variant="ghost" size="sm" className="mt-4" onClick={onTrade}>
              Open trade
              <ArrowRight aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RiskEscalationPanel({
  items,
  account,
}: {
  items: readonly RiskEscalation[];
  account: AccountSnapshot;
}) {
  const hotCount = items.filter((item) => item.tone === "loss" || item.tone === "amber").length;

  return (
    <div className="min-w-0 bg-bg-elev-1 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-loss/10 text-loss">
            {hotCount > 0 ? <Siren className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="t-label text-fg-hint">Risk gates</p>
            <p className="mt-1 text-body-sm leading-snug text-fg-muted">
              Thresholds, ownership, and action before more exposure.
            </p>
          </div>
        </div>
        <span className={cn("rounded-sm px-2 py-1 font-mono text-label", hotCount > 0 ? "bg-amber/10 text-amber" : "bg-profit/10 text-profit")}>
          {hotCount > 0 ? `${hotCount} active` : "Clear"}
        </span>
      </div>

      <div className="mt-5 divide-y divide-border-hair border-y border-border-hair">
        {items.slice(0, 4).map((item, index) => {
          const Icon = item.tone === "loss" ? ShieldWarning : item.tone === "amber" ? WarningCircle : ShieldCheck;
          return (
            <div
              key={item.title}
              className="card-stagger grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-3"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <span className={cn(
                "mt-0.5 flex size-8 items-center justify-center rounded-sm border",
                item.tone === "loss" && "border-loss/25 bg-loss/10 text-loss",
                item.tone === "amber" && "border-amber/25 bg-amber/10 text-amber",
                item.tone === "profit" && "border-profit/25 bg-profit/10 text-profit",
                item.tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
              )}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body font-semibold leading-tight text-ink-1000">{item.title}</p>
                  <span className="shrink-0 font-mono text-label uppercase text-fg-hint">{item.owner}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-body-sm leading-snug text-fg-muted">{item.detail}</p>
                <p className="mt-2 font-mono text-label text-fg">{item.metric}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <SmallDatum label="BP" value={account.ready ? formatCurrency(account.buyingPower, true) : "Locked"} />
        <SmallDatum label="Cash" value={account.ready ? formatPercent(account.cashPct) : "Locked"} />
        <SmallDatum label="Shock" value={account.ready ? formatCurrency(account.twoPctShock, true) : "Locked"} />
      </div>
    </div>
  );
}

function AuditTrailPanel({ items }: { items: readonly AuditItem[] }) {
  const iconFor = (kind: AuditItem["kind"]) => {
    if (kind === "broker") return Fingerprint;
    if (kind === "market") return ClockCounterClockwise;
    if (kind === "pipeline") return Pulse;
    return FileText;
  };

  return (
    <section
      aria-labelledby="audit-trail-title"
      className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_48px_-38px_rgba(16,22,17,0.36)]"
    >
      <PanelHeader
        id="audit-trail-title"
        icon={Fingerprint}
        title="Provenance ledger"
        detail="Source, freshness, and operator handoff"
      />
      <div className="divide-y divide-border-hair">
        {items.map((item) => {
          const Icon = iconFor(item.kind);
          return (
            <div key={item.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 bg-bg-elev-1 px-4 py-3">
              <span className="mt-0.5 flex size-8 items-center justify-center rounded-sm border border-border-hair bg-bg text-brand">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-label text-fg-hint">{item.label}</span>
                  <span className={cn("shrink-0 font-mono text-label", item.toneClass)}>{item.status}</span>
                </div>
                <p className="mt-1 truncate text-body font-medium text-ink-1000">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-body-sm leading-snug text-fg-muted">{item.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SessionSnapshot({
  selectedSymbol,
  quoteValue,
  quoteTone,
  selectedStrategyName,
  activeStrategyCount,
  totalStrategyCount,
  pipelineStatus,
  pipelineValue,
  onPipeline,
}: {
  selectedSymbol: string;
  quoteValue: string;
  quoteTone: string;
  selectedStrategyName: string;
  activeStrategyCount: number;
  totalStrategyCount: number;
  pipelineStatus?: PipelineStatus;
  pipelineValue: string;
  onPipeline: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_48px_-38px_rgba(16,22,17,0.36)]">
      <header className="flex items-start justify-between gap-3 border-b border-border-hair px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Pulse className="size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <h3 className="truncate text-body font-semibold text-ink-1000">Session telemetry</h3>
            <p className="mt-0.5 text-label leading-snug text-fg-muted">Ticker, strategy, and pipeline context</p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-sm px-2 py-1 font-mono text-label", pipelineStatus?.running ? "bg-profit/10 text-profit" : "bg-bg-elev-2 text-fg-muted")}>
          {pipelineStatus?.running ? "Pipeline running" : "Pipeline idle"}
        </span>
      </header>
      <div className="divide-y divide-border-hair">
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
      <div className="border-t border-border-hair px-4 py-3">
        <button
          type="button"
          onClick={onPipeline}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm border border-border-hair bg-bg px-3 text-body-sm font-semibold text-fg transition-transform hover:-translate-y-0.5 hover:border-brand/40"
        >
          Open pipeline
          <ArrowRight className="size-4" aria-hidden />
        </button>
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
    <section
      aria-labelledby="risk-posture-title"
      className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_48px_-38px_rgba(16,22,17,0.36)]"
    >
      <PanelHeader
        id="risk-posture-title"
        icon={Gauge}
        title="Risk runway"
        detail="Sizing pressure, cash reserve, and shock estimate"
      />
      <div className="grid gap-px bg-border-hair md:grid-cols-2">
        {account.ready ? (
          <>
            <RiskMeter label="Gross exposure" value={account.grossExposurePct} detail={`${formatCurrency(account.grossMarketValue)} at work`} />
            <RiskMeter label="Cash buffer" value={account.cashPct} detail={formatCurrency(account.cash)} />
            <RiskStat label="Largest position" value={account.largestPosition?.symbol ?? "—"} detail={account.largestPosition ? `${formatPercent(account.largestPosition.pct)} of equity` : "No open positions"} />
            <RiskStat label="2% shock estimate" value={formatCurrency(account.twoPctShock)} detail="Gross exposure stress loss" tone={account.twoPctShock > 0 ? "loss" : "muted"} />
          </>
        ) : (
          <>
            <RiskStat label="Gross exposure" value="—" detail="Waiting for broker snapshot" tone="muted" />
            <RiskStat label="Cash buffer" value="—" detail="Waiting for broker snapshot" tone="muted" />
            <RiskStat label="Largest position" value="—" detail="Waiting for positions" tone="muted" />
            <RiskStat label="2% shock estimate" value="—" detail="Waiting for exposure" tone="muted" />
          </>
        )}
      </div>
      {(hasGreekExposure || greeks.isDemo) && (
        <div className="border-t border-border-hair bg-bg-elev-1 px-4 py-4">
          <div className="grid gap-3 md:grid-cols-2">
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
          </div>
        </div>
      )}
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
    <header className="flex items-start justify-between gap-3 border-b border-border-hair bg-bg-elev-1 px-4 py-3 sm:items-center">
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand/10 text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="truncate text-body font-semibold text-ink-1000">{title}</h3>
          <p className="mt-0.5 text-label leading-snug text-fg-muted">{detail}</p>
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
    <div className="bg-bg-elev-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-fg-hint">{label}</span>
        <p className={cn("shrink-0 truncate font-mono text-label", toneClass)}>{value}</p>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-body font-medium text-ink-1000">{title}</p>
      </div>
    </div>
  );
}

function RiskMeter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="bg-bg-elev-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-fg-hint">{label}</span>
        <span className="font-mono text-body-sm text-ink-1000">{formatPercent(value)}</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-sm bg-bg-elev-2">
        <div
          className={cn(
            "h-full rounded-sm transition-all duration-500",
            value > 85 ? "bg-loss" : value > 55 ? "bg-amber" : "bg-brand",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-2 truncate text-body-sm text-fg-muted">{detail}</p>
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
    <div className="bg-bg-elev-1 p-4">
      <span className="t-label text-fg-hint">{label}</span>
      <p className={cn("mt-3 truncate font-mono text-numeric-lg", tone === "loss" ? "text-loss" : tone === "muted" ? "text-fg-muted" : "text-ink-1000")}>
        {value}
      </p>
      <p className="mt-2 truncate text-body-sm text-fg-muted">{detail}</p>
    </div>
  );
}

type StatusTone = "profit" | "loss" | "amber" | "muted";

function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-label",
        tone === "profit" && "border-profit/30 bg-profit/10 text-profit",
        tone === "loss" && "border-loss/30 bg-loss/10 text-loss",
        tone === "amber" && "border-amber/30 bg-amber/10 text-amber",
        tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
      )}
    >
      <span className={cn("status-breathe size-1.5 rounded-full", tone === "profit" ? "bg-profit" : tone === "loss" ? "bg-loss" : tone === "amber" ? "bg-amber" : "bg-fg-muted")} aria-hidden />
      {label}
    </span>
  );
}

type AccountSnapshot = ReturnType<typeof buildAccountSnapshot>;
type ActionItem = ReturnType<typeof buildActionItems>[number];
type RiskEscalation = ReturnType<typeof buildRiskEscalations>[number];
type AuditItem = ReturnType<typeof buildAuditItems>[number];

interface DashboardReadiness {
  label: string;
  tone: StatusTone;
  title: string;
  detail: string;
  allowsSizing: boolean;
}

function buildAccountSnapshot(summary: PortfolioSummary, positions: Position[]) {
  const equity = Number.isFinite(summary.equity) ? summary.equity : 0;
  const cash = Number.isFinite(summary.cash) ? summary.cash : 0;
  const buyingPower = Number.isFinite(summary.buyingPower) ? summary.buyingPower : cash;
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
    buyingPower,
    dayPnl,
    dayPnlPct: equity > 0 ? (dayPnl / equity) * 100 : 0,
    positionsCount: positions.length,
    grossMarketValue,
    grossExposurePct,
    cashPct,
    twoPctShock: grossMarketValue * 0.02,
    largestPosition,
  };
}

function buildDashboardReadiness({
  account,
  selectedQuote,
  marketOpen,
  pipelineStatus,
  strategiesError,
}: {
  account: AccountSnapshot;
  selectedQuote: ReturnType<typeof toQuote>;
  marketOpen: boolean;
  pipelineStatus?: PipelineStatus;
  strategiesError: boolean;
}): DashboardReadiness {
  const hasQuoteContext = selectedQuote.last > 0 || Number.isFinite(selectedQuote.timestamp);

  if (!account.ready) {
    return {
      label: "Limited",
      tone: "amber",
      title: "Broker snapshot pending",
      detail: "Sizing, buying power, and shock metrics stay locked until equity and cash refresh. Review queues remain available.",
      allowsSizing: false,
    };
  }

  if (strategiesError) {
    return {
      label: "Limited",
      tone: "amber",
      title: "Strategy health needs refresh",
      detail: "Account and risk context are visible, but strategy exceptions may be incomplete until the strategy feed recovers.",
      allowsSizing: true,
    };
  }

  if (!hasQuoteContext) {
    return {
      label: "Limited",
      tone: "amber",
      title: "Quote context pending",
      detail: "Book state is usable for triage, but execution should wait for a fresh symbol quote on the Trade page.",
      allowsSizing: true,
    };
  }

  if (pipelineStatus?.running) {
    return {
      label: "Syncing",
      tone: "muted",
      title: "Pipeline run in progress",
      detail: pipelineStatus.stage ?? "Strategy pipeline is updating derived state. Let it settle before acting on new signals.",
      allowsSizing: true,
    };
  }

  return {
    label: marketOpen ? "Ready" : "Review",
    tone: marketOpen ? "profit" : "muted",
    title: marketOpen ? "Dashboard ready for triage" : "Off-session review mode",
    detail: marketOpen
      ? "Account, risk gates, quote context, and action queues are available for the first scan."
      : "Markets are closed; use the dashboard for review, cleanup, and next-session preparation.",
    allowsSizing: true,
  };
}

function buildRiskEscalations({
  account,
  greeks,
  orders,
  openOrders,
  pipelineStatus,
}: {
  account: AccountSnapshot;
  greeks: PortfolioGreeks;
  orders: Order[];
  openOrders: number;
  pipelineStatus?: PipelineStatus;
}) {
  const rejected = orders.filter((o) => o.status === "rejected").length;
  const items: Array<{
    title: string;
    detail: string;
    metric: string;
    owner: string;
    tone: StatusTone;
  }> = [];

  if (!account.ready) {
    items.push({
      title: "Broker snapshot pending",
      detail: "Sizing is locked until the portfolio endpoint confirms equity, cash, and buying power.",
      metric: "Sizing locked",
      owner: "OPS",
      tone: "amber",
    });
    return items;
  }

  if (rejected > 0) {
    items.push({
      title: "Rejected broker events",
      detail: "Inspect the rejection reason before re-submitting or adding similar risk.",
      metric: `${rejected} reject${rejected === 1 ? "" : "s"} today`,
      owner: "TRDR",
      tone: "loss",
    });
  }
  if (openOrders > 0) {
    items.push({
      title: "Working orders need review",
      detail: "Check stale limits, partial fills, and cancel state before increasing gross exposure.",
      metric: `${openOrders} open order${openOrders === 1 ? "" : "s"}`,
      owner: "TRDR",
      tone: "amber",
    });
  }
  if (account.grossExposurePct >= 85) {
    items.push({
      title: "Gross exposure near ceiling",
      detail: "Require PM approval before opening new risk while the book is this deployed.",
      metric: `${formatPercent(account.grossExposurePct)} gross`,
      owner: "PM",
      tone: "loss",
    });
  } else if (account.grossExposurePct >= 62) {
    items.push({
      title: "Exposure runway narrowing",
      detail: "Size new entries against available buying power and current shock loss.",
      metric: `${formatPercent(account.grossExposurePct)} gross`,
      owner: "PM",
      tone: "amber",
    });
  }
  if (account.cashPct < 12) {
    items.push({
      title: "Cash buffer below policy",
      detail: "Free cash is thin; closing or reducing exposure should beat fresh entries.",
      metric: `${formatPercent(account.cashPct)} cash`,
      owner: "RISK",
      tone: "loss",
    });
  }
  if (account.largestPosition && account.largestPosition.pct >= 28) {
    items.push({
      title: `${account.largestPosition.symbol} concentration`,
      detail: "Largest line is beyond the single-name comfort band for this dashboard view.",
      metric: `${formatPercent(account.largestPosition.pct)} of equity`,
      owner: "PM",
      tone: account.largestPosition.pct >= 40 ? "loss" : "amber",
    });
  }
  if (!greeks.isDemo && account.equity > 0 && Math.abs(greeks.betaWeightedDelta) > account.equity * 0.45) {
    items.push({
      title: "Beta delta pressure",
      detail: "Portfolio sensitivity is high enough to warrant hedge or scenario review.",
      metric: formatGreek(greeks.betaWeightedDelta, 0),
      owner: "RISK",
      tone: "amber",
    });
  }
  if (greeks.isDemo) {
    items.push({
      title: "Options Greeks unavailable",
      detail: "Do not infer zero options risk from the fallback feed; verify positions before options execution.",
      metric: "Risk feed fallback",
      owner: "QA",
      tone: "amber",
    });
  }
  if (pipelineStatus?.running) {
    items.push({
      title: "Strategy pipeline in flight",
      detail: pipelineStatus.stage ?? pipelineStatus.current_strategy ?? "Let the active run settle before acting on derived strategy state.",
      metric: "Live job",
      owner: "OPS",
      tone: "muted",
    });
  }

  if (items.length === 0) {
    items.push({
      title: "Policy gates clear",
      detail: "Exposure, orders, cash buffer, and Greeks are within the dashboard policy bands.",
      metric: "No active blockers",
      owner: "RISK",
      tone: "profit",
    });
  }

  return items;
}

function buildAuditItems({
  summary,
  selectedSymbol,
  selectedQuote,
  marketOpen,
  pipelineStatus,
  clockEt,
}: {
  summary: PortfolioSummary;
  selectedSymbol: string;
  selectedQuote: ReturnType<typeof toQuote>;
  marketOpen: boolean;
  pipelineStatus?: PipelineStatus;
  clockEt: string;
}) {
  const brokerAge = summary.lastUpdated ? formatAgeFromIso(summary.lastUpdated) : "No timestamp";
  const quoteAge = Number.isFinite(selectedQuote.timestamp)
    ? formatAgeFromSeconds(selectedQuote.timestamp)
    : "No timestamp";
  const source = summary.source ?? (summary.is_demo ? "demo" : "broker");
  return [
    {
      kind: "broker" as const,
      label: "Broker",
      title: source === "demo" ? "Demo portfolio source" : `${source} account source`,
      detail: summary.lastUpdated ? `Last portfolio refresh ${brokerAge}.` : "Portfolio endpoint has not supplied a refresh time.",
      status: summary.is_demo ? "Demo" : brokerAge,
      toneClass: summary.lastUpdated ? "text-fg" : "text-amber",
    },
    {
      kind: "market" as const,
      label: "Market data",
      title: `${selectedSymbol} quote`,
      detail: marketOpen ? "Cash session is open; stale quote age should stay visible." : "Off-session quote may represent last venue update.",
      status: quoteAge,
      toneClass: Number.isFinite(selectedQuote.timestamp) ? "text-fg" : "text-amber",
    },
    {
      kind: "pipeline" as const,
      label: "Strategy pipeline",
      title: pipelineStatus?.running ? "Run active" : "Idle",
      detail: pipelineStatus?.stage ?? pipelineStatus?.last_result ?? "No active strategy job; dashboard is reading last-known state.",
      status: pipelineStatus?.running ? "Live" : "Idle",
      toneClass: pipelineStatus?.running ? "text-profit" : "text-fg-muted",
    },
    {
      kind: "handoff" as const,
      label: "Operator clock",
      title: `${clockEt} ET`,
      detail: "Use this timestamp when matching dashboard decisions to broker/order logs.",
      status: marketOpen ? "Session" : "After hours",
      toneClass: marketOpen ? "text-profit" : "text-fg-muted",
    },
  ];
}

function formatAgeFromIso(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "invalid time";
  return formatAgeFromSeconds(ms / 1000);
}

function formatAgeFromSeconds(value: number | undefined) {
  if (!Number.isFinite(value)) return "No timestamp";
  const normalizedSeconds = Number(value) > 1e12 ? Number(value) / 1000 : Number(value);
  const ageSeconds = Math.max(0, Math.round(Date.now() / 1000 - normalizedSeconds));
  if (ageSeconds < 60) return `${ageSeconds}s old`;
  const minutes = Math.round(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.round(hours / 24)}d old`;
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
      const exception =
        strategy.live_disabled === true ||
        strategy.paper_only === true ||
        status !== "active" ||
        (winRate >= 0 && winRate < 45);
      return {
        id: strategy.id,
        name: strategy.name || strategy.id,
        status,
        returnPct,
        positions,
        invested: Number.isFinite(strategy.invested_amount) ? strategy.invested_amount : 0,
        exception,
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

function buildActionItems({
  openOrders,
  positions,
  orders,
  activeStrategyCount,
	  totalStrategyCount,
	  strategiesLoading,
	  pipelineStatus,
	}: {
  openOrders: number;
  positions: Position[];
  orders: Order[];
	  activeStrategyCount: number;
	  totalStrategyCount: number;
	  strategiesLoading: boolean;
	  pipelineStatus?: PipelineStatus;
	}) {
  const rejected = orders.filter((o) => o.status === "rejected").length;
  const activeRatio = totalStrategyCount > 0 ? activeStrategyCount / totalStrategyCount : 0;
  let largest = positions.reduce<Position | null>((best, pos) => {
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
    const largestPct = positions.length
      ? Math.max(...positions.map((p) => Math.abs(p.marketValue ?? 0))) /
        Math.max(
          1,
          positions.reduce((sum, p) => sum + Math.abs(p.marketValue ?? 0), 0),
        )
      : 0;
    if (largestPct < 0.35) {
      // Concentration is only an action when one line item dominates the book.
      largest = null;
    }
  }
  if (largest && Math.abs(largest.marketValue ?? 0) > 0) {
    items.push({
      title: `${largest.symbol} is the largest exposure`,
      detail: `${formatCurrency(Math.abs(largest.marketValue ?? 0))} market value. Check concentration before new entries.`,
      tone: "muted",
      action: "trade",
    });
  }
  if (pipelineStatus?.running) {
    items.push({
      title: "Pipeline running",
      detail: pipelineStatus.stage ?? pipelineStatus.current_strategy ?? "Strategy jobs are still moving.",
      tone: "profit",
      action: "pipeline",
    });
  }
	  if (!strategiesLoading && !pipelineStatus?.running && totalStrategyCount > 0 && activeRatio < 0.5) {
    items.push({
      title: "Strategies mostly paused",
      detail: `${activeStrategyCount}/${totalStrategyCount} strategies are enabled. Review intentional pauses before market open.`,
      tone: "amber",
      action: "pipeline",
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
	      const isRunning = pipelineStatus?.running === true;
	      next[pipeIdx] = {
	        ...next[pipeIdx],
	        label: `Pipeline ${pipelineRunningCount}/${pipelineTotal}`,
	        tone: isRunning ? "profit" : "muted",
	        title: isRunning
	          ? pipelineStatus?.stage ?? pipelineStatus?.current_strategy ?? "Pipeline is running"
	          : pipelineStatus?.last_result ?? "Pipeline idle",
	      };
	    }
	    return next;
	  }, [base, lastTickSec, marketOpen, pipelineRunningCount, pipelineStatus, pipelineTotal]);

  return <StatusBar pills={pills} buildVersion={buildVersion} />;
}

/* ─── Tiny helpers kept inline ──────────────────────────── */

// isMarketOpen now lives in @/lib/marketHours and uses Intl America/New_York
// so it handles EST/EDT correctly year-round. See wave-8 audit finding.
