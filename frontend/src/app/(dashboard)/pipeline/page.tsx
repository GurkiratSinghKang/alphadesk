"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Brain,
  Play,
  TrendingUp,
  Target,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Zap,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardPageLayout } from "@/components/layouts";
import Mono from "@/components/typography/Mono";
import { cn, formatCurrency } from "@/lib/utils";
import { StrategyBuilder } from "@/components/panels/StrategyBuilder";
import { BacktestPanel } from "@/components/panels/BacktestPanel";
import { StrategyTemplates } from "@/components/panels/StrategyTemplates";
import {
  getPipelineStatus,
  triggerPipeline,
  getPipelineHistory,
  getPipelineRun,
  getPipelinePositions,
  getPositions,
  type PipelineStatus,
  type PipelineRun,
  type PipelinePosition,
} from "@/lib/api";

// ─── Signal badge helper ────────────────────────────────────

function SignalBadge({ signal }: { signal: string }) {
  const s = (signal ?? "hold").toLowerCase();
  const color =
    s === "buy"
      ? "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30"
      : s === "sell"
      ? "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
      : "bg-amber/15 text-amber border-amber/30";
  return (
    <Badge className={cn("text-[10px] font-bold uppercase border", color)}>
      {signal}
    </Badge>
  );
}

// ─── Pipeline Flow Diagram ──────────────────────────────────

function PipelineFlow({ run }: { run: PipelineRun | null }) {
  // Prefer the aggregate `counts` surfaced by the backend — they are the
  // source of truth when per-row detail is not available. Falling back to
  // array lengths keeps the UI working if the backend gives us rows instead.
  const screenedCount = run?.counts?.screened ?? run?.screened?.length ?? 0;
  const analyzedCount = run?.counts?.analyzed ?? run?.analyzed?.length ?? 0;
  const stages = [
    { label: "Screened", count: screenedCount },
    { label: "Analyzed", count: analyzedCount },
    { label: "Signals", count: run?.signals?.length ?? 0 },
    { label: "Orders", count: run?.ordersPlaced?.length ?? 0 },
  ];

  const allZero = stages.every((s) => s.count === 0);
  // When we have counts but no per-row detail, say so plainly rather than
  // synthesizing fake rows inside the table below.
  const countsOnly =
    !allZero &&
    (screenedCount > (run?.screened?.length ?? 0) ||
      analyzedCount > (run?.analyzed?.length ?? 0));

  // Determine if this run is from today or an earlier date
  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; })();
  const isToday = run?.date === today || run?.timestamp?.startsWith(today);
  const runDateLabel = run?.date && !isToday ? ` (${run.date})` : "";

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-2 flex-1">
            <div className={cn(
              "flex-1 rounded-lg border px-3 py-2 text-center",
              stage.count > 0
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-[var(--surface)]"
            )}>
              <p className={cn("text-lg font-bold tabular-nums", stage.count > 0 ? "text-primary" : "text-[#8a8a95]")}>
                {stage.count}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stage.label}</p>
            </div>
            {i < stages.length - 1 && (
              <span className="text-muted-foreground/40 text-sm shrink-0">→</span>
            )}
          </div>
        ))}
      </div>
      {allZero && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Pipeline has not run today &mdash; awaiting next scheduled run
        </p>
      )}
      {!allZero && runDateLabel && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Showing latest run{runDateLabel}
        </p>
      )}
      {countsOnly && (
        <p className="mt-2 text-center font-display italic text-[12px] text-muted-foreground">
          Details not available &mdash; counts only.
        </p>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

// ─── Risk Monitor Toggle ───────────────────────────────────

function RiskMonitorToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/strategies/admin/risk-monitor")
      .then((r) => r.json())
      .then((d) => { setEnabled(d.enabled ?? true); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await fetch(`/api/v1/strategies/admin/risk-monitor?enabled=${next}`, {
        method: "POST",
      });
    } catch {
      setEnabled(!next); // revert on error
    }
  };

  if (loading) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={`Risk Monitor ${enabled ? "enabled" : "disabled"} — click to toggle`}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 font-sans text-[11px] font-semibold transition-colors",
        enabled
          ? "border-profit/30 bg-profit-tint text-profit hover:bg-profit/15"
          : "border-loss/30 bg-loss-tint text-loss hover:bg-loss/15"
      )}
      title={enabled ? "Risk monitor is ON — click to disable" : "Risk monitor is OFF — click to enable"}
    >
      <span className={cn("h-2 w-2 rounded-full", enabled ? "bg-profit" : "bg-loss")} />
      Risk Monitor: {enabled ? "ON" : "OFF"}
    </button>
  );
}


export default function PipelinePage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [todayRun, setTodayRun] = useState<PipelineRun | null>(null);
  const [positions, setPositions] = useState<PipelinePosition[]>([]);
  const [brokerPositions, setBrokerPositions] = useState<PipelinePosition[]>([]);
  const [perfData, setPerfData] = useState<{ totalTrades: number; totalPnl: number; winRate: number; bestTrade: { symbol: string; pnl: number } | null; worstTrade: { symbol: string; pnl: number } | null } | null>(null);
  const [history, setHistory] = useState<Record<string, any>[]>([]);
  const [historyRuns, setHistoryRuns] = useState<Record<string, PipelineRun>>(
    {}
  );
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, h, bp] = await Promise.allSettled([
        getPipelineStatus(),
        getPipelinePositions(),
        getPipelineHistory(),
        getPositions(),
      ]);
      if (s.status === "fulfilled") setStatus(s.value);
      if (p.status === "fulfilled") {
        const val = p.value;
        if (val && typeof val === "object" && "positions" in val) {
          setPositions(Array.isArray(val.positions) ? val.positions : []);
          if (val.performance) setPerfData(val.performance as any);
        } else {
          setPositions(Array.isArray(val) ? val : []);
        }
      }
      // Map broker positions as fallback when pipeline positions are empty
      if (bp.status === "fulfilled") {
        setBrokerPositions(bp.value.map(pos => ({
          symbol: pos.symbol,
          shares: pos.quantity,
          entryPrice: pos.avgCost,
          currentPrice: pos.currentPrice,
          pnl: pos.unrealizedPnl,
          pnlPct: pos.avgCost > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost * 100) : 0,
          stopLoss: null,
          takeProfit: null,
          entryDate: "",
          signal: "hold",
          rationale: "",
        })));
      }
      if (h.status === "fulfilled") setHistory(Array.isArray(h.value) ? h.value.slice(0, 7) : []);

      // Load the most recent pipeline run — try today first, then latest from history
      if (h.status === "fulfilled" && Array.isArray(h.value) && h.value.length > 0) {
        const latestDate = h.value[0]?.date;
        if (latestDate) {
          try {
            const run = await getPipelineRun(latestDate);
            setTodayRun(run);
          } catch {
            // no run data available for latest date
          }
        }
      } else {
        // No history available — try today's date as last resort
        const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; })();
        try {
          const run = await getPipelineRun(today);
          setTodayRun(run);
        } catch {
          // no run today either
        }
      }
    } catch {
      // errors handled per-call
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mounted) fetchAll();
  }, [mounted, fetchAll]);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const res = await triggerPipeline();
      if (res.result) {
        setTodayRun(res.result);
      }
      // Refresh status
      try {
        const s = await getPipelineStatus();
        setStatus(s);
      } catch {
        // ignore
      }
      try {
        const pResult = await getPipelinePositions();
        if (pResult && "positions" in pResult) {
          setPositions(Array.isArray(pResult.positions) ? pResult.positions : []);
          if (pResult.performance) setPerfData(pResult.performance as any);
        } else {
          setPositions(Array.isArray(pResult) ? pResult : []);
        }
      } catch {
        // ignore
      }
    } catch {
      // error triggering
    } finally {
      setRunning(false);
    }
  };

  const handleExpandHistory = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(date);
    if (!historyRuns[date]) {
      try {
        const run = await getPipelineRun(date);
        setHistoryRuns((prev) => ({ ...prev, [date]: run }));
      } catch {
        // ignore
      }
    }
  };

  if (!mounted) {
    return (
      <DashboardPageLayout eyebrow="§ PIPELINE" title="Daily pipeline">
        <div className="flex h-64 items-center justify-center">
          <p className="font-display italic text-[14px] text-fg-muted">Loading pipeline.</p>
        </div>
      </DashboardPageLayout>
    );
  }

  // ─── Computed stats ─────────────────────────────────────
  // Use broker positions as fallback when pipeline has none
  const displayPositions = positions.length > 0 ? positions : brokerPositions;
  const totalPnl = displayPositions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const wins = displayPositions.filter((p) => (p.pnl ?? 0) > 0).length;
  const losses = displayPositions.filter((p) => (p.pnl ?? 0) < 0).length;
  const hasPnlData = displayPositions.some((p) => p.pnl !== 0 && p.pnl != null);
  const winRate =
    wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "N/A";
  const bestTrade = displayPositions.length
    ? displayPositions.reduce((best, p) => ((p.pnl ?? 0) > (best.pnl ?? 0) ? p : best), displayPositions[0])
    : null;
  const worstTrade = displayPositions.length
    ? displayPositions.reduce((worst, p) => ((p.pnl ?? 0) < (worst.pnl ?? 0) ? p : worst), displayPositions[0])
    : null;

  const statusColor = status?.running
    ? "bg-[var(--profit)]"
    : status?.lastResult === "error"
    ? "bg-[var(--loss)]"
    : "bg-muted-foreground";
  const statusLabel = status?.running
    ? "Running"
    : status?.lastResult === "error"
    ? "Error"
    : "Idle";

  const pipelineActions = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            statusColor
          )}
        />
        <span className="font-sans text-[11px] font-medium text-fg-muted">
          {statusLabel}
        </span>
      </div>
      {status?.lastRun && (
        <span className="flex items-center gap-1 text-fg-muted">
          <Clock className="h-3 w-3" aria-hidden />
          <Mono className="text-[11px] text-fg-muted">
            {new Date(status.lastRun).toLocaleString()}
          </Mono>
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setTemplatesOpen(true)}
        className="h-7 text-[11px] gap-1.5"
      >
        <Sparkles className="h-3 w-3" />
        Templates
      </Button>
      <RiskMonitorToggle />
      <Button
        size="sm"
        onClick={handleRunNow}
        disabled={running}
        className="h-7 text-[11px] gap-1.5"
      >
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {running ? "Running..." : "Run Now"}
      </Button>
    </>
  );

  return (
    <DashboardPageLayout
      eyebrow="§ PIPELINE"
      title="Daily pipeline"
      actions={pipelineActions}
    >
      {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Section 1: Current Positions */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Current Positions
                </h2>
                {displayPositions.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {displayPositions.length}
                  </Badge>
                )}
              </div>
              {displayPositions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-0">
                    <div className="flex items-center justify-center gap-3 py-4 text-muted-foreground">
                      <Target className="h-5 w-5 opacity-30" />
                      <p className="text-xs">No active positions — pipeline will open trades during market hours</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  {/* Viewport audit r5 #4: at 768-900 the table's min-w-[900px]
                      forces horizontal scroll, but macOS/iOS hide scrollbars
                      until actively scrolling — traders missed Stop Loss,
                      Take Profit and Signal columns. scrollbar-thin (defined
                      in globals.css) keeps the bar visible as a scroll
                      affordance at tablet widths. */}
                  <div className="overflow-x-auto scrollbar-thin">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-[11px]">Symbol</TableHead>
                        <TableHead className="text-[11px]">Shares</TableHead>
                        <TableHead className="text-[11px]">Entry</TableHead>
                        <TableHead className="text-[11px]">Current</TableHead>
                        <TableHead className="text-[11px]">P&L ($)</TableHead>
                        <TableHead className="text-[11px]">P&L (%)</TableHead>
                        <TableHead className="text-[11px]">Stop Loss</TableHead>
                        <TableHead className="text-[11px]">
                          Take Profit
                        </TableHead>
                        <TableHead className="text-[11px]">Entry Date</TableHead>
                        <TableHead className="text-[11px]">Signal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayPositions.map((pos) => (
                        <TableRow key={`${pos.symbol}-${pos.entryDate}`} className="border-border">
                          <TableCell className="text-xs font-bold text-foreground">
                            {pos.symbol}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {pos.shares}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {formatCurrency(pos.entryPrice)}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {formatCurrency(pos.currentPrice)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-xs font-medium tabular-nums",
                              (pos.pnl ?? 0) > 0
                                ? "text-[var(--profit)]"
                                : (pos.pnl ?? 0) < 0
                                ? "text-[var(--loss)]"
                                : "text-muted-foreground"
                            )}
                          >
                            {(pos.pnl ?? 0) >= 0 ? "+" : ""}
                            {formatCurrency(pos.pnl ?? 0)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-xs font-medium tabular-nums",
                              (pos.pnlPct ?? 0) > 0
                                ? "text-[var(--profit)]"
                                : (pos.pnlPct ?? 0) < 0
                                ? "text-[var(--loss)]"
                                : "text-muted-foreground"
                            )}
                          >
                            {(pos.pnlPct ?? 0) >= 0 ? "+" : ""}
                            {(pos.pnlPct ?? 0).toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {pos.stopLoss
                              ? formatCurrency(pos.stopLoss)
                              : <span className="inline-flex items-center gap-1 text-amber" title="No stop loss set — position is unprotected">None</span>}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {pos.takeProfit
                              ? formatCurrency(pos.takeProfit)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {pos.entryDate
                              ? new Date(pos.entryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <SignalBadge signal={pos.signal} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </Card>
              )}
            </section>

            {/* Section 2: Today's Pipeline Run */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Latest Pipeline Run
                </h2>
              </div>
              {todayRun ? (
                <PipelineFlow run={todayRun} />
              ) : (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                    <Zap className="h-7 w-7 text-muted-foreground/40" />
                    <p className="font-display italic text-[15px] text-fg leading-snug max-w-[440px]">
                      No pipeline run yet today. Next scheduled run: 09:30 ET.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleRunNow}
                      disabled={running}
                      className="h-7 text-[11px] gap-1.5 mt-1"
                    >
                      {running ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {running ? "Running..." : "Run now"}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            <Separator className="border-border" />

            {/* Strategy Builder */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Strategy Builder
                </h2>
                <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-medium">AI</span>
              </div>
              <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
                <StrategyBuilder />
              </div>
            </section>

            <Separator className="border-border" />

            {/* Backtesting */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Backtesting
                </h2>
              </div>
              <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
                <BacktestPanel />
              </div>
            </section>

            <Separator className="border-border" />

            {/* Section 3: History */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  History (Last 7 Days)
                </h2>
              </div>
              {history.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No pipeline history available yet
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-[11px] w-8" />
                        <TableHead className="text-[11px]">Date</TableHead>
                        <TableHead className="text-[11px]">Summary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => {
                        const run = historyRuns[h.date];
                        const isExpanded = expandedDate === h.date;
                        return (
                          <TableRow
                            key={h.date}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            aria-label={`Pipeline run for ${h.date}. ${isExpanded ? "Expanded" : "Collapsed"} — press Enter or Space to toggle.`}
                            className={cn(
                              "border-border cursor-pointer",
                              isExpanded && "bg-muted/30"
                            )}
                            onClick={() => handleExpandHistory(h.date)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleExpandHistory(h.date);
                              }
                            }}
                          >
                            <TableCell className="text-muted-foreground">
                              {isExpanded ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                            </TableCell>
                            <TableCell className="text-xs font-medium text-foreground">
                              {h.date}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {isExpanded && run ? (
                                <div className="space-y-1 py-1">
                                  <div className="flex gap-4 text-[11px]">
                                    <span>
                                      Screened: {run.counts?.screened ?? run.screened.length}
                                    </span>
                                    <span>
                                      Analyzed: {run.counts?.analyzed ?? run.analyzed.length}
                                    </span>
                                    <span>
                                      Signals: {run.signals.length}
                                    </span>
                                    <span>
                                      Orders: {run.ordersPlaced.length}
                                    </span>
                                  </div>
                                  {run.portfolioSnapshot && (
                                    <div className="flex gap-4 text-[11px]">
                                      <span>
                                        Equity:{" "}
                                        {formatCurrency(
                                          run.portfolioSnapshot.equity
                                        )}
                                      </span>
                                      <span>
                                        Cash:{" "}
                                        {formatCurrency(
                                          run.portfolioSnapshot.cash
                                        )}
                                      </span>
                                      <span>
                                        Positions:{" "}
                                        {run.portfolioSnapshot.positions}
                                      </span>
                                    </div>
                                  )}
                                  {run.errors.length > 0 && (
                                    <div className="text-[11px] text-[var(--loss)]">
                                      {run.errors.length} error(s)
                                    </div>
                                  )}
                                </div>
                              ) : (
                                h.summary || (() => {
                                  const parts: string[] = [];
                                  const screened = h.screened ?? (h.strategies_run ? Object.values(h.strategies_run || {}).reduce((s: number, v: any) => s + (v?.screened ?? 0), 0) : 0);
                                  const orders = h.orders_placed ?? h.ordersPlaced ?? 0;
                                  if (screened) parts.push(`${screened} screened`);
                                  if (h.analyzed) parts.push(`${h.analyzed} analyzed`);
                                  if (orders) parts.push(`${orders} order${orders !== 1 ? "s" : ""}`);
                                  if (h.errors?.length) parts.push(`${h.errors.length} error${h.errors.length !== 1 ? "s" : ""}`);
                                  return parts.length > 0 ? parts.join(" · ") : "No activity";
                                })()
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </section>

            <Separator className="border-border" />

            {/* Section 4: Performance Summary */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Performance Summary
                </h2>
              </div>
              {!perfData && !hasPnlData && displayPositions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No closed trades yet &mdash; performance stats will appear after the pipeline completes trades
                    </p>
                  </CardContent>
                </Card>
              ) : (
              // Viewport audit r5 #3: previous grid jumped 3→6 at exactly
              // 1280px (xl) with no intermediate step — violent reflow on
              // mid-laptop resize. Add lg:grid-cols-4 for 2→3→4→6.
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-gradient-to-r from-[var(--profit)] to-[var(--loss)]" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Total P&L
                    </p>
                    {(() => {
                      const closedPnl = perfData?.totalPnl ?? 0;
                      const openPnl = totalPnl;
                      const combined = closedPnl + openPnl;
                      return (
                        <p
                          className={cn(
                            "text-lg font-bold tabular-nums",
                            combined > 0
                              ? "text-[var(--profit)]"
                              : combined < 0
                              ? "text-[var(--loss)]"
                              : "text-muted-foreground"
                          )}
                        >
                          {!perfData && !hasPnlData ? "—" : `${combined >= 0 ? "+" : ""}${formatCurrency(combined)}`}
                        </p>
                      );
                    })()}
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-primary/60" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Win Rate
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {perfData ? ((perfData.winRate ?? 0) > 0 ? `${(perfData.winRate ?? 0).toFixed(1)}%` : "N/A") : winRate !== "N/A" ? `${winRate}%` : "N/A"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-primary/40" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Total Trades
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {perfData ? perfData.totalTrades : displayPositions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-primary/30" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Active Positions
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {displayPositions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-[var(--profit)]/60" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Best Trade
                    </p>
                    <p className={cn("text-lg font-bold tabular-nums", perfData?.bestTrade && perfData.bestTrade.pnl > 0 ? "text-[var(--profit)]" : bestTrade && (bestTrade.pnl ?? 0) > 0 ? "text-[var(--profit)]" : "text-muted-foreground")}>
                      {perfData?.bestTrade && perfData.bestTrade.pnl > 0
                        ? `+${formatCurrency(perfData.bestTrade.pnl)}`
                        : bestTrade && (bestTrade.pnl ?? 0) > 0
                        ? `+${formatCurrency(bestTrade.pnl)}`
                        : "—"}
                    </p>
                    {((perfData?.bestTrade && perfData.bestTrade.pnl > 0) || (bestTrade && (bestTrade.pnl ?? 0) > 0)) && (
                      <p className="text-[10px] text-muted-foreground">
                        {perfData?.bestTrade?.symbol ?? bestTrade?.symbol}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-[var(--loss)]/60" />
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Worst Trade
                    </p>
                    <p className={cn("text-lg font-bold tabular-nums", (perfData?.worstTrade || (worstTrade && (worstTrade.pnl ?? 0) < 0)) ? "text-[var(--loss)]" : "text-muted-foreground")}>
                      {perfData?.worstTrade
                        ? formatCurrency(perfData.worstTrade.pnl)
                        : worstTrade && (worstTrade.pnl ?? 0) < 0
                        ? formatCurrency(worstTrade.pnl)
                        : "—"}
                    </p>
                    {(perfData?.worstTrade || (worstTrade && (worstTrade.pnl ?? 0) < 0)) && (
                      <p className="text-[10px] text-muted-foreground">
                        {perfData?.worstTrade?.symbol ?? worstTrade?.symbol}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
              )}
            </section>
          </>
        )}
      <StrategyTemplates open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
    </DashboardPageLayout>
  );
}
