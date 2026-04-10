"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Search,
  BarChart3,
  ArrowRight,
  Briefcase,
  Target,
  Crosshair,
  Brain,
  LineChart,
  Shield,
  Pause,
  Play,
  CalendarDays,
  Newspaper,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { usePortfolioStore } from "@/stores/portfolio";
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";
import { getPortfolioSummary, getMarketNews, getQuote } from "@/lib/api";
import { env } from "@/env";
import { PnlCalendar } from "@/components/panels/PnlCalendar";

// ─── Mini Sparkline SVG ────────────────────────────────────

function Sparkline({
  data,
  color,
  width = 120,
  height = 32,
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

  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={areaPoints}
        fill={`url(#grad-${color.replace("#", "")})`}
      />
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

// ─── Generate deterministic sparkline data ─────────────────

function generateSparkData(seed: number, count = 30): number[] {
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

// ─── Strategy definitions ──────────────────────────────────

interface Strategy {
  id: string;
  name: string;
  shortName: string;
  description: string;
  status: "active" | "paused";
  invested: number;
  currentValue: number;
  returnPct: number;
  returnAnn: number;
  positions: number;
  winRate: number;
  icon: typeof Activity;
  sparkSeed: number;
}

const DEFAULT_STRATEGIES: Strategy[] = [
  {
    id: "momentum-quality",
    name: "Cross-Sectional Momentum + Quality",
    shortName: "Momentum + Quality",
    description: "Long top-decile RS stocks with F-Score >= 7, rebalance monthly",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: TrendingUp,
    sparkSeed: 42,
  },
  {
    id: "pead",
    name: "Post-Earnings Announcement Drift (PEAD)",
    shortName: "PEAD",
    description: "Capture 60-day drift after earnings surprises via bull call spreads",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Target,
    sparkSeed: 137,
  },
  {
    id: "vrp-harvesting",
    name: "Systematic VRP Harvesting",
    shortName: "VRP Harvesting",
    description: "Short delta-neutral strangles on high-IV-rank names, managed at 50% profit",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Shield,
    sparkSeed: 256,
  },
  {
    id: "earnings-vol-premium",
    name: "Earnings Volatility Premium",
    shortName: "Earnings Vol",
    description: "Sell pre-earnings straddles, buy post-earnings dips in IV crush",
    status: "paused",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: BarChart3,
    sparkSeed: 789,
  },
  {
    id: "regime-adaptive",
    name: "HMM Regime-Adaptive Allocation",
    shortName: "Regime Adaptive",
    description: "ML regime detection adjusts equity/bond/vol allocation in real-time",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Brain,
    sparkSeed: 512,
  },
  {
    id: "claude-alpha",
    name: "Claude Alpha",
    shortName: "Claude Alpha",
    description: "AI-driven stock picking powered by Claude, combining technical and fundamental analysis",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Zap,
    sparkSeed: 314,
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    shortName: "Mean Reversion",
    description: "Buy oversold quality stocks with strong fundamentals and sell on reversion to mean",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Activity,
    sparkSeed: 628,
  },
  {
    id: "vcp-breakout",
    name: "VCP Breakout",
    shortName: "VCP Breakout",
    description: "Volatility Contraction Pattern — enters Stage 2 uptrend stocks forming tight bases. 3% stop, 10% target.",
    status: "active",
    invested: 0,
    currentValue: 0,
    returnPct: 0,
    returnAnn: 0,
    positions: 0,
    winRate: 0,
    icon: Crosshair,
    sparkSeed: 888,
  },
];

// ─── Market data (demo) ────────────────────────────────────

const DEFAULT_MARKET_INDICES = [
  { symbol: "SPY", name: "S&P 500", price: 0, change: 0, changePct: 0 },
  { symbol: "QQQ", name: "NASDAQ 100", price: 0, change: 0, changePct: 0 },
  { symbol: "IWM", name: "Russell 2000", price: 0, change: 0, changePct: 0 },
  { symbol: "VIX", name: "VIX", price: 0, change: 0, changePct: 0 },
];

const SECTORS = [
  { name: "Tech", change: 1.8 },
  { name: "Health", change: 0.4 },
  { name: "Finance", change: -0.3 },
  { name: "Energy", change: 2.1 },
  { name: "Cons Disc", change: -0.8 },
  { name: "Industrials", change: 0.6 },
  { name: "Materials", change: 1.2 },
  { name: "Utilities", change: -0.1 },
  { name: "Real Estate", change: -1.4 },
  { name: "Comm Svc", change: 0.9 },
  { name: "Cons Stpls", change: 0.2 },
];

// ─── Demo news headlines ───────────────────────────────────

const DEMO_NEWS = (() => {
  const today = new Date().toISOString().slice(0, 10);
  return [
    { title: "Fed signals potential rate cut amid cooling inflation data", source: "Reuters", published_at: `${today}T14:30:00Z`, url: "#" },
    { title: "NVIDIA surges 5% on record AI chip demand forecast", source: "Bloomberg", published_at: `${today}T13:15:00Z`, url: "#" },
    { title: "Oil prices drop as OPEC+ considers output increase", source: "CNBC", published_at: `${today}T12:00:00Z`, url: "#" },
    { title: "Treasury yields fall to 3-month low on weak jobs report", source: "WSJ", published_at: `${today}T10:45:00Z`, url: "#" },
  ];
})();

// ─── Return display mode ───────────────────────────────────

type ReturnMode = "dollar" | "percent" | "annualized";

// ─── Wrapper — prevents SSR to avoid hydration mismatch ───

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading dashboard...</div>
      </div>
    );
  }
  return <DashboardContent />;
}

function DashboardContent() {
  const router = useRouter();
  const [returnMode, setReturnMode] = useState<ReturnMode>("percent");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [strategies, setStrategies] = useState<Strategy[]>(DEFAULT_STRATEGIES);
  const summary = usePortfolioStore((s) => s.summary);
  const setSummary = usePortfolioStore((s) => s.setSummary);
  const { setCommandPaletteOpen } = useUIStore();

  // News state
  const [news, setNews] = useState(DEMO_NEWS);
  // Market indices state
  const [marketIndices, setMarketIndices] = useState(DEFAULT_MARKET_INDICES);

  // Fetch real portfolio summary from API on mount
  useEffect(() => {
    getPortfolioSummary()
      .then((data) => setSummary(data))
      .catch(() => {
        // Keep default/fallback values
      });
  }, [setSummary]);

  // Fetch real strategy data from API on mount
  useEffect(() => {
    fetch(`${env.API_URL}/api/v1/strategies/`)
      .then((res) => res.json())
      .then((data: Array<{ id: string; name: string; status: string; invested_amount: number; total_return_pct: number; win_rate: number; active_positions_count: number }>) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setStrategies((prev) =>
          prev.map((s) => {
            const match = data.find((d) => d.id === s.id);
            if (!match) return s;
            const invested = match.invested_amount ?? 0;
            const returnPct = match.total_return_pct ?? 0;
            const currentValue = invested > 0 ? Math.round(invested * (1 + returnPct / 100)) : 0;
            return {
              ...s,
              invested,
              currentValue,
              returnPct,
              returnAnn: returnPct * 2, // approximate annualized
              positions: match.active_positions_count ?? 0,
              winRate: match.win_rate ?? 0,
              status: match.status === "active" ? "active" : "paused",
            };
          })
        );
      })
      .catch(() => {
        // Keep defaults (zeros)
      });
  }, []);

  // Fetch news on mount
  useEffect(() => {
    getMarketNews()
      .then((articles) => {
        if (articles && articles.length > 0) setNews(articles.slice(0, 4));
      })
      .catch(() => {
        // Keep demo news
      });
  }, []);

  // Fetch real market index prices with change data on mount
  useEffect(() => {
    fetch(`${env.API_URL}/api/v1/market-overview/indices`)
      .then((res) => res.json())
      .then((data) => {
        const names: Record<string, string> = { SPY: "S&P 500", QQQ: "NASDAQ 100", IWM: "Russell 2000" };
        const indices = (data.indices || [])
          .filter((idx: Record<string, unknown>) => names[idx.symbol as string])
          .map((idx: Record<string, unknown>) => ({
            symbol: idx.symbol as string,
            name: names[idx.symbol as string] || (idx.name as string),
            price: idx.price as number,
            change: (idx.change as number) ?? 0,
            changePct: (idx.change_pct as number) ?? 0,
          }));
        if (indices.length > 0) setMarketIndices(indices);
      })
      .catch(() => {
        // Fallback: try to populate from quotes store
        const { quotes } = useMarketStore.getState();
        const names: Record<string, string> = { SPY: "S&P 500", QQQ: "NASDAQ 100", IWM: "Russell 2000" };
        const fromQuotes = DEFAULT_MARKET_INDICES.map((idx) => {
          const q = quotes.get(idx.symbol);
          if (q && q.last > 0) {
            return { ...idx, name: names[idx.symbol] ?? idx.name, price: q.last, change: q.change ?? 0, changePct: q.changePct ?? 0 };
          }
          return idx;
        });
        setMarketIndices(fromQuotes);
      });
  }, []);

  // Portfolio values from REAL Alpaca data
  const portfolioValue = Number.isFinite(summary.equity) && summary.equity > 0 ? summary.equity : 0;
  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;

  // Total return = equity - starting capital ($100,000)
  const STARTING_CAPITAL = 100_000;
  const totalReturn = portfolioValue > 0 ? portfolioValue - STARTING_CAPITAL : 0;
  const totalReturnPct = portfolioValue > 0 ? (totalReturn / STARTING_CAPITAL) * 100 : 0;
  // Strategy-level totals (for reference only)
  const totalInvested = strategies.reduce((s, st) => s + st.invested, 0);
  const totalCurrentValue = strategies.reduce((s, st) => s + st.currentValue, 0);

  // Portfolio equity sparkline (demo)
  const equityData = useMemo(() => generateSparkData(999, 30), []);

  const isMarketOpen = (() => {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    return day >= 1 && day <= 5 && hour >= 13 && hour < 20;
  })();

  function getReturnDisplay(strategy: Strategy): string {
    switch (returnMode) {
      case "dollar":
        return `${strategy.currentValue - strategy.invested >= 0 ? "+" : ""}${formatCurrency(strategy.currentValue - strategy.invested)}`;
      case "percent":
        return `${strategy.returnPct >= 0 ? "+" : ""}${strategy.returnPct.toFixed(2)}%`;
      case "annualized":
        return `${strategy.returnAnn >= 0 ? "+" : ""}${strategy.returnAnn.toFixed(1)}% ann.`;
    }
  }

  function getTotalReturnDisplay(): string {
    switch (returnMode) {
      case "dollar":
        return `${totalReturn >= 0 ? "+" : ""}${formatCurrency(totalReturn)}`;
      case "percent":
        return `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}%`;
      case "annualized":
        return `${totalReturnPct >= 0 ? "+" : ""}${(totalReturnPct * 2).toFixed(1)}% ann.`;
    }
  }

  function formatTimeAgo(dateStr: string): string {
    const now = new Date();
    const then = new Date(dateStr);
    if (isNaN(then.getTime())) return "";
    const diffMs = now.getTime() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 0) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[1800px] space-y-4 p-6">
        {/* ─── Portfolio Summary Bar ────────────────────────── */}
        <div className="rounded-xl border border-border bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-end gap-8">
              {/* Total Value */}
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                  Portfolio Value
                </p>
                <p className="text-3xl font-bold text-foreground tabular-nums leading-none">
                  {formatCurrency(portfolioValue)}
                </p>
              </div>

              <Separator orientation="vertical" className="h-10 bg-border" />

              {/* Today P&L + Mini Calendar Icon */}
              <div className="flex items-end gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                    Today&apos;s P&amp;L
                  </p>
                  <p
                    className={cn(
                      "text-xl font-semibold tabular-nums leading-none",
                      dayPnl >= 0
                        ? "text-[var(--profit)]"
                        : "text-[var(--loss)]"
                    )}
                  >
                    {dayPnl >= 0 ? "+" : ""}{formatCurrency(dayPnl)} ({dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%)
                  </p>
                </div>

                {/* Mini Calendar Button */}
                <TooltipProvider delay={300}>
                  <Tooltip>
                    <TooltipTrigger
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-accent/50 hover:border-primary/40 transition-all cursor-pointer mb-0.5"
                      onClick={() => setCalendarOpen(true)}
                    >
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">View P&amp;L Calendar</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <Separator orientation="vertical" className="h-10 bg-border hidden md:block" />

              {/* Active Positions */}
              <div className="hidden md:block">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                  Positions
                </p>
                <p className="text-xl font-semibold tabular-nums leading-none text-foreground">
                  {strategies.reduce((s, st) => s + st.positions, 0)}
                </p>
              </div>

              <Separator orientation="vertical" className="h-10 bg-border hidden md:block" />

              {/* Equity Sparkline */}
              <div className="hidden md:block">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                  30-Day Equity
                </p>
                <Sparkline
                  data={equityData}
                  color={totalReturn >= 0 ? "var(--profit)" : "var(--loss)"}
                  width={160}
                  height={40}
                />
              </div>

              <Separator orientation="vertical" className="h-10 bg-border hidden lg:block" />

              {/* Total Return */}
              <div className="hidden lg:block">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none mb-1.5">
                  Total Return
                </p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums leading-none",
                    totalReturn >= 0
                      ? "text-[var(--profit)]"
                      : "text-[var(--loss)]"
                  )}
                >
                  {getTotalReturnDisplay()}
                </p>
              </div>
            </div>

            {/* Return Mode Toggle */}
            <div className="flex rounded-lg border border-border bg-background p-1 shrink-0 shadow-sm">
              {(
                [
                  { key: "dollar", label: "$" },
                  { key: "percent", label: "%" },
                  { key: "annualized", label: "Ann." },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setReturnMode(mode.key)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all",
                    returnMode === mode.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── P&L Calendar Dialog ─────────────────────────── */}
        <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-[#0a0a0f] border-border">
            <DialogHeader>
              <DialogTitle>P&amp;L Calendar</DialogTitle>
            </DialogHeader>
            <PnlCalendar />
          </DialogContent>
        </Dialog>

        {/* ─── Strategy Cards + Market Sidebar ─────────────── */}
        <div className="flex gap-4">
          {/* Left: Strategy Cards (grows to fill) */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Active Strategies
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {strategies.filter((s) => s.status === "active").length} active /{" "}
                {strategies.length} total
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {strategies.map((strategy) => {
                const Icon = strategy.icon;
                const sparkData = generateSparkData(strategy.sparkSeed, 30);
                const returnVal = strategy.currentValue - strategy.invested;
                const isPositive = returnVal >= 0;
                const hasData = strategy.invested > 0 || strategy.positions > 0 || strategy.returnPct !== 0;
                const borderColor = strategy.returnPct > 0
                  ? "var(--profit)"
                  : strategy.returnPct < 0
                  ? "var(--loss)"
                  : "var(--border)";

                return (
                  <Card
                    key={strategy.id}
                    className="group border-border bg-[var(--surface)] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:scale-[1.01] transition-all duration-200 cursor-pointer overflow-hidden"
                    style={{ borderLeft: `3px solid ${borderColor}` }}
                    onClick={() => router.push("/trade")}
                  >
                    <CardContent className="p-5">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                            <Icon className="h-4.5 w-4.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-foreground leading-tight">
                              {strategy.shortName}
                            </h3>
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                              {strategy.description}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-2 py-0.5 shrink-0 ml-2",
                            strategy.status === "active"
                              ? "border-[var(--profit)]/30 text-[var(--profit)]"
                              : "border-[var(--chart-4)]/30 text-[var(--chart-4)]"
                          )}
                        >
                          {strategy.status === "active" ? (
                            <Play className="h-2.5 w-2.5 mr-0.5" />
                          ) : (
                            <Pause className="h-2.5 w-2.5 mr-0.5" />
                          )}
                          {strategy.status}
                        </Badge>
                      </div>

                      {/* Return Value (large + prominent) */}
                      <div className="mb-3">
                        {hasData ? (
                          <>
                            <p
                              className={cn(
                                "text-2xl font-bold tabular-nums leading-none",
                                isPositive
                                  ? "text-[var(--profit)]"
                                  : "text-[var(--loss)]"
                              )}
                            >
                              {getReturnDisplay(strategy)}
                            </p>
                            <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
                              {formatCurrency(strategy.currentValue)} current value
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground/60 italic leading-none">
                            No trades yet
                          </p>
                        )}
                      </div>

                      {/* Sparkline (larger) */}
                      <div className="mb-3">
                        <Sparkline
                          data={sparkData}
                          color={hasData ? (isPositive ? "var(--profit)" : "var(--loss)") : "var(--muted-foreground)"}
                          width={260}
                          height={48}
                        />
                      </div>

                      <Separator className="bg-border mb-3" />

                      {/* Stats Row */}
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="text-center">
                          <p className="text-[11px] text-muted-foreground">Invested</p>
                          <p className="text-foreground font-semibold tabular-nums">
                            {hasData ? formatCurrency(strategy.invested, true) : "—"}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] text-muted-foreground">Positions</p>
                          <p className="text-foreground font-semibold tabular-nums">
                            {hasData ? strategy.positions : "—"}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] text-muted-foreground">Win Rate</p>
                          <p
                            className={cn(
                              "font-semibold tabular-nums",
                              !hasData || strategy.winRate < 0
                                ? "text-muted-foreground"
                                : strategy.winRate >= 65
                                ? "text-[var(--profit)]"
                                : strategy.winRate >= 50
                                ? "text-[var(--chart-4)]"
                                : "text-[var(--loss)]"
                            )}
                          >
                            {!hasData || strategy.winRate < 0 ? "—" : `${strategy.winRate}%`}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Right: Market Sidebar (visible on wide screens) */}
          <div className="hidden xl:flex flex-col gap-4 w-[320px] shrink-0">
            {/* Market Overview Card */}
            <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Market Overview
                </h3>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-2 py-0.5",
                    isMarketOpen
                      ? "border-[var(--profit)]/30 text-[var(--profit)]"
                      : "border-[var(--neutral)]/30 text-[var(--neutral)]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full mr-1",
                      isMarketOpen ? "bg-[var(--profit)]" : "bg-[var(--neutral)]"
                    )}
                  />
                  {isMarketOpen ? "Open" : "Closed"}
                </Badge>
              </div>

              <div className="space-y-0.5">
                {marketIndices.map((idx) => (
                  <div
                    key={idx.symbol}
                    className="flex items-center justify-between rounded-md px-2.5 py-2 text-xs hover:bg-accent/30 transition-colors cursor-pointer"
                    onClick={() => router.push("/trade")}
                  >
                    <div>
                      <span className="font-semibold text-foreground">
                        {idx.symbol}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-foreground tabular-nums font-medium">
                        {idx.symbol === "VIX"
                          ? idx.price.toFixed(2)
                          : formatCurrency(idx.price)}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums text-right font-semibold",
                          idx.change >= 0
                            ? "text-[var(--profit)]"
                            : "text-[var(--loss)]"
                        )}
                      >
                        {idx.changePct >= 0 ? "+" : ""}
                        {idx.changePct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Regime Badge */}
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Regime</span>
                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-[var(--profit)]/30 text-[var(--profit)]">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Risk-On
                  </Badge>
                </div>
              </div>
            </div>

            {/* Sector Mini-Heatmap Card */}
            <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
                Sectors
              </h3>
              <div className="grid grid-cols-3 gap-1.5">
                {SECTORS.map((sector) => {
                  const intensity = Math.min(Math.abs(sector.change) / 2.5, 1);
                  const bgColor =
                    sector.change >= 0
                      ? `rgba(34, 197, 94, ${0.08 + intensity * 0.25})`
                      : `rgba(239, 68, 68, ${0.08 + intensity * 0.25})`;
                  const textColor =
                    sector.change >= 0 ? "var(--profit)" : "var(--loss)";

                  return (
                    <div
                      key={sector.name}
                      className="rounded-md p-1.5 text-center transition-colors hover:ring-1 hover:ring-primary/30 cursor-pointer"
                      style={{ backgroundColor: bgColor }}
                    >
                      <p className="text-[10px] text-muted-foreground truncate leading-tight">
                        {sector.name}
                      </p>
                      <p
                        className="text-xs font-semibold tabular-nums leading-tight"
                        style={{ color: textColor }}
                      >
                        {sector.change >= 0 ? "+" : ""}
                        {sector.change.toFixed(1)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Stats Card */}
            <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
                Quick Stats
              </h3>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">Active Positions</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {strategies.reduce((s, st) => s + st.positions, 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">Invested Capital</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(totalInvested, true)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">Avg Win Rate</span>
                  {(() => {
                    const withData = strategies.filter((st) => st.winRate >= 0);
                    const avgWr = withData.length > 0 ? withData.reduce((s, st) => s + st.winRate, 0) / withData.length : -1;
                    return (
                      <span className={cn(
                        "text-sm font-semibold tabular-nums",
                        avgWr < 0 ? "text-muted-foreground" : avgWr >= 55 ? "text-[var(--profit)]" : avgWr > 0 ? "text-[var(--chart-4)]" : "text-muted-foreground"
                      )}>
                        {avgWr < 0 ? "N/A" : `${avgWr.toFixed(1)}%`}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">Total P&amp;L</span>
                  <span className={cn(
                    "text-sm font-semibold tabular-nums",
                    totalReturn >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                  )}>
                    {totalReturn >= 0 ? "+" : ""}{formatCurrency(totalReturn, true)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Quick Actions Strip ─────────────────────────── */}
        <div className="flex gap-2">
          {[
            {
              label: "Screen Stocks",
              icon: Search,
              onClick: () => router.push("/trade"),
            },
            {
              label: "Analyze Symbol",
              icon: Brain,
              onClick: () => setCommandPaletteOpen(true),
            },
            {
              label: "Options Chain",
              icon: LineChart,
              onClick: () => router.push("/trade"),
            },
            {
              label: "View Portfolio",
              icon: Briefcase,
              onClick: () => router.push("/trade"),
            },
          ].map((action) => {
            const ActionIcon = action.icon;
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-[var(--surface)] px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground hover:bg-[var(--surface)]/80 group"
              >
                <ActionIcon className="h-3.5 w-3.5 text-primary group-hover:text-primary" />
                {action.label}
              </button>
            );
          })}
        </div>

        {/* ─── News Headlines + Sector Heatmap (bottom) ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* News Headlines */}
          <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Newspaper className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Latest News
              </h3>
            </div>
            <div className="space-y-2">
              {news.map((article, i) => (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-accent/30 transition-colors group cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground font-medium">{article.source}</span>
                      <span className="text-[10px] text-muted-foreground/60">{formatTimeAgo(article.published_at)}</span>
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-primary/60 transition-colors" />
                </a>
              ))}
            </div>
          </div>

          {/* Sector Heatmap (visible below xl, since sidebar has it on xl+) */}
          <div className="rounded-xl border border-border bg-[var(--surface)] p-4 xl:block">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
              Sector Performance
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              {SECTORS.map((sector) => {
                const intensity = Math.min(Math.abs(sector.change) / 2.5, 1);
                const bgColor =
                  sector.change >= 0
                    ? `rgba(34, 197, 94, ${0.08 + intensity * 0.25})`
                    : `rgba(239, 68, 68, ${0.08 + intensity * 0.25})`;
                const textColor =
                  sector.change >= 0 ? "var(--profit)" : "var(--loss)";

                return (
                  <div
                    key={sector.name}
                    className="rounded-md p-2 text-center transition-colors hover:ring-1 hover:ring-primary/30 cursor-pointer"
                    style={{ backgroundColor: bgColor }}
                  >
                    <p className="text-[10px] text-muted-foreground truncate">
                      {sector.name}
                    </p>
                    <p
                      className="text-xs font-semibold tabular-nums"
                      style={{ color: textColor }}
                    >
                      {sector.change >= 0 ? "+" : ""}
                      {sector.change.toFixed(1)}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Go to Trading View CTA ───────────────────────── */}
        <div className="flex justify-center pb-2">
          <Button
            variant="outline"
            className="gap-2 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => router.push("/trade")}
          >
            <Zap className="h-3.5 w-3.5" />
            Open Trading Terminal
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
