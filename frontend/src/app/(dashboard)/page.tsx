"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Activity, RefreshCw } from "lucide-react";
import { useMarketStore } from "@/stores/market";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePortfolioStore } from "@/stores/portfolio";
import {
  getMarketNews,
  getMarketSectors,
  getPipelineStatus,
  getPipelineHistory,
  getPortfolioPerformance,
  type PipelineStatus,
} from "@/lib/api";
import { useRegime, useIndices, useStrategies, usePortfolioSummary, useIndexSparklines } from "@/hooks/useQueries";

// generateSparkData removed — using flat arrays instead of fake random walks
import { PortfolioHero } from "@/components/dashboard/PortfolioHero";
import { ActivityFeed, buildFeedItems, type FeedItem, type RegimeData, type NewsItem } from "@/components/dashboard/ActivityFeed";
import { StrategyGrid, STRATEGY_META, STRATEGY_ORDER, type StrategyData } from "@/components/dashboard/StrategyGrid";
import { PositionsSummary } from "@/components/dashboard/PositionsSummary";
import { PnlCalendarMini } from "@/components/dashboard/PnlCalendarMini";
import { MarketContext, type MarketIndex } from "@/components/dashboard/MarketContext";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { EconomicCalendar } from "@/components/dashboard/EconomicCalendar";
import { RiskDashboard } from "@/components/dashboard/RiskDashboard";

// Lazy-load heavy below-the-fold components to reduce initial bundle
const StrategyCorrelation = dynamic(
  () => import("@/components/dashboard/StrategyCorrelation").then((m) => ({ default: m.StrategyCorrelation })),
  { ssr: false, loading: () => <div className="animate-pulse bg-[var(--panel)] rounded-lg h-[200px]" /> }
);
const PnlAttribution = dynamic(
  () => import("@/components/dashboard/PnlAttribution").then((m) => ({ default: m.PnlAttribution })),
  { ssr: false, loading: () => <div className="animate-pulse bg-[var(--panel)] rounded-lg h-[200px]" /> }
);
const MarketMovers = dynamic(
  () => import("@/components/dashboard/MarketMovers").then((m) => ({ default: m.MarketMovers })),
  { ssr: false, loading: () => <div className="animate-pulse bg-[var(--panel)] rounded-lg h-[300px]" /> }
);

// ─── Helpers ─────────────────────────────────────────────────

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Main Page ───────────────────────────────────────────────

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="mx-auto max-w-[1800px] space-y-4 p-4 md:p-6 animate-pulse">
        {/* Hero skeleton */}
        <div className="h-40 rounded-xl bg-muted/30" />
        {/* Main grid skeleton */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            <div className="h-64 rounded-xl bg-muted/30" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="h-48 rounded-xl bg-muted/30" />
              <div className="h-48 rounded-xl bg-muted/30" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="h-80 rounded-xl bg-muted/30" />
          </div>
        </div>
        {/* Market context skeleton */}
        <div className="h-32 rounded-xl bg-muted/30" />
      </div>
    );
  }
  return <CommandCenter />;
}

function CommandCenter() {
  const router = useRouter();
  const summary = usePortfolioStore((s) => s.summary);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    router.push("/trade");
  };

  // ─── First-login welcome banner ──────────────────────────
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem('alphadesk-welcomed');
  });

  const dismissWelcome = () => {
    localStorage.setItem('alphadesk-welcomed', '1');
    setShowWelcome(false);
  };

  // ─── React Query hooks ────────────────────────────────────
  const { data: regimeData } = useRegime();
  const { data: indicesData } = useIndices();
  const { data: strategiesData } = useStrategies();
  const { data: portfolioSummaryData } = usePortfolioSummary();
  const { data: indexSparklinesData } = useIndexSparklines();

  // Sync React Query portfolio data into Zustand so StatusStrip/ProfileMenu stay current
  useEffect(() => {
    if (portfolioSummaryData) {
      usePortfolioStore.getState().setSummary(portfolioSummaryData);
    }
  }, [portfolioSummaryData]);

  // ─── State (for data without hooks) ───────────────────────
  const [sectors, setSectors] = useState<{ sector: string; change_pct: number; ytd_pct?: number; leader?: string; leader_change_pct?: number }[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [equityHistory, setEquityHistory] = useState<{ date: string; value: number }[]>([]);
  const [remainingLoaded, setRemainingLoaded] = useState(false);

  // ─── Derive strategies from hook data ─────────────────────
  const strategies: StrategyData[] = useMemo(() => {
    const apiStrategies = strategiesData;
    if (apiStrategies && Array.isArray(apiStrategies)) {
      return STRATEGY_ORDER.map((id) => {
        const meta = STRATEGY_META[id];
        const apiMatch = apiStrategies.find((s: any) => s.id === id);
        return {
          id,
          name: meta?.name ?? id,
          shortName: meta?.shortName ?? id,
          status: apiMatch?.status === "active" ? "active" : "paused",
          returnPct: apiMatch?.total_return_pct ?? 0,
          positions: apiMatch?.active_positions_count ?? 0,
          winRate: apiMatch?.win_rate ?? 0,
          invested: apiMatch?.invested_amount ?? 0,
          icon: meta?.icon ?? Activity,
          sparkline: apiMatch?.sparkline ?? [],
        } as StrategyData;
      });
    }
    return STRATEGY_ORDER.map((id) => ({
      id,
      name: STRATEGY_META[id]?.name ?? id,
      shortName: STRATEGY_META[id]?.shortName ?? id,
      status: "active" as const,
      returnPct: 0,
      positions: 0,
      winRate: 0,
      invested: 0,
      icon: STRATEGY_META[id]?.icon ?? Activity,
      sparkline: [],
    }));
  }, [strategiesData]);

  // ─── Derive indices from hook data ────────────────────────
  const indices: MarketIndex[] = useMemo(() => {
    const raw = indicesData?.indices ?? [];
    const names: Record<string, string> = {
      SPY: "S&P 500",
      QQQ: "NASDAQ 100",
      IWM: "Russell 2000",
      VIX: "VIX",
    };
    return raw
      .filter((idx: any) => names[idx.symbol])
      .map((idx: any) => ({
        symbol: idx.symbol,
        name: names[idx.symbol] ?? idx.name,
        price: idx.price,
        change: idx.change ?? 0,
        changePct: idx.change_pct ?? 0,
      }));
  }, [indicesData]);

  // ─── Derive regime from hook data ─────────────────────────
  const regime: RegimeData | null = regimeData?.regime ?? null;

  // ─── Fetch remaining data (sectors, news, pipeline, equity curve) ──
  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    let cancelled = false;

    async function fetchRemaining() {
      const [
        sectorsRes,
        newsRes,
        pipelineStatusRes,
        pipelineHistoryRes,
      ] = await Promise.allSettled([
        getMarketSectors(),
        getMarketNews(),
        getPipelineStatus(),
        getPipelineHistory(),
      ]);

      if (cancelled) return;

      try {
      // Sectors
      if (sectorsRes.status === "fulfilled") {
        setSectors(sectorsRes.value.sectors ?? []);
      }

      // News
      let newsItems: NewsItem[] = [];
      if (newsRes.status === "fulfilled" && Array.isArray(newsRes.value)) {
        newsItems = newsRes.value.slice(0, 4);
        setNews(newsItems);
      }

      // Pipeline status
      let pStatus: PipelineStatus | null = null;
      if (pipelineStatusRes.status === "fulfilled") {
        pStatus = pipelineStatusRes.value;
      }

      // Pipeline history: find latest log and fetch its full details
      let pLog: Record<string, any> | null = null;
      if (pipelineHistoryRes.status === "fulfilled" && Array.isArray(pipelineHistoryRes.value) && pipelineHistoryRes.value.length > 0) {
        // Use the most recent entry (already sorted newest-first from API)
        const latestEntry = pipelineHistoryRes.value[0];
        const latestDate = latestEntry?.date;
        if (latestDate) {
          try {
            // Fetch full log for the latest date (summary endpoint only has counts)
            const { getPipelineRun: fetchRun } = await import("@/lib/api");
            const fullRun = await fetchRun(latestDate);
            // Re-map into the shape buildFeedItems expects (snake_case keys + raw arrays)
            pLog = {
              date: fullRun.date,
              timestamp: fullRun.timestamp,
              orders_placed: fullRun.ordersPlaced?.map((o: any) => ({
                symbol: o.symbol, side: o.side, qty: o.qty,
                price: o.price, order_id: o.orderId,
                timestamp: o.timestamp, strategy: o.strategy,
              })) ?? [],
              orders_closed: fullRun.ordersClosed?.map((o: any) => ({
                symbol: o.symbol, side: o.side, qty: o.qty,
                price: o.price, order_id: o.orderId,
                timestamp: o.timestamp, pnl: o.pnl,
              })) ?? [],
              errors: fullRun.errors ?? [],
              master_agent: fullRun.master_agent ?? {},
              strategies_run: fullRun.strategies ?? {},
            };
          } catch {
            // Fall back to the summary entry
            pLog = latestEntry;
          }
        }
      }

      // Build feed (news excluded — shown in MarketContext instead)
      const feed = buildFeedItems(pStatus, pLog, regime);
      setFeedItems(feed);
      } catch (err) {
        console.error("[Dashboard] Data processing error:", err);
      }

      // Fetch real equity curve from performance endpoint
      if (!cancelled) {
        try {
          const perfData = await getPortfolioPerformance();
          if (cancelled) return;
          if (Array.isArray(perfData.equity_curve) && perfData.equity_curve.length > 0) {
            const freshEquity = usePortfolioStore.getState().summary.equity;
            const baseEquity = freshEquity > 0 ? freshEquity : 100000;
            const totalPnl = perfData.equity_curve[perfData.equity_curve.length - 1]?.cumulative_pnl ?? 0;
            const startEquity = baseEquity - totalPnl;
            const history = perfData.equity_curve.map((pt, i: number) => {
              const d = new Date();
              d.setDate(d.getDate() - (perfData.equity_curve.length - 1 - i));
              return {
                date: d.toISOString().slice(0, 10),
                value: startEquity + (pt.cumulative_pnl ?? 0),
              };
            });
            if (!cancelled) setEquityHistory(history);
          }
        } catch (err) {
          console.error("[Dashboard] Equity curve fetch failed:", err);
        }
      }

      if (!cancelled) setRemainingLoaded(true);
    }

    fetchRemaining().catch((err) => {
      console.error("[Dashboard] fetchRemaining error:", err);
      if (!cancelled) setRemainingLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Derived values ────────────────────────────────────────
  const activeSummary = portfolioSummaryData ?? summary;
  const portfolioValue = Number.isFinite(activeSummary.equity) && activeSummary.equity > 0 ? activeSummary.equity : 0;
  const dayPnl = Number.isFinite(activeSummary.dayPnl) ? activeSummary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(activeSummary.dayPnlPct) ? activeSummary.dayPnlPct : 0;
  const isDemo = !!activeSummary.is_demo;

  // Sparkline data — 20-day closing prices from the indices sparklines endpoint.
  const sparkData = useMemo(() => {
    const apiSparklines = indexSparklinesData?.sparklines ?? {};
    const result: Record<string, number[]> = {};
    for (const idx of indices) {
      result[idx.symbol] = apiSparklines[idx.symbol] ?? [];
    }
    return result;
  }, [indices, indexSparklinesData]);

  // ─── Render ────────────────────────────────────────────────
  // Show the dashboard immediately using React Query data.
  // Remaining sections (activity feed, market context) load independently.
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[1800px] space-y-4 p-4 md:p-6">
        {/* Welcome banner for first-time users */}
        {showWelcome && (
          <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm text-foreground">
              Welcome to AlphaDesk! Use{' '}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">&#8984;K</kbd>{' '}
              to search symbols,{' '}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">?</kbd>{' '}
              for keyboard shortcuts, or click any strategy card to explore.
            </p>
            <button
              onClick={dismissWelcome}
              className="ml-4 shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss welcome message"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Section 1: Command Bar */}
        <PortfolioHero
          portfolioValue={portfolioValue}
          dayPnl={dayPnl}
          dayPnlPct={dayPnlPct}
          equityHistory={equityHistory}
          isDemo={isDemo}
        />

        {/* Sections 2 & 3: Activity Feed + Strategy Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Activity Feed (left ~60%) */}
          <div className="lg:col-span-3 space-y-4">
            {remainingLoaded ? (
              <ActivityFeed
                feedItems={feedItems}
                onNavigate={(path) => router.push(path)}
              />
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-[var(--surface)]">
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">Loading activity...</span>
              </div>
            )}

            {/* Positions + Calendar (below feed) */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PositionsSummary />
              <PnlCalendarMini />
            </div>
            {/* Risk Overview */}
            <RiskDashboard regime={regime} />
            <EconomicCalendar />
          </div>

          {/* Strategy Grid + P&L Attribution (right ~40%) */}
          <div className="lg:col-span-2 space-y-4">
            <StrategyGrid
              strategies={strategies}
              regimeLabel={regime?.label ?? "unknown"}
              onStrategyClick={(id) => router.push(`/strategies/${id}`)}
            />
            <PnlAttribution strategies={strategies} />
          </div>
        </div>

        {/* Strategy Correlation Matrix */}
        <StrategyCorrelation strategies={strategies} />

        {/* Section 4: Market Context */}
        {remainingLoaded ? (
          <MarketContext
            indices={indices}
            sectors={sectors}
            news={news}
            summary={activeSummary}
            sparkData={sparkData}
            isDemo={isDemo}
          />
        ) : (
          <div className="h-32 animate-pulse rounded-xl bg-muted/30" />
        )}

        {/* Section 5: Market Movers + Breadth */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <MarketMovers onSelectSymbol={handleSelectSymbol} />
          </div>
          <div>
            {remainingLoaded ? (
              <MarketBreadth sectors={sectors} />
            ) : (
              <div className="h-48 animate-pulse rounded-xl bg-muted/30" />
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
