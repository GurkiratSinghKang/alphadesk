"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Activity,
  Zap,
  BarChart3,
  Target,
  Crosshair,
  Brain,
  Shield,
  ChevronRight,
  Clock,
  AlertTriangle,
  Info,
  Newspaper,
  Radio,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePortfolioStore } from "@/stores/portfolio";
import { formatCurrency, cn } from "@/lib/utils";
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

// ─── Types ───────────────────────────────────────────────────

interface FeedItem {
  id: string;
  time: Date;
  type: "pipeline" | "trade" | "position" | "news" | "regime" | "alert";
  severity: "success" | "danger" | "info" | "warning";
  title: string;
  detail?: string;
}

interface StrategyData {
  id: string;
  name: string;
  shortName: string;
  status: "active" | "paused";
  returnPct: number;
  positions: number;
  winRate: number;
  invested: number;
  icon: typeof Activity;
}

interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

interface RegimeData {
  regime: string;
  label: string;
  confidence: number;
  vix_level: number;
  description: string;
}

interface SectorData {
  sector: string;
  change_pct: number;
}

interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  url: string;
}

// ─── Constants ───────────────────────────────────────────────

const STRATEGY_META: Record<string, { name: string; shortName: string; icon: typeof Activity; regimeNote: string }> = {
  "momentum-quality": {
    name: "Cross-Sectional Momentum + Quality",
    shortName: "Momentum + Quality",
    icon: TrendingUp,
    regimeNote: "Thrives in bull trends",
  },
  pead: {
    name: "Post-Earnings Announcement Drift",
    shortName: "PEAD",
    icon: Target,
    regimeNote: "Event-driven, all regimes",
  },
  "vrp-harvesting": {
    name: "Systematic VRP Harvesting",
    shortName: "VRP Harvesting",
    icon: Shield,
    regimeNote: "Best in low-vol contango",
  },
  "earnings-vol-premium": {
    name: "Earnings Volatility Premium",
    shortName: "Earnings Vol",
    icon: BarChart3,
    regimeNote: "Paused in high-vol regimes",
  },
  "regime-adaptive": {
    name: "HMM Regime-Adaptive Allocation",
    shortName: "Regime Adaptive",
    icon: Brain,
    regimeNote: "Adjusts to any regime",
  },
  "claude-alpha": {
    name: "Claude Alpha",
    shortName: "Claude Alpha",
    icon: Zap,
    regimeNote: "AI-driven, regime-aware",
  },
  "mean-reversion": {
    name: "Mean Reversion",
    shortName: "Mean Reversion",
    icon: Activity,
    regimeNote: "Favored in sideways markets",
  },
  "vcp-breakout": {
    name: "VCP Breakout",
    shortName: "VCP Breakout",
    icon: Crosshair,
    regimeNote: "Needs bull momentum",
  },
};

const STRATEGY_ORDER = [
  "momentum-quality",
  "pead",
  "vrp-harvesting",
  "earnings-vol-premium",
  "regime-adaptive",
  "claude-alpha",
  "mean-reversion",
  "vcp-breakout",
];

// ─── Mini Sparkline SVG ──────────────────────────────────────

function Sparkline({
  data,
  color,
  width = 80,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const gradId = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function generateSparkData(seed: number, count = 20): number[] {
  const data: number[] = [];
  let val = 100;
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 16807 + 0) % 2147483647;
    const r = (s - 1) / 2147483646;
    val += (r - 0.47) * 3;
    data.push(val);
  }
  return data;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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

// ─── Feed Builder ────────────────────────────────────────────

function buildFeedItems(
  pipelineStatus: PipelineStatus | null,
  pipelineLog: Record<string, any> | null,
  regime: RegimeData | null,
  news: NewsItem[],
): FeedItem[] {
  const items: FeedItem[] = [];
  const now = new Date();

  // Pipeline run summary
  if (pipelineLog) {
    const ordersPlaced = Array.isArray(pipelineLog.orders_placed) ? pipelineLog.orders_placed : [];
    const ordersClosed = Array.isArray(pipelineLog.orders_closed) ? pipelineLog.orders_closed : [];
    const errors = Array.isArray(pipelineLog.errors) ? pipelineLog.errors : [];
    const ts = pipelineLog.timestamp ? new Date(pipelineLog.timestamp) : now;

    // Aggregate strategy stats from the log (key is strategies_run or strategies)
    const strats = pipelineLog.strategies_run ?? pipelineLog.strategies ?? {};
    let totalScreened = 0;
    let totalAnalyzed = 0;
    let totalRequested = 0;
    let totalApproved = 0;
    for (const s of Object.values(strats) as any[]) {
      totalScreened += s.screened ?? 0;
      totalAnalyzed += s.analyzed ?? 0;
      totalRequested += s.trades_requested ?? 0;
      totalApproved += s.trades_approved ?? 0;
    }

    // Main pipeline summary
    items.push({
      id: "pipeline-run",
      time: ts,
      type: "pipeline",
      severity: errors.length > 0 ? "warning" : "success",
      title: `Pipeline completed: ${totalScreened} screened, ${totalAnalyzed} analyzed, ${totalApproved} trades approved`,
      detail: totalRequested > totalApproved
        ? `${totalRequested - totalApproved} candidate(s) rejected by risk manager`
        : undefined,
    });

    // Master agent rejections
    const master = pipelineLog.master_agent ?? {};
    const rejections = master.rejections ?? [];
    if (rejections.length > 0) {
      items.push({
        id: "pipeline-rejections",
        time: ts,
        type: "pipeline",
        severity: "info",
        title: `Risk manager rejected ${rejections.length} trade(s)`,
        detail: rejections.slice(0, 3).map((r: any) => `${r.symbol}: ${r.reason}`).join(" | "),
      });
    }

    // Individual trade executions
    for (const order of ordersPlaced) {
      const orderTs = order.timestamp ? new Date(order.timestamp) : ts;
      items.push({
        id: `trade-open-${order.symbol}-${order.order_id ?? order.orderId ?? ""}`,
        time: orderTs,
        type: "trade",
        severity: "info",
        title: `${order.side === "buy" ? "Bought" : "Sold"} ${order.qty} ${order.symbol} @ $${Number(order.price).toFixed(2)}`,
        detail: order.strategy ? `via ${order.strategy}` : undefined,
      });
    }

    // Closed positions
    for (const order of ordersClosed) {
      const orderTs = order.timestamp ? new Date(order.timestamp) : ts;
      const pnl = order.pnl ?? null;
      items.push({
        id: `trade-close-${order.symbol}-${order.order_id ?? order.orderId ?? ""}`,
        time: orderTs,
        type: "trade",
        severity: pnl !== null ? (pnl >= 0 ? "success" : "danger") : "info",
        title: `Closed ${order.symbol}: ${order.side === "sell" ? "Sold" : "Covered"} ${order.qty} @ $${Number(order.price).toFixed(2)}`,
        detail: pnl !== null ? `P&L: ${pnl >= 0 ? "+" : ""}$${Number(pnl).toFixed(2)}` : undefined,
      });
    }

    // Errors
    for (let i = 0; i < errors.length; i++) {
      items.push({
        id: `error-${i}`,
        time: ts,
        type: "alert",
        severity: "danger",
        title: `Pipeline error: ${typeof errors[i] === "string" ? errors[i] : JSON.stringify(errors[i])}`,
      });
    }
  }

  // Pipeline status info
  if (pipelineStatus) {
    if (pipelineStatus.running) {
      items.push({
        id: "pipeline-running",
        time: now,
        type: "pipeline",
        severity: "info",
        title: "Pipeline is currently running...",
      });
    }
  }

  // Regime info
  if (regime) {
    items.push({
      id: "regime-current",
      time: now,
      type: "regime",
      severity: regime.label === "bear" ? "danger" : regime.label === "bull" ? "success" : "warning",
      title: `Market regime: ${regime.regime}`,
      detail: regime.description,
    });
  }

  // News headlines
  for (let i = 0; i < Math.min(news.length, 3); i++) {
    const article = news[i];
    const pubDate = article.published_at ? new Date(article.published_at) : now;
    items.push({
      id: `news-${i}`,
      time: pubDate,
      type: "news",
      severity: "info",
      title: article.title,
      detail: article.source,
    });
  }

  // Sort by time descending
  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items;
}

// ─── Feed Item Component ─────────────────────────────────────

const FEED_ICONS: Record<FeedItem["type"], typeof Activity> = {
  pipeline: RefreshCw,
  trade: TrendingUp,
  position: BarChart3,
  news: Newspaper,
  regime: Radio,
  alert: AlertTriangle,
};

const SEVERITY_COLORS: Record<FeedItem["severity"], string> = {
  success: "text-[var(--profit)]",
  danger: "text-[var(--loss)]",
  info: "text-blue-400",
  warning: "text-amber-400",
};

const SEVERITY_BORDER: Record<FeedItem["severity"], string> = {
  success: "border-l-emerald-500/40",
  danger: "border-l-red-500/60",
  info: "border-l-blue-500/30",
  warning: "border-l-amber-500/50",
};

function FeedItemRow({ item }: { item: FeedItem }) {
  const Icon = FEED_ICONS[item.type];
  const isHighlight = item.severity === "danger" || item.severity === "warning";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-l-2 px-3 py-2.5 transition-colors",
        SEVERITY_BORDER[item.severity],
        isHighlight ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]/50"
      )}
    >
      <div className={cn("mt-0.5 shrink-0", SEVERITY_COLORS[item.severity])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-foreground">{item.title}</p>
        {item.detail && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(item.time)}
      </span>
    </div>
  );
}

// ─── Strategy Card Component ─────────────────────────────────

function StrategyCard({
  strategy,
  regimeLabel,
  onClick,
}: {
  strategy: StrategyData;
  regimeLabel: string;
  onClick: () => void;
}) {
  const meta = STRATEGY_META[strategy.id];
  const Icon = meta?.icon ?? Activity;
  const regimeNote = meta?.regimeNote ?? "";

  return (
    <Card
      className="cursor-pointer border-border bg-[var(--surface)] transition-all hover:border-border/80 hover:bg-[var(--surface)]/80"
      onClick={onClick}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-md bg-[var(--panel)] p-1.5">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {strategy.shortName}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-xs",
              strategy.status === "active"
                ? "border-emerald-500/30 text-emerald-400"
                : "border-amber-500/30 text-amber-400"
            )}
          >
            {strategy.status === "active" ? "Active" : "Paused"}
          </Badge>
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  strategy.returnPct >= 0
                    ? "text-[var(--profit)]"
                    : "text-[var(--loss)]"
                )}
              >
                {strategy.returnPct >= 0 ? "+" : ""}
                {strategy.returnPct.toFixed(2)}%
              </span>
              <span className="text-xs text-muted-foreground">
                {strategy.positions} pos
              </span>
            </div>
            {strategy.winRate > 0 && (
              <p className="text-xs text-muted-foreground">
                {(strategy.winRate * 100).toFixed(0)}% win rate
              </p>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>

        {regimeNote && (
          <p className="mt-2 text-xs italic text-muted-foreground">
            {regimeNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sector Heatmap ──────────────────────────────────────────

function SectorHeatmap({ sectors }: { sectors: SectorData[] }) {
  if (sectors.length === 0) return null;

  const abbrev: Record<string, string> = {
    Technology: "Technology",
    Healthcare: "Healthcare",
    Financials: "Financials",
    "Consumer Discretionary": "Cons. Discr.",
    "Communication Services": "Comm. Svcs",
    Industrials: "Industrials",
    "Consumer Staples": "Cons. Staples",
    Energy: "Energy",
    Utilities: "Utilities",
    "Real Estate": "Real Estate",
    Materials: "Materials",
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {sectors.map((s) => {
        const val = s.change_pct;
        const bg =
          val > 1
            ? "bg-emerald-600/70"
            : val > 0.3
              ? "bg-emerald-600/40"
              : val > 0
                ? "bg-emerald-600/20"
                : val > -0.3
                  ? "bg-red-600/20"
                  : val > -1
                    ? "bg-red-600/40"
                    : "bg-red-600/70";
        const text = val >= 0 ? "text-emerald-300" : "text-red-300";

        return (
          <div
            key={s.sector}
            className={cn(
              "rounded px-2 py-1 text-center",
              bg
            )}
          >
            <p className="text-xs font-medium text-foreground/80">
              {abbrev[s.sector] ?? s.sector}
            </p>
            <p className={cn("text-xs tabular-nums font-semibold", text)}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(1)}%
            </p>
          </div>
        );
      })}
    </div>
  );
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
  const [sectors, setSectors] = useState<SectorData[]>([]);
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
          const apiMatch = apiStrategies.find((s) => s.id === id);
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
            status: "active",
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
          .filter((idx) => names[idx.symbol])
          .map((idx) => ({
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
          (entry) => entry.date === today
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

  // Non-VIX indices for display
  const displayIndices = indices.filter((i) => i.symbol !== "VIX");

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
        {/* ─── Section 1: Command Bar ───────────────────────── */}
        <div className="rounded-xl border border-border bg-[var(--surface)] px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* Portfolio Equity */}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
                Portfolio
              </p>
              <p className="text-4xl font-bold text-foreground tabular-nums leading-none tracking-tight">
                {formatCurrency(portfolioValue)}
              </p>
            </div>

            <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

            {/* Day P&L */}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
                Day P&L
              </p>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums leading-none",
                  dayPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                )}
              >
                {dayPnl >= 0 ? "+" : ""}
                {formatCurrency(dayPnl)}{" "}
                <span className="text-sm font-normal">
                  ({dayPnlPct >= 0 ? "+" : ""}
                  {dayPnlPct.toFixed(2)}%)
                </span>
              </p>
            </div>

            <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

            {/* Market Regime Badge */}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                Regime
              </p>
              <Badge
                variant="outline"
                className={cn("text-sm font-medium px-3 py-0.5", regimeBadgeColor)}
              >
                {regime?.regime ?? "Unknown"}
              </Badge>
            </div>

            <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

            {/* VIX */}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
                VIX
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-semibold tabular-nums text-foreground leading-none">
                  {vixLevel.toFixed(1)}
                </span>
                {vixData && (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      vixData.changePct <= 0
                        ? "text-[var(--profit)]"
                        : "text-[var(--loss)]"
                    )}
                  >
                    {vixData.changePct <= 0 ? "\u2193" : "\u2191"}
                    {Math.abs(vixData.changePct).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            <Separator orientation="vertical" className="hidden h-12 bg-border sm:block" />

            {/* Pipeline Status */}
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground leading-none mb-1">
                Pipeline
              </p>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground truncate">
                  {pipelineSummaryText}
                </span>
              </div>
            </div>

            {/* WebSocket Indicator */}
            <div className="flex items-center gap-1.5 shrink-0">
              {wsConnected ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs text-emerald-400">Live</span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-xs text-red-400">Offline</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ─── Sections 2 & 3: Activity Feed + Strategy Grid ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Activity Feed (left ~60%) */}
          <div className="lg:col-span-3">
            <div className="rounded-xl border border-border bg-[var(--panel)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Activity Feed
                  </h2>
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Today
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {feedItems.length} event{feedItems.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ScrollArea className="h-[500px]">
                <div className="space-y-1 p-3">
                  {feedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Info className="h-8 w-8 mb-2 opacity-40" />
                      <p className="text-sm">No activity yet today</p>
                      <p className="text-xs mt-1">Events will appear as the pipeline runs</p>
                    </div>
                  ) : (
                    feedItems.map((item) => (
                      <FeedItemRow key={item.id} item={item} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Strategy Grid (right ~40%) */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-[var(--panel)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Strategies
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {strategies.filter((s) => s.status === "active").length} active
                </span>
              </div>
              <ScrollArea className="h-[500px]">
                <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {strategies.map((strategy) => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      regimeLabel={regime?.label ?? "unknown"}
                      onClick={() => router.push(`/strategies/${strategy.id}`)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        {/* ─── Section 4: Market Context ────────────────────── */}
        <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Indices */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Market Indices
              </h3>
              <div className="space-y-2.5">
                {(displayIndices.length > 0 ? displayIndices : indices).map((idx) => {
                  const positive = idx.changePct >= 0;
                  const color = positive ? "#22c55e" : "#ef4444";
                  return (
                    <div
                      key={idx.symbol}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {idx.symbol}
                        </p>
                        <p className="text-xs text-muted-foreground">{idx.name}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Sparkline
                          data={sparkData[idx.symbol] ?? []}
                          color={color}
                          width={64}
                          height={20}
                        />
                        <div className="text-right min-w-[90px]">
                          <p className="text-sm font-medium tabular-nums text-foreground">
                            {idx.price > 0
                              ? idx.symbol === "VIX"
                                ? idx.price.toFixed(2)
                                : formatCurrency(idx.price)
                              : "\u2014"}
                          </p>
                          <p
                            className={cn(
                              "text-xs tabular-nums",
                              positive
                                ? "text-[var(--profit)]"
                                : "text-[var(--loss)]"
                            )}
                          >
                            {positive ? "+" : ""}
                            {idx.changePct.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sector Heatmap */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sector Performance
              </h3>
              {sectors.length > 0 ? (
                <SectorHeatmap sectors={sectors} />
              ) : (
                <p className="text-xs text-muted-foreground">No sector data</p>
              )}
            </div>

            {/* Headlines */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Headlines
              </h3>
              <div className="space-y-2.5">
                {news.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No headlines available</p>
                ) : (
                  news.slice(0, 3).map((article, i) => (
                    <a
                      key={i}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 rounded-md p-1.5 -mx-1.5 transition-colors hover:bg-[var(--panel)]"
                    >
                      <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-foreground group-hover:text-blue-400 transition-colors line-clamp-2">
                          {article.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {article.source}
                          {article.published_at && ` \u2022 ${formatTimeShort(article.published_at)}`}
                        </p>
                      </div>
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
