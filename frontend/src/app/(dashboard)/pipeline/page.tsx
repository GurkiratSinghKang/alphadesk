"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Play,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Clock,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Activity,
  BarChart3,
  Crosshair,
  FileText,
  Zap,
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
import { cn, formatCurrency } from "@/lib/utils";
import {
  getPipelineStatus,
  triggerPipeline,
  getPipelineHistory,
  getPipelineRun,
  getPipelinePositions,
  type PipelineStatus,
  type PipelineRun,
  type PipelinePosition,
  type PipelineAnalysis,
} from "@/lib/api";

// ─── Signal badge helper ────────────────────────────────────

function SignalBadge({ signal }: { signal: string }) {
  const s = (signal ?? "hold").toLowerCase();
  const color =
    s === "buy"
      ? "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30"
      : s === "sell"
      ? "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
      : "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
  return (
    <Badge className={cn("text-[10px] font-bold uppercase border", color)}>
      {signal}
    </Badge>
  );
}

// ─── Conviction bar ─────────────────────────────────────────

function ConvictionBar({ value: rawValue }: { value: number }) {
  const value = rawValue ?? 0;
  const color =
    value < 30
      ? "bg-[var(--loss)]"
      : value < 60
      ? "bg-yellow-500"
      : "bg-[var(--profit)]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

// ─── Order status badge ─────────────────────────────────────

function OrderStatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  const color =
    s === "filled"
      ? "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30"
      : s === "rejected"
      ? "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
      : "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
  return (
    <Badge className={cn("text-[10px] uppercase border", color)}>
      {status}
    </Badge>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function PipelinePage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [todayRun, setTodayRun] = useState<PipelineRun | null>(null);
  const [positions, setPositions] = useState<PipelinePosition[]>([]);
  const [perfData, setPerfData] = useState<{ totalTrades: number; totalPnl: number; winRate: number; bestTrade: { symbol: string; pnl: number } | null; worstTrade: { symbol: string; pnl: number } | null } | null>(null);
  const [history, setHistory] = useState<Record<string, any>[]>([]);
  const [historyRuns, setHistoryRuns] = useState<Record<string, PipelineRun>>(
    {}
  );
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, h] = await Promise.allSettled([
        getPipelineStatus(),
        getPipelinePositions(),
        getPipelineHistory(),
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
      if (h.status === "fulfilled") setHistory(Array.isArray(h.value) ? h.value.slice(0, 7) : []);

      // Try loading today's run
      const today = new Date().toISOString().slice(0, 10);
      try {
        const run = await getPipelineRun(today);
        setTodayRun(run);
      } catch {
        // no run today
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

  if (!mounted) return null;

  // ─── Computed stats ─────────────────────────────────────
  const totalPnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const wins = positions.filter((p) => (p.pnl ?? 0) > 0).length;
  const losses = positions.filter((p) => (p.pnl ?? 0) < 0).length;
  const hasPnlData = positions.some((p) => p.pnl !== 0 && p.pnl != null);
  const winRate =
    wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "N/A";
  const bestTrade = positions.length
    ? positions.reduce((best, p) => ((p.pnl ?? 0) > (best.pnl ?? 0) ? p : best), positions[0])
    : null;
  const worstTrade = positions.length
    ? positions.reduce((worst, p) => ((p.pnl ?? 0) < (worst.pnl ?? 0) ? p : worst), positions[0])
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-[var(--surface)] px-6 py-3">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-sm font-bold text-foreground">
            Trading Pipeline
          </h1>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                statusColor
              )}
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status?.lastRun && (
            <span className="text-[11px] text-muted-foreground">
              <Clock className="inline h-3 w-3 mr-1" />
              Last run: {new Date(status.lastRun).toLocaleString()}
            </span>
          )}
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
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Section 1: Current Positions */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Current Positions
                </h2>
                {positions.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {positions.length}
                  </Badge>
                )}
              </div>
              {positions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <Target className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No active positions &mdash; pipeline will open trades
                      during market hours
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <Table>
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
                      {positions.map((pos) => (
                        <TableRow key={pos.symbol} className="border-border">
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
                              : "—"}
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
                </Card>
              )}
            </section>

            {/* Section 2: Today's Pipeline Run */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {"Today's Pipeline Run"}
                </h2>
              </div>
              {!todayRun ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No pipeline run today yet &mdash; click &quot;Run
                      Now&quot; to trigger manually
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {/* Screened */}
                  <Card className="border-border bg-[var(--surface)]">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Crosshair className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold text-foreground">
                          Screened
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {(todayRun.screened ?? []).length} stocks
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(todayRun.screened ?? []).slice(0, 5).map((s) => (
                          <Badge
                            key={s.symbol}
                            variant="outline"
                            className="text-[10px] font-mono"
                          >
                            {s.symbol}
                          </Badge>
                        ))}
                        {(todayRun.screened ?? []).length > 5 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            +{(todayRun.screened ?? []).length - 5} more
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Signals Generated */}
                  <Card className="border-border bg-[var(--surface)]">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        <span className="text-xs font-bold text-foreground">
                          Signals Generated
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {(todayRun.signals ?? []).length}
                        </Badge>
                      </div>
                      {(todayRun.signals ?? []).length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No signals generated
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {(todayRun.signals ?? []).map(
                            (sig: Record<string, unknown>, i: number) => (
                              <div
                                key={i}
                                className="text-[11px] text-muted-foreground"
                              >
                                {String(sig.symbol || sig.name || JSON.stringify(sig))}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Orders Placed */}
                  <Card className="border-border bg-[var(--surface)]">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold text-foreground">
                          Orders Placed
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {(todayRun.ordersPlaced ?? []).length}
                        </Badge>
                      </div>
                      {(todayRun.ordersPlaced ?? []).length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No orders placed
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {(todayRun.ordersPlaced ?? []).map((o) => (
                            <div
                              key={o.orderId}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <span className="font-mono font-medium text-foreground">
                                {(o.side ?? "").toUpperCase()} {o.qty} {o.symbol}
                              </span>
                              <OrderStatusBadge status={o.status} />
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Errors */}
                  {(todayRun.errors ?? []).length > 0 && (
                    <Card className="border-border bg-[var(--surface)] border-[var(--loss)]/30">
                      <CardContent className="p-4">
                        <button
                          onClick={() => setErrorsExpanded(!errorsExpanded)}
                          className="flex items-center gap-2 mb-2 w-full text-left"
                        >
                          <AlertTriangle className="h-4 w-4 text-[var(--loss)]" />
                          <span className="text-xs font-bold text-[var(--loss)]">
                            Errors
                          </span>
                          <Badge
                            variant="destructive"
                            className="text-[10px]"
                          >
                            {(todayRun.errors ?? []).length}
                          </Badge>
                          {errorsExpanded ? (
                            <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />
                          )}
                        </button>
                        {errorsExpanded && (
                          <div className="space-y-1">
                            {(todayRun.errors ?? []).map((e, i) => (
                              <p
                                key={i}
                                className="text-[11px] text-[var(--loss)]"
                              >
                                {e}
                              </p>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Analyzed - shown as a wider section below the cards */}
              {todayRun && (todayRun.analyzed ?? []).length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      Analysis Results
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {(todayRun.analyzed ?? []).length} analyzed
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {(todayRun.analyzed ?? []).map((a: PipelineAnalysis) => (
                      <Card
                        key={a.symbol}
                        className="border-border bg-[var(--surface)]"
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-mono text-foreground">
                              {a.symbol}
                            </span>
                            <SignalBadge signal={a.signal} />
                          </div>
                          <ConvictionBar value={a.conviction} />
                          <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                            <div>
                              <span className="block text-muted-foreground/70">
                                Entry
                              </span>
                              <span className="tabular-nums text-foreground">
                                {a.entryPrice
                                  ? formatCurrency(a.entryPrice)
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground/70">
                                SL
                              </span>
                              <span className="tabular-nums text-[var(--loss)]">
                                {a.stopLoss
                                  ? formatCurrency(a.stopLoss)
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground/70">
                                TP
                              </span>
                              <span className="tabular-nums text-[var(--profit)]">
                                {a.takeProfit
                                  ? formatCurrency(a.takeProfit)
                                  : "—"}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                            {a.rationale}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <Separator className="border-border" />

            {/* Section 3: History */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-primary" />
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
                            className={cn(
                              "border-border cursor-pointer",
                              isExpanded && "bg-muted/30"
                            )}
                            onClick={() => handleExpandHistory(h.date)}
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
                                      Screened: {run.screened.length}
                                    </span>
                                    <span>
                                      Analyzed: {run.analyzed.length}
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
                                  if (h.screened) parts.push(`${h.screened} screened`);
                                  if (h.analyzed) parts.push(`${h.analyzed} analyzed`);
                                  if (h.orders_placed ?? h.ordersPlaced) parts.push(`${h.orders_placed ?? h.ordersPlaced} orders`);
                                  if (h.errors?.length) parts.push(`${h.errors.length} errors`);
                                  return parts.length > 0 ? parts.join(" · ") : "Click to expand";
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
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Performance Summary
                </h2>
              </div>
              {!perfData && !hasPnlData && positions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No closed trades yet &mdash; performance stats will appear after the pipeline completes trades
                    </p>
                  </CardContent>
                </Card>
              ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <Card className="border-border bg-[var(--surface)]">
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

                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Win Rate
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {perfData ? (perfData.winRate > 0 ? `${perfData.winRate.toFixed(1)}%` : "N/A") : winRate !== "N/A" ? `${winRate}%` : "N/A"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Total Trades
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {perfData ? perfData.totalTrades + positions.length : positions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Active Positions
                    </p>
                    <p className="text-lg font-bold tabular-nums text-foreground">
                      {positions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Best Trade
                    </p>
                    <p className={cn("text-lg font-bold tabular-nums", perfData?.bestTrade && perfData.bestTrade.pnl >= 0 ? "text-[var(--profit)]" : bestTrade && (bestTrade.pnl ?? 0) > 0 ? "text-[var(--profit)]" : "text-muted-foreground")}>
                      {perfData?.bestTrade
                        ? `${perfData.bestTrade.pnl >= 0 ? "+" : ""}${formatCurrency(perfData.bestTrade.pnl)}`
                        : bestTrade && (bestTrade.pnl ?? 0) > 0
                        ? `+${formatCurrency(bestTrade.pnl)}`
                        : "—"}
                    </p>
                    {(perfData?.bestTrade || (bestTrade && (bestTrade.pnl ?? 0) > 0)) && (
                      <p className="text-[10px] text-muted-foreground">
                        {perfData?.bestTrade?.symbol ?? bestTrade?.symbol}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-4 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Worst Trade
                    </p>
                    <p className="text-lg font-bold tabular-nums text-[var(--loss)]">
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
      </div>
    </div>
  );
}
