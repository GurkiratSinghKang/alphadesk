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
import { useEffect, useMemo, useState } from "react";
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
import { getBars, getOrders } from "@/lib/api";
import {
  useIndices,
  usePortfolioSummary,
  useRegime,
  useStrategies,
} from "@/hooks/useQueries";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import type { Position } from "@/types";

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
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const quotes = useMarketStore((s) => s.quotes);

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
  useEffect(() => {
    let cancelled = false;
    async function fetchBars() {
      try {
        const bars = await getBars(selectedSymbol, "D", rangeToLimit(range));
        if (!cancelled) setSeries(bars);
      } catch {
        if (!cancelled) setSeries([]);
      }
    }
    fetchBars();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, range]);

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
  const quote = toQuote(quotes[selectedSymbol]);
  const meta = toMetaCells(quotes[selectedSymbol]);
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
    // Pick the freshest timestamp across quotes the desk might care about.
    const ts = Object.values(quotes).reduce<number>((max, q) => {
      const t = Number(q?.timestamp) || 0;
      return t > max ? t : max;
    }, 0);
    if (!ts) return undefined;
    // Server timestamps are usually seconds — normalise if they look like ms.
    const epochMs = ts > 1e12 ? ts : ts * 1000;
    const delta = (Date.now() - epochMs) / 1000;
    return delta >= 0 && delta < 86_400 ? delta : undefined;
  }, [quotes, tickHeartbeat]);

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

  function handleStageOrder(_order: StagedOrder) {
    // Staging flow lands in F4 — the OrderBar's validation already ran
    // client-side. Route to the confirmation page where the preview +
    // server-side risk check happen.
    router.push("/trade");
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
            className="flex-1 min-h-0"
          />
          <OrderBar
            symbol={selectedSymbol}
            strategies={strategyOptions}
            onSubmit={handleStageOrder}
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

function isMarketOpen(): boolean {
  const now = new Date();
  // Rough US-session heuristic — precise NYSE calendar lands in F4.
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const mins = h * 60 + m;
  // 13:30 UTC → 20:00 UTC covers 9:30am–4:00pm ET during EST.
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}
