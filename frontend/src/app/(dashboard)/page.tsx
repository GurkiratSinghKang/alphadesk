"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, RefreshCw } from "lucide-react";
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
import { useRegime, useIndices, useStrategies, usePortfolioSummary } from "@/hooks/useQueries";

import { generateSparkData } from "@/components/dashboard/Sparkline";
import { PortfolioHero } from "@/components/dashboard/PortfolioHero";
import { ActivityFeed, buildFeedItems, type FeedItem, type RegimeData, type NewsItem } from "@/components/dashboard/ActivityFeed";
import { StrategyGrid, STRATEGY_META, STRATEGY_ORDER, type StrategyData } from "@/components/dashboard/StrategyGrid";
import { PositionsSummary } from "@/components/dashboard/PositionsSummary";
import { PnlCalendarMini } from "@/components/dashboard/PnlCalendarMini";
import { MarketContext, type MarketIndex } from "@/components/dashboard/MarketContext";
import { EconomicCalendar } from "@/components/dashboard/EconomicCalendar";

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
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading command center...</div>
      </div>
    );
  }
  return <CommandCenter />;
}

function CommandCenter() {
  const router = useRouter();
  const summary = usePortfolioStore((s) => s.summary);

  // ─── React Query hooks ────────────────────────────────────
  const { data: regimeData } = useRegime();
  const { data: indicesData } = useIndices();
  const { data: strategiesData } = useStrategies();
  const { data: portfolioSummaryData } = usePortfolioSummary();

  // ─── State (for data without hooks) ───────────────────────
  const [sectors, setSectors] = useState<{ sector: string; change_pct: number }[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [equityHistory, setEquityHistory] = useState<{ date: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

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
  useEffect(() => {
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

      // Pipeline history: find today's log
      let pLog: Record<string, any> | null = null;
      if (pipelineHistoryRes.status === "fulfilled" && Array.isArray(pipelineHistoryRes.value)) {
        const today = todayDateStr();
        const todayEntry = pipelineHistoryRes.value.find(
          (entry: any) => entry.date === today
        );
        if (todayEntry) {
          pLog = todayEntry;
        }
      }

      // Build feed
      const feed = buildFeedItems(pStatus, pLog, regime, newsItems);
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
            const baseEquity = summary.equity > 0 ? summary.equity : 100000;
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

      if (!cancelled) setLoading(false);
    }

    fetchRemaining().catch((err) => {
      console.error("[Dashboard] fetchRemaining error:", err);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [regime, summary.equity]);

  // ─── Derived values ────────────────────────────────────────
  const activeSummary = portfolioSummaryData ?? summary;
  const portfolioValue = Number.isFinite(activeSummary.equity) && activeSummary.equity > 0 ? activeSummary.equity : 0;
  const dayPnl = Number.isFinite(activeSummary.dayPnl) ? activeSummary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(activeSummary.dayPnlPct) ? activeSummary.dayPnlPct : 0;

  // Sparkline data (deterministic per symbol)
  const sparkData = useMemo(() => {
    const seeds: Record<string, number> = { SPY: 42, QQQ: 137, IWM: 256, VIX: 512 };
    const result: Record<string, number[]> = {};
    for (const idx of indices) {
      result[idx.symbol] = generateSparkData(seeds[idx.symbol] ?? 100);
    }
    return result;
  }, [indices]);

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading command center...</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[1800px] space-y-4 p-4 md:p-6">
        {/* Section 1: Command Bar */}
        <PortfolioHero
          portfolioValue={portfolioValue}
          dayPnl={dayPnl}
          dayPnlPct={dayPnlPct}
          equityHistory={equityHistory}
        />

        {/* Sections 2 & 3: Activity Feed + Strategy Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Activity Feed (left ~60%) */}
          <div className="lg:col-span-3 space-y-4">
            <ActivityFeed
              feedItems={feedItems}
              onNavigate={(path) => router.push(path)}
            />

            {/* Positions + Calendar (below feed) */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PositionsSummary />
              <PnlCalendarMini />
            </div>
            <EconomicCalendar />
          </div>

          {/* Strategy Grid (right ~40%) */}
          <div className="lg:col-span-2">
            <StrategyGrid
              strategies={strategies}
              regimeLabel={regime?.label ?? "unknown"}
              onStrategyClick={(id) => router.push(`/strategies/${id}`)}
            />
          </div>
        </div>

        {/* Section 4: Market Context */}
        <MarketContext
          indices={indices}
          sectors={sectors}
          news={news}
          summary={activeSummary}
          sparkData={sparkData}
        />
      </div>
    </ScrollArea>
  );
}
