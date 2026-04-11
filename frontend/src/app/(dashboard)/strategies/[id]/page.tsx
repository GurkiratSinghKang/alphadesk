"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Activity,
  Pause,
  Play,
  ChevronDown,
  ChevronRight,
  PieChart,
  BookOpen,
  Briefcase,
  GitBranch,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, cn } from "@/lib/utils";
import {
  getStrategyPerformance,
  getStrategyTrades,
  getStrategyAnalytics,
  toggleStrategy,
  getBars,
  type StrategyPerformance,
  type StrategyTrade,
  type StrategyAnalytics,
} from "@/lib/api";
import { STRATEGY_CONTENT } from "@/lib/strategy-content";
import { STRATEGY_META } from "@/lib/strategies";

// ─── Time period filter ──────────────────────────────────────

type TimePeriod = "1M" | "3M" | "6M" | "YTD" | "ALL";

function filterEquityCurve(curve: { date: string; value: number }[], period: TimePeriod) {
  if (period === "ALL" || curve.length === 0) return curve;
  const now = new Date();
  const cutoff = new Date();
  switch (period) {
    case "1M": cutoff.setMonth(now.getMonth() - 1); break;
    case "3M": cutoff.setMonth(now.getMonth() - 3); break;
    case "6M": cutoff.setMonth(now.getMonth() - 6); break;
    case "YTD": cutoff.setMonth(0); cutoff.setDate(1); break;
  }
  return curve.filter((p) => new Date(p.date) >= cutoff);
}

// ─── Equity Curve SVG Chart ──────────────────────────────────

function EquityCurve({
  data,
  benchmark = [],
  height = 400,
}: {
  data: { date: string; value: number }[];
  benchmark?: { date: string; value: number }[];
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-[var(--panel)]" style={{ height }}>
        <p className="text-sm text-muted-foreground">Not enough data for equity curve</p>
      </div>
    );
  }

  const w = 1000;
  const h = height - 40;
  const padding = 20;

  const hasBenchmark = benchmark.length >= 2;

  // When benchmark present, normalise both series to % returns
  const mainValues = hasBenchmark
    ? data.map((d) => ((d.value / data[0].value) - 1) * 100)
    : data.map((d) => d.value);

  // Benchmark is already in % return format from the fetch
  const benchValues = benchmark.map((d) => d.value);

  const allValues = hasBenchmark ? [...mainValues, ...benchValues] : mainValues;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const toPoint = (values: number[], idx: number, total: number) => {
    const x = padding + (idx / (total - 1)) * (w - 2 * padding);
    const y = padding + (1 - (values[idx] - min) / range) * (h - 2 * padding);
    return `${x},${y}`;
  };

  const points = mainValues.map((_, i) => toPoint(mainValues, i, mainValues.length));
  const areaPoints = [
    ...points,
    `${padding + ((mainValues.length - 1) / (mainValues.length - 1)) * (w - 2 * padding)},${h - padding}`,
    `${padding},${h - padding}`,
  ];

  const isPositive = mainValues[mainValues.length - 1] >= mainValues[0];
  const color = isPositive ? "var(--profit)" : "var(--loss)";

  const benchPoints = hasBenchmark
    ? benchValues.map((_, i) => toPoint(benchValues, i, benchValues.length))
    : [];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-border bg-[var(--panel)]" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints.join(" ")} fill="url(#curveGrad)" />
      {hasBenchmark && (
        <polyline
          points={benchPoints.join(" ")}
          fill="none"
          stroke="#71717a"
          strokeWidth={1}
          strokeLinejoin="round"
          opacity={0.4}
        />
      )}
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {hasBenchmark && (
        <g>
          <circle cx={w - 80} cy={15} r={3} fill={color} />
          <text x={w - 72} y={18} fontSize={9} className="fill-foreground">Strategy</text>
          <circle cx={w - 80} cy={28} r={3} fill="#71717a" />
          <text x={w - 72} y={31} fontSize={9} className="fill-muted-foreground">SPY</text>
        </g>
      )}
    </svg>
  );
}

// ─── Metric Card ─────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const isEmpty = value === "N/A" || value === "—";
  return (
    <div className={cn("rounded-lg border border-border bg-[var(--panel)] px-4 py-3", isEmpty && "opacity-50")}>
      <p className="text-label mb-1">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", isEmpty ? "text-[#8a8a95]" : color)}>
        {isEmpty ? <span className="text-sm font-normal">No data</span> : value}
      </p>
    </div>
  );
}

// ─── Bar Chart SVG ───────────────────────────────────────────

function BarChart({ data, height = 200 }: { data: { label: string; value: number; color?: string }[]; height?: number }) {
  if (data.length === 0) return null;
  const maxVal = Math.max(...data.map((d) => Math.abs(d.value)), 0.01);
  const barWidth = Math.min(40, (900 - data.length * 4) / data.length);

  return (
    <svg viewBox={`0 0 ${data.length * (barWidth + 8) + 20} ${height}`} className="w-full" style={{ maxHeight: height }}>
      {data.map((d, i) => {
        const barH = (Math.abs(d.value) / maxVal) * (height - 50);
        const x = 10 + i * (barWidth + 8);
        const y = d.value >= 0 ? height - 30 - barH : height - 30;
        const fill = d.color || (d.value >= 0 ? "var(--profit)" : "var(--loss)");
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} rx={3} fill={fill} opacity={0.8} />
            <text x={x + barWidth / 2} y={height - 10} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{d.label}</text>
            <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" className="fill-foreground" fontSize={9}>{d.value > 0 ? "+" : ""}{d.value.toFixed(1)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Heatmap Cell ────────────────────────────────────────────

function HeatmapCell({ value, label }: { value: number; label: string }) {
  const intensity = Math.min(Math.abs(value) / 10, 1);
  const bg = value >= 0
    ? `rgba(34, 197, 94, ${intensity * 0.6})`
    : `rgba(239, 68, 68, ${intensity * 0.6})`;
  return (
    <div className="flex flex-col items-center justify-center rounded border border-border p-2" style={{ backgroundColor: bg, minWidth: 60 }}>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{value >= 0 ? "+" : ""}{value.toFixed(1)}%</span>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  const [perf, setPerf] = useState<StrategyPerformance | null>(null);
  const [trades, setTrades] = useState<StrategyTrade[]>([]);
  const [analytics, setAnalytics] = useState<StrategyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>("3M");
  const [activeTab, setActiveTab] = useState<"about" | "positions" | "sectors" | "correlation" | "analytics">("about");
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);
  const [tradeFilter, setTradeFilter] = useState<"all" | "open" | "closed">("all");
  const [toggling, setToggling] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState<{ date: string; value: number }[]>([]);
  // Strategy content is imported statically — no need for state

  const meta = STRATEGY_META[strategyId] || { name: strategyId, shortName: strategyId, icon: Activity };
  const Icon = meta.icon;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [p, t, a] = await Promise.allSettled([
      getStrategyPerformance(strategyId),
      getStrategyTrades(strategyId),
      getStrategyAnalytics(strategyId),
    ]);
    if (p.status === "fulfilled") setPerf(p.value);
    if (t.status === "fulfilled") setTrades(t.value);
    if (a.status === "fulfilled") setAnalytics(a.value);
    setLoading(false);
  }, [strategyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!perf?.equity_curve || perf.equity_curve.length < 2) return;
    getBars("SPY", "D", perf.equity_curve.length + 5).then((bars) => {
      if (bars.length > 0) {
        const firstClose = bars[0].close;
        setBenchmarkData(bars.map((b) => ({
          date: new Date(b.time * 1000).toISOString().slice(0, 10),
          value: ((b.close / firstClose) - 1) * 100,
        })));
      }
    }).catch(() => {});
  }, [perf?.equity_curve]);

  async function handleToggle() {
    if (!perf) return;
    setToggling(true);
    try {
      const res = await toggleStrategy(strategyId);
      setPerf((prev) => prev ? { ...prev, status: res.new_status } : prev);
    } catch { /* ignore */ }
    setToggling(false);
  }

  const filteredTrades = trades.filter((t) => {
    if (tradeFilter === "open") return t.status === "open" || t.status === "submitted";
    if (tradeFilter === "closed") return t.status === "closed" || t.status === "filled";
    return true;
  });

  const equityData = perf ? filterEquityCurve(perf.equity_curve, period) : [];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Activity className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const strategyContent = STRATEGY_CONTENT[strategyId] || null;

  const tabs = [
    { id: "about" as const, label: "About", icon: BookOpen },
    { id: "positions" as const, label: "Positions", icon: Briefcase },
    { id: "sectors" as const, label: "Sector Exposure", icon: PieChart },
    { id: "correlation" as const, label: "Correlation", icon: GitBranch },
    { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[1400px] space-y-6 p-6">
        {/* ─── Breadcrumb + Back ───────────────────────── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="cursor-pointer hover:text-foreground" onClick={() => router.push("/")}>Dashboard</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{meta.name}</span>
          </div>
        </div>

        {/* ─── Hero: Performance Dashboard ─────────────── */}
        <div className="space-y-4">
          {/* Title + Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{meta.name}</h1>
                {perf && <p className="text-sm text-muted-foreground">{perf.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={perf?.status === "active" ? "default" : "secondary"} className={perf?.status === "active" ? "bg-[var(--profit)]/20 text-[var(--profit)] border-[var(--profit)]/30" : ""}>
                {perf?.status === "active" ? "Active" : "Paused"}
              </Badge>
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
                {perf?.status === "active" ? <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1.5 h-3.5 w-3.5" /> Resume</>}
              </Button>
            </div>
          </div>

          {/* Time Period Selector */}
          <div className="flex gap-1">
            {(["1M", "3M", "6M", "YTD", "ALL"] as TimePeriod[]).map((p) => (
              <Button key={p} variant={period === p ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => setPeriod(p)}>
                {p}
              </Button>
            ))}
          </div>

          {/* Equity Curve */}
          <EquityCurve data={equityData} benchmark={benchmarkData} />

          {/* Metrics Row */}
          {perf && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="Total Return"
                value={`${perf.total_return_pct >= 0 ? "+" : ""}${perf.total_return_pct.toFixed(2)}% (${formatCurrency(perf.return_dollars)})`}
                color={perf.total_return_pct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"}
              />
              <MetricCard label="Sharpe Ratio" value={perf.sharpe_ratio !== 0 ? perf.sharpe_ratio.toFixed(2) : "N/A"} />
              <MetricCard label="Max Drawdown" value={perf.max_drawdown !== 0 ? `${perf.max_drawdown.toFixed(1)}%` : "N/A"} color={perf.max_drawdown !== 0 ? "text-[var(--loss)]" : undefined} />
              <MetricCard label="Win Rate" value={perf.win_rate > 0 || (perf.win_rate === 0 && perf.active_positions_count > 0) ? `${perf.win_rate.toFixed(0)}%` : "N/A"} />
              <MetricCard label="Active Positions" value={String(perf.active_positions_count)} />
              <MetricCard
                label="Calmar Ratio"
                value={Math.abs(perf.max_drawdown) >= 0.1 ? (perf.annualized_return_pct / Math.abs(perf.max_drawdown)).toFixed(2) : "N/A"}
              />
            </div>
          )}
        </div>

        <Separator />

        {/* ─── Tabs ────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex gap-0 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab: About — strategy thesis + trade history */}
          {activeTab === "about" && (
            <div className="space-y-6">
              {strategyContent ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card className="border-border bg-[var(--surface)]">
                    <CardContent className="p-5 space-y-4">
                      <h3 className="font-semibold">Strategy Thesis</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {strategyContent.thesis}
                      </p>
                      <div className="pt-2">
                        <p className="text-xs text-muted-foreground font-medium mb-1">Edge</p>
                        <p className="text-sm text-foreground">{strategyContent.edge}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-[var(--surface)]">
                    <CardContent className="p-5 space-y-4">
                      <h3 className="font-semibold">Parameters</h3>
                      <div className="space-y-2 text-sm">
                        {Object.entries(strategyContent.parameters || {}).map(([key, val]) => (
                          <div key={key} className="flex justify-between py-1 border-b border-border/50">
                            <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                            <span className="text-foreground font-medium text-right max-w-[60%]">{val as string}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-2">
                        <p className="text-xs text-muted-foreground font-medium mb-1">Risk Profile</p>
                        <Badge variant="outline">{strategyContent.riskProfile?.level}</Badge>
                        <p className="text-sm text-muted-foreground mt-1">{strategyContent.riskProfile?.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">Strategy documentation loading...</p>
                  </CardContent>
                </Card>
              )}

              {/* Trade History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Trade History</h2>
                  <div className="flex gap-1">
                    {(["all", "open", "closed"] as const).map((f) => (
                      <Button key={f} variant={tradeFilter === f ? "default" : "ghost"} size="sm" className="h-7 px-3 text-xs capitalize" onClick={() => setTradeFilter(f)}>
                        {f} {f === "all" ? `(${trades.length})` : f === "open" ? `(${trades.filter((t) => t.status === "open" || t.status === "submitted").length})` : `(${trades.filter((t) => t.status === "closed" || t.status === "filled").length})`}
                      </Button>
                    ))}
                  </div>
                </div>

                {filteredTrades.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <TrendingUp className="h-6 w-6 mb-2 opacity-30 text-muted-foreground" />
                    <p className="text-body">No trades yet</p>
                    <p className="text-hint mt-1">This strategy will enter positions when its signals trigger</p>
                    <a href="/pipeline" className="mt-2 text-[11px] text-[var(--primary)] hover:underline">
                      View Pipeline &rarr;
                    </a>
                  </div>
                ) : (
                  <Card className="border-border bg-[var(--surface)] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="px-4 py-2 text-left font-medium">Date</th>
                            <th className="px-4 py-2 text-left font-medium">Symbol</th>
                            <th className="px-4 py-2 text-left font-medium">Side</th>
                            <th className="px-4 py-2 text-right font-medium">Entry</th>
                            <th className="px-4 py-2 text-right font-medium">Exit</th>
                            <th className="px-4 py-2 text-right font-medium">P&L</th>
                            <th className="px-4 py-2 text-right font-medium">P&L %</th>
                            <th className="px-4 py-2 text-right font-medium">Hold</th>
                            <th className="px-4 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTrades.map((trade) => {
                            const isExpanded = expandedTrade === trade.id;
                            const holdDays = trade.exit_time && trade.entry_time
                              ? Math.max(1, Math.round((new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / 86400000))
                              : null;

                            return (
                              <tr key={trade.id} className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors" onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}>
                                <td className="px-4 py-2.5 tabular-nums">{new Date(trade.entry_time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                                <td className="px-4 py-2.5 font-medium">{trade.symbol}</td>
                                <td className="px-4 py-2.5">
                                  <Badge variant="outline" className={cn("text-[10px]", trade.side === "buy" ? "text-[var(--profit)] border-[var(--profit)]/30" : "text-[var(--loss)] border-[var(--loss)]/30")}>
                                    {trade.side === "buy" ? "Long" : "Short"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(trade.entry_price)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{trade.exit_price ? formatCurrency(trade.exit_price) : <span className="text-muted-foreground">Open</span>}</td>
                                <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", trade.pnl != null ? (trade.pnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]") : "")}>
                                  {trade.pnl != null ? `${trade.pnl >= 0 ? "+" : ""}${formatCurrency(trade.pnl)}` : "—"}
                                </td>
                                <td className={cn("px-4 py-2.5 text-right tabular-nums", trade.pnl_pct != null ? (trade.pnl_pct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]") : "")}>
                                  {trade.pnl_pct != null ? `${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(1)}%` : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                                  {holdDays ? `${holdDays}d` : "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {/* Expanded trade detail */}
                {expandedTrade != null && (() => {
                  const trade = trades.find((t) => t.id === expandedTrade);
                  if (!trade) return null;
                  return (
                    <Card className="border-border bg-[var(--panel)] ml-4 animate-in slide-in-from-top-2">
                      <CardContent className="p-4 space-y-2 text-xs">
                        {trade.rationale && (
                          <div>
                            <p className="text-muted-foreground font-medium mb-1">Rationale</p>
                            <p className="text-foreground leading-relaxed">{trade.rationale}</p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                          {trade.conviction != null && (
                            <div>
                              <p className="text-muted-foreground">Conviction</p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="h-1.5 flex-1 rounded-full bg-border">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${trade.conviction}%` }} />
                                </div>
                                <span className="tabular-nums font-medium">{trade.conviction}</span>
                              </div>
                            </div>
                          )}
                          {trade.stop_loss != null && <div><p className="text-muted-foreground">Stop Loss</p><p className="font-medium text-[var(--loss)]">{formatCurrency(trade.stop_loss)}</p></div>}
                          {trade.take_profit != null && <div><p className="text-muted-foreground">Take Profit</p><p className="font-medium text-[var(--profit)]">{formatCurrency(trade.take_profit)}</p></div>}
                          {trade.exit_reason && <div><p className="text-muted-foreground">Exit Reason</p><p className="font-medium capitalize">{trade.exit_reason}</p></div>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Tab: Positions */}
          {activeTab === "positions" && (() => {
            const openTrades = trades.filter((t) => t.status === "open" || t.status === "submitted");
            return openTrades.length === 0 ? (
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="py-8 text-center">
                  <Briefcase className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No open positions for this strategy.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border bg-[var(--surface)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">Symbol</th>
                        <th className="px-4 py-2 text-right font-medium">Shares</th>
                        <th className="px-4 py-2 text-right font-medium">Entry</th>
                        <th className="px-4 py-2 text-right font-medium">Stop</th>
                        <th className="px-4 py-2 text-right font-medium">Target</th>
                        <th className="px-4 py-2 text-right font-medium">Entry Date</th>
                        <th className="px-4 py-2 text-left font-medium">Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openTrades.map((t) => (
                        <tr key={t.id} className="border-b border-border/50">
                          <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{t.quantity}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(t.entry_price)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[var(--loss)]">{t.stop_loss ? formatCurrency(t.stop_loss) : "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[var(--profit)]">{t.take_profit ? formatCurrency(t.take_profit) : "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{new Date(t.entry_time).toLocaleDateString()}</td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{t.rationale || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}

          {/* Tab: Sector Exposure */}
          {activeTab === "sectors" && analytics && (
            <div className="space-y-4">
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4">Current Sector Allocation</h3>
                  {Object.keys(analytics.sector_exposure.current).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sector data available.</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(analytics.sector_exposure.current)
                        .sort(([, a], [, b]) => b - a)
                        .map(([sector, weight]) => (
                          <div key={sector} className="flex items-center gap-3">
                            <span className="text-sm w-32 shrink-0 text-muted-foreground">{sector}</span>
                            <div className="flex-1 h-5 bg-border/50 rounded">
                              <div className="h-full bg-primary/70 rounded" style={{ width: `${weight * 100}%` }} />
                            </div>
                            <span className="text-sm tabular-nums font-medium w-14 text-right">{(weight * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tab: Correlation */}
          {activeTab === "correlation" && analytics && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4">Market Correlations</h3>
                  <div className="space-y-2">
                    {Object.entries(analytics.correlations).map(([index, corr]) => (
                      <div key={index} className="flex items-center gap-3">
                        <span className="text-sm w-12 shrink-0 font-medium">{index}</span>
                        <div className="flex-1 h-4 bg-border/50 rounded relative">
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-muted-foreground/30" />
                          <div
                            className={cn("h-full rounded", corr >= 0 ? "bg-[var(--profit)]/60" : "bg-[var(--loss)]/60")}
                            style={{
                              width: `${Math.abs(corr) * 50}%`,
                              marginLeft: corr >= 0 ? "50%" : `${50 - Math.abs(corr) * 50}%`,
                            }}
                          />
                        </div>
                        <span className="text-sm tabular-nums font-medium w-12 text-right">{corr.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4">Rolling Beta to SPY</h3>
                  {analytics.rolling_beta.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Insufficient data for rolling beta calculation.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Beta chart available with more historical data.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tab: Analytics */}
          {activeTab === "analytics" && analytics && (
            <div className="space-y-4">
              {/* Monthly Returns Heatmap */}
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4">Monthly Returns</h3>
                  {analytics.monthly_returns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No monthly return data yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {analytics.monthly_returns.map((mr) => (
                        <HeatmapCell key={`${mr.year}-${mr.month}`} value={mr.return_pct} label={`${mr.year}-${String(mr.month).padStart(2, "0")}`} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Win/Loss Streaks */}
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-4">Win/Loss Streaks</h3>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-foreground">{analytics.streaks.current.count}</p>
                        <p className="text-xs text-muted-foreground">Current {analytics.streaks.current.type} streak</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[var(--profit)]">{analytics.streaks.best_win}</p>
                        <p className="text-xs text-muted-foreground">Best win streak</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[var(--loss)]">{analytics.streaks.worst_loss}</p>
                        <p className="text-xs text-muted-foreground">Worst loss streak</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Hold Time Stats */}
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-4">Hold Time Analysis</h3>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-[var(--profit)]">{analytics.hold_time_stats.avg_win_days.toFixed(1)}d</p>
                        <p className="text-xs text-muted-foreground">Avg win hold</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[var(--loss)]">{analytics.hold_time_stats.avg_loss_days.toFixed(1)}d</p>
                        <p className="text-xs text-muted-foreground">Avg loss hold</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-foreground">{analytics.hold_time_stats.median_hold_days.toFixed(0)}d</p>
                        <p className="text-xs text-muted-foreground">Median hold</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Conviction Distribution */}
              <Card className="border-border bg-[var(--surface)]">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4">Conviction Distribution</h3>
                  {analytics.conviction_distribution.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No conviction data available.</p>
                  ) : (
                    <BarChart
                      data={analytics.conviction_distribution.map((d) => ({
                        label: d.bucket,
                        value: d.wins + d.losses,
                        color: d.wins >= d.losses ? "var(--profit)" : "var(--loss)",
                      }))}
                      height={160}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
