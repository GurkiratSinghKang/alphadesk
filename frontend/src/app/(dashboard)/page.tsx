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
import { useRouter } from "next/navigation";

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
  type PositionTab,
  type StagedOrder,
} from "@/components/composites";
import { DeskLayout } from "@/components/layouts";
import { getBars, getOrders, placeOrder } from "@/lib/api";
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
  const { toast } = useToast();
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  // Wave 14 perf-audit-r3 P0 #3: `useQuote(selectedSymbol)` only rerenders
  // this page when the selected symbol's quote changes — not on every WS
  // tick for every other watchlist symbol.
  const selectedQuote = useQuote(selectedSymbol);

  const portfolioSummary = usePortfolioStore((s) => s.summary);
  const positions = usePortfolioStore((s) => s.positions);

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
    async function fetchCounts() {
      try {
        const [pending, open] = await Promise.all([
          getOrders("pending").catch(() => []),
          getOrders("open").catch(() => []),
        ]);
        if (!cancelled) setOrderCount(pending.length + open.length);
      } catch {
        if (!cancelled) setOrderCount(0);
      }
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
    setSelectedStrategyId(id);
  }

  function handleSelectSymbol(symbol: string) {
    setSelectedSymbol(symbol);
  }

  const [orderBarResetTick, setOrderBarResetTick] = useState(0);
  const [submittingOrder, setSubmittingOrder] = useState(false);

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
      toast({
        type: "success",
        message: `${order.side.toUpperCase()} ${qty} ${symbol} staged — ${placed.status ?? "pending"}`,
      });
      // Bump a tick so OrderBar resets its internal field state via `key`.
      setOrderBarResetTick((t) => t + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order submission failed";
      toast({ type: "error", message });
      // Keep the OrderBar populated so the user can correct + retry.
    } finally {
      setSubmittingOrder(false);
    }
  }

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
            defaults={{
              strategyId: selectedStrategyId,
              side: "buy",
              quantity: 100,
              type: "limit",
            }}
          />
        </>
      }
      right={
        <>
          <div className="flex-1 min-h-0 overflow-auto">
            <PositionsList
              positions={positionRows}
              activeTab={bookTab}
              onTabChange={setBookTab}
              onRowClick={(id) => {
                const p = positionRows.find((r) => r.id === id);
                if (p) handleSelectSymbol(p.symbol);
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
