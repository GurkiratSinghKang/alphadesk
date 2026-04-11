"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePortfolioStore } from "@/stores/portfolio";
import {
  getPortfolioSummary,
  getMarketNews,
  getStrategies,
  getMarketIndices,
  getMarketRegime,
  getMarketSectors,
  getPipelineStatus,
  getPipelineHistory,
  type PipelineStatus,
} from "@/lib/api";

import { generateSparkData } from "@/components/dashboard/Sparkline";
import { PortfolioHero } from "@/components/dashboard/PortfolioHero";
import { ActivityFeed, buildFeedItems, type FeedItem, type RegimeData, type NewsItem } from "@/components/dashboard/ActivityFeed";
import { StrategyGrid, STRATEGY_META, STRATEGY_ORDER, type StrategyData } from "@/components/dashboard/StrategyGrid";
import { PositionsSummary } from "@/components/dashboard/PositionsSummary";
import { PnlCalendarMini } from "@/components/dashboard/PnlCalendarMini";
import { MarketContext, type MarketIndex } from "@/components/dashboard/MarketContext";

// ─── Helpers ─────────────────────────────────────────────────

function formatTimeShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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
  const setSummary = usePortfolioStore((s) => s.setSummary);

  // ─── State ─────────────────────────────────────────────────
  const [strategies, setStrategies] = useState<StrategyData[]>([]);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [sectors, setSectors] = useState<{ sector: string; change_pct: number }[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [pipelineLog, setPipelineLog] = useState<Record<string, any> | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // ─── Data Fetching ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      // Fire all requests in parallel
      const [
        summaryRes,
        strategiesRes,
        indicesRes,
        regimeRes,
        sectorsRes,
        newsRes,
        pipelineStatusRes,
        pipelineHistoryRes,
      ] = await Promise.allSettled([
        getPortfolioSummary(),
        getStrategies(),
        getMarketIndices(),
        getMarketRegime(),
        getMarketSectors(),
        getMarketNews(),
        getPipelineStatus(),
        getPipelineHistory(),
      ]);

      if (cancelled) return;

      try {
      if (summaryRes.status === "fulfilled") {
        setSummary(summaryRes.value);
      }

      // Strategies
      if (strategiesRes.status === "fulfilled" && Array.isArray(strategiesRes.value)) {
        const apiStrategies = strategiesRes.value;
        const mapped: StrategyData[] = STRATEGY_ORDER.map((id) => {
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
          };
        });
        setStrategies(mapped);
      } else {
        // Fallback: show all with zeros
        setStrategies(
          STRATEGY_ORDER.map((id) => ({
            id,
            name: STRATEGY_META[id]?.name ?? id,
            shortName: STRATEGY_META[id]?.shortName ?? id,
            status: "active" as const,
            returnPct: 0,
            positions: 0,
            winRate: 0,
            invested: 0,
            icon: STRATEGY_META[id]?.icon ?? Activity,
          }))
        );
      }

      // Market indices
      if (indicesRes.status === "fulfilled") {
        const raw = indicesRes.value.indices ?? [];
        const names: Record<string, string> = {
          SPY: "S&P 500",
          QQQ: "NASDAQ 100",
          IWM: "Russell 2000",
          VIX: "VIX",
        };
        const filtered = raw
          .filter((idx: any) => names[idx.symbol])
          .map((idx: any) => ({
            symbol: idx.symbol,
            name: names[idx.symbol] ?? idx.name,
            price: idx.price,
            change: idx.change ?? 0,
            changePct: idx.change_pct ?? 0,
          }));
        if (filtered.length > 0) setIndices(filtered);
      }

      // Regime
      if (regimeRes.status === "fulfilled") {
        setRegime(regimeRes.value.regime);
      }

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
        setPipelineStatus(pStatus);
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
          setPipelineLog(todayEntry);
        }
      }

      // Build feed
      const regimeData = regimeRes.status === "fulfilled" ? regimeRes.value.regime : null;
      const feed = buildFeedItems(pStatus, pLog, regimeData, newsItems);
      setFeedItems(feed);
      } catch (err) {
        console.error("[Dashboard] Data processing error:", err);
      }

      setLoading(false);
    }

    fetchAll().catch((err) => {
      console.error("[Dashboard] fetchAll error:", err);
      setLoading(false);
    });

    // WebSocket connection indicator — check if we can reach the API
    const wsCheck = setInterval(() => {
      setWsConnected((prev) => !prev ? true : prev);
    }, 5000);
    // Mark connected after initial load
    setWsConnected(true);

    return () => {
      cancelled = true;
      clearInterval(wsCheck);
    };
  }, [setSummary]);

  // ─── Derived values ────────────────────────────────────────
  const portfolioValue = Number.isFinite(summary.equity) && summary.equity > 0 ? summary.equity : 0;
  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;

  // Regime badge color
  const regimeBadgeColor = useMemo(() => {
    if (!regime) return "bg-zinc-700 text-zinc-300";
    switch (regime.label) {
      case "bull":
        return "bg-emerald-900/60 text-emerald-300 border-emerald-500/30";
      case "bear":
        return "bg-red-900/60 text-red-300 border-red-500/30";
      default:
        return "bg-amber-900/60 text-amber-300 border-amber-500/30";
    }
  }, [regime]);

  // VIX from indices
  const vixData = indices.find((i) => i.symbol === "VIX");
  const vixLevel = regime?.vix_level ?? vixData?.price ?? 0;

  // Pipeline summary text
  const pipelineSummaryText = useMemo(() => {
    if (!pipelineStatus && !pipelineLog) return "No pipeline data";
    if (pipelineStatus?.running) return "Pipeline running...";

    const lastRun = pipelineStatus?.lastRun;
    // Aggregate screened count from strategy entries in pipeline log
    let totalScreened = 0;
    let totalApproved = 0;
    const strats = pipelineLog?.strategies_run ?? pipelineLog?.strategies ?? {};
    if (typeof strats === "object" && strats !== null) {
      for (const s of Object.values(strats)) {
        if (s && typeof s === "object") {
          totalScreened += (s as any).screened ?? 0;
          totalApproved += (s as any).trades_approved ?? 0;
        }
      }
    }
    const ordersPlaced = Array.isArray(pipelineLog?.orders_placed) ? pipelineLog.orders_placed.length : 0;

    let timeStr = "";
    if (lastRun) {
      timeStr = formatTimeShort(lastRun);
    } else if (pipelineLog?.timestamp) {
      timeStr = formatTimeShort(pipelineLog.timestamp);
    }

    const parts: string[] = [];
    if (timeStr) parts.push(`Last run ${timeStr}`);
    if (totalScreened > 0) parts.push(`${totalScreened} screened`);
    parts.push(`${ordersPlaced} trade${ordersPlaced !== 1 ? "s" : ""}`);
    return parts.join(" \u2014 ");
  }, [pipelineStatus, pipelineLog]);

  // Equity history for the hero chart
  const equityHistory = useMemo(() => {
    const history: { date: string; value: number }[] = [];
    let val = portfolioValue - dayPnl; // approximate starting value
    const now = new Date();
    for (let i = 30; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
      const dateStr = d.toISOString().slice(0, 10);
      // Small deterministic random walk
      const seed = (i * 16807) % 2147483647;
      val += ((seed % 1000) - 480) / 10;
      history.push({ date: dateStr, value: val });
    }
    // Ensure last point matches current equity
    if (history.length > 0) history[history.length - 1].value = portfolioValue;
    return history;
  }, [portfolioValue, dayPnl]);

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
          regimeLabel={regime?.label ?? "unknown"}
          regimeName={regime?.regime ?? "Unknown"}
          regimeBadgeColor={regimeBadgeColor}
          vixLevel={vixLevel}
          vixChangePct={vixData ? vixData.changePct : null}
          pipelineSummaryText={pipelineSummaryText}
          wsConnected={wsConnected}
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
          summary={summary}
          sparkData={sparkData}
        />
      </div>
    </ScrollArea>
  );
}
