"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  // Round-8 killer-move 3: BarChart3 + Brain icons retired with the
  // StrategyBuilder + BacktestPanel sections that owned them.
  Play,
  TrendingUp,
  Target,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Zap,
  Sparkles,
  StopCircle,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
import { Separator } from "@/components/ui/separator";
import { Skeleton, SkeletonStack } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { getMarketSession } from "@/lib/marketHours";
// Round-8 killer-move 3: StrategyBuilder + BacktestPanel imports
// removed — they live behind a CTA pointing to /strategies now.
// Keeping a comment breadcrumb so a future developer rediscovering
// these imports doesn't add them back to the ops page reflexively.
import { StrategyTemplates } from "@/components/panels/StrategyTemplates";
import {
  getPipelineHistory,
  getPipelineRun,
  getPipelinePositions,
  getPositions,
  getRiskMonitorState,
  setRiskMonitorState,
  type PipelineRun,
  type PipelinePosition,
} from "@/lib/api";
import {
  getPipelineStatus,
  startPipelineRun,
  cancelPipeline,
  getSchedulerState,
  PipelineApiError,
  type PipelineStatus,
  type SchedulerState,
} from "@/lib/pipeline-api";
import { usePortfolioStore } from "@/stores/portfolio";
import { useToast } from "@/hooks/useToast";

// ─── Next-session helper ────────────────────────────────────
// The scheduler uses `USMarketCalendar` on the backend now, so the UI
// must not hardcode "09:30 ET" — on a weekend or after-hours slot the
// next run isn't until the next trading day. This mirrors the backend's
// logic well enough for copy: weekday after 16:00 → tomorrow (or Monday
// if tomorrow is Saturday), weekend → Monday.
function nextTradingSessionLabel(now: Date = new Date()): string {
  const weekdayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);

  const session = getMarketSession(now);
  if (session === "pre" || session === "open") {
    // Today itself hasn't hit the scheduler yet (or it's already running).
    return "Today 09:30 ET";
  }

  // "post" on a weekday or "closed" on the weekend — next run is a
  // future day at 09:30 ET. Work out which.
  const weekday = weekdayParts; // e.g. "Friday"
  if (weekday === "Friday") return "Monday 09:30 ET";
  if (weekday === "Saturday") return "Monday 09:30 ET";
  if (weekday === "Sunday") return "Monday 09:30 ET";
  // Weekday after-hours — next session tomorrow.
  return "Tomorrow 09:30 ET";
}

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
    <Badge className={cn("t-label border", color)}>
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
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-between">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex min-w-0 items-center gap-2 sm:flex-1">
            <div className={cn(
              "min-w-0 flex-1 rounded-lg border px-3 py-2 text-center",
              stage.count > 0
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-[var(--surface)]"
            )}>
              <p className={cn("t-num-lg", stage.count > 0 ? "text-primary" : "text-muted-foreground")}>
                {stage.count}
              </p>
              <p className="t-label mt-0.5">{stage.label}</p>
            </div>
            {i < stages.length - 1 && (
              <span className="hidden text-muted-foreground/40 text-sm shrink-0 sm:inline" aria-hidden>→</span>
            )}
          </div>
        ))}
      </div>
      {allZero && (
        <p className="t-meta mt-2 text-center">
          Pipeline has not run today &mdash; awaiting next scheduled run
        </p>
      )}
      {!allZero && runDateLabel && (
        <p className="t-meta mt-2 text-center">
          Showing latest run{runDateLabel}
        </p>
      )}
      {countsOnly && (
        <p className="mt-2 text-center font-display italic text-label text-muted-foreground">
          Details not available &mdash; counts only.
        </p>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

// ─── Risk Monitor Toggle ───────────────────────────────────

function RiskMonitorToggle({ lastHeartbeat }: { lastHeartbeat?: string | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRiskMonitorState()
      .then((d) => {
        setEnabled(d.enabled ?? null);
        setError(null);
      })
      .catch((err) => {
        setEnabled(null);
        setError(err instanceof Error ? err.message : "Risk monitor status unavailable");
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    if (enabled == null) return;
    const next = !enabled;
    setEnabled(next);
    setError(null);
    try {
      const state = await setRiskMonitorState(next);
      setEnabled(state.enabled ?? next);
    } catch (err) {
      setEnabled(!next); // revert on error
      setError(err instanceof Error ? err.message : "Risk monitor update failed");
    }
  };

  if (loading) return null;

  // BUG-003(b): don't claim "ON" until we have evidence the monitor has
  // actually fired at least once. No heartbeat means the monitor is either
  // cold (pre-first-run today) or the scheduler is asleep — either way we
  // surface "Idle" with the next-run label instead of a green confident ON.
  const unavailable = enabled == null;
  const hasHeartbeat = !!lastHeartbeat;
  const showIdle = enabled && !hasHeartbeat;
  const label = unavailable
    ? "Risk Monitor: unavailable"
    : !enabled
    ? "Risk Monitor: OFF"
    : showIdle
    ? `Idle — next run ${nextTradingSessionLabel()}`
    : "Risk Monitor: ON";
  const tone = unavailable
    ? "border-amber/30 bg-amber/10 text-amber"
    : !enabled
    ? "border-loss/30 bg-loss-tint text-loss hover:bg-loss/15"
    : showIdle
    ? "border-amber/30 bg-amber/10 text-amber hover:bg-amber/15"
    : "border-profit/30 bg-profit-tint text-profit hover:bg-profit/15";
  const dot = unavailable ? "bg-amber" : !enabled ? "bg-loss" : showIdle ? "bg-amber" : "bg-profit";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={unavailable}
        aria-pressed={enabled ?? undefined}
        aria-label={
          unavailable
            ? "Risk Monitor status unavailable"
            : `Risk Monitor ${enabled ? "enabled" : "disabled"} — click to toggle`
        }
        className={cn(
          // WCAG 2.5.5 / Apple HIG: a toggle that controls a backend feature
          // needs a ≥44px tap target. Keep the visible pill compact (px-3)
          // but guarantee the hit box via `min-h-11`.
          "flex min-h-11 items-center gap-2 rounded-md border px-3 py-1.5 font-sans text-label font-semibold transition-colors",
          tone,
        )}
        title={
          unavailable
            ? "Risk monitor status is unavailable"
            : !enabled
            ? "Risk monitor is OFF — click to enable"
            : showIdle
            ? "Risk monitor enabled but no heartbeat yet — click to disable"
            : "Risk monitor is ON — click to disable"
        }
      >
        <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
        {label}
      </button>
      {error ? (
        <p className="max-w-[220px] text-right text-label leading-snug text-down-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}


export default function PipelinePage() {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  // `running` here is "the user clicked Run Now and we're awaiting the
  // 202 acknowledgement". The authoritative running state lives in
  // `status.running` (server-driven via the 2s poll).
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const destructive = useDestructiveAction();
  // Tick state — the running card needs to re-render every second so the
  // "Elapsed" clock advances. The server status only refreshes every 2s,
  // so without this `setNow` the elapsed counter would jump by 2s.
  const [, setNow] = useState(0);

  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [todayRun, setTodayRun] = useState<PipelineRun | null>(null);
  const [positions, setPositions] = useState<PipelinePosition[]>([]);
  const [brokerPositions, setBrokerPositions] = useState<PipelinePosition[]>([]);
  const [perfData, setPerfData] = useState<{ totalTrades: number; totalPnl: number; winRate: number; bestTrade: { symbol: string; pnl: number } | null; worstTrade: { symbol: string; pnl: number } | null } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(typed-api): pipeline history row shape is dynamic; type via FastAPI codegen
  const [history, setHistory] = useState<Record<string, any>[]>([]);
  const [historyRuns, setHistoryRuns] = useState<Record<string, PipelineRun>>(
    {}
  );
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  // BUG-011 — confirmation modal before firing the (cost-bearing)
  // pipeline. Set true when the user clicks Run Now; cleared on confirm
  // or cancel.
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  // Poll handle — kept in a ref so the effect can clear it without
  // re-running on every status change.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track the prior running state so we can detect the running→idle edge
  // and refresh history / latest run once the pipeline finishes.
  const prevRunningRef = useRef<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Retry-After countdown — when set, decrement once a second and clear
  // when it reaches zero so the Run Now button can re-enable.
  useEffect(() => {
    if (retryAfter == null || retryAfter <= 0) return;
    const id = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev == null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, h, bp, sch] = await Promise.allSettled([
        getPipelineStatus(),
        getPipelinePositions(),
        getPipelineHistory(),
        getPositions(),
        getSchedulerState(),
      ]);
      if (s.status === "fulfilled") setStatus(s.value);
      if (sch.status === "fulfilled") setScheduler(sch.value);
      if (p.status === "fulfilled") {
        const val = p.value;
        if (val && typeof val === "object" && "positions" in val) {
          setPositions(Array.isArray(val.positions) ? val.positions : []);
          if (val.performance) setPerfData(val.performance as Parameters<typeof setPerfData>[0]);
        } else {
          setPositions(Array.isArray(val) ? val : []);
        }
      }
      // Map broker positions as fallback when pipeline positions are empty.
      // BUG-001 / BUG-015: also push the broker positions into the shared
      // `usePortfolioStore` so the Desk + Reports pages see the same snapshot
      // we just paid for here. Previously each page refetched positions
      // independently and got a slightly different current_price per
      // request → AVGO +$275 / +$375 / +$284 across tabs.
      if (bp.status === "fulfilled") {
        usePortfolioStore.getState().setPositions(bp.value);
        setBrokerPositions(bp.value.map(pos => {
          const sideSign = pos.side === "short" ? -1 : 1;
          return {
            symbol: pos.symbol,
            shares: pos.quantity,
            entryPrice: pos.avgCost,
            currentPrice: pos.currentPrice,
            pnl: pos.unrealizedPnl,
            pnlPct: pos.avgCost > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost * 100) * sideSign : 0,
            stopLoss: null,
            takeProfit: null,
            entryDate: "",
            signal: "hold",
            rationale: "",
          };
        }));
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

  // Live status polling — when `status.running` is true, poll every 2s.
  // The status endpoint is cheap (returns module-level globals + lock
  // state) and the running operator wants near-real-time updates of
  // stage / current strategy. When the run flips back to idle we clear
  // the interval and refresh derived data once.
  useEffect(() => {
    const isRunning = status?.running === true;
    if (!isRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // Detect running→idle edge — refresh history and the latest run
      // payload so the page reflects whatever the run produced /
      // cancelled. We only do this when we previously saw "running"
      // and now see "idle"; on a cold load with a long-since-finished
      // run we don't refetch in a tight loop.
      if (prevRunningRef.current) {
        prevRunningRef.current = false;
        // Fire-and-forget refresh; errors handled per-call.
        void (async () => {
          try {
            const h = await getPipelineHistory();
            const histArr = Array.isArray(h) ? h : [];
            setHistory(histArr.slice(0, 7));
            const latestDate = histArr[0]?.date;
            if (latestDate) {
              try {
                const run = await getPipelineRun(latestDate);
                setTodayRun(run);
              } catch {
                // no payload yet
              }
            }
          } catch {
            // ignore
          }
        })();
      }
      return;
    }
    // We are running — start the poll if not already running.
    prevRunningRef.current = true;
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const next = await getPipelineStatus();
        setStatus(next);
      } catch {
        // Transient error — keep polling, don't tear the interval down.
      }
      // Drive the elapsed-time clock between server polls.
      setNow((n) => n + 1);
    }, 2_000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running]);

  // Bonus elapsed-time tick — when the pipeline is running, advance the
  // displayed "Elapsed" clock once per second even between server polls.
  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [status?.running]);

  // TODO(auth-wave): The backend `/pipeline/run` endpoint currently uses
  // `require_auth` rather than `require_admin`, so any authenticated user
  // can trigger a (cost-bearing) pipeline run. The right fix lives in
  // `backend/api/auth.py` + the pipeline route decorator. Until that lands
  // this button remains open — we deliberately don't try to read the JWT
  // sub client-side because our token is HttpOnly cookie and not
  // accessible to JS.
  //
  // The flow is now fire-and-forget: POST /run returns 202 with a run_id,
  // the page flips into "running" state via the live status poll, and the
  // operator watches stage/progress in the running card.
  //
  // BUG-011 — the top-level click opens the confirmation modal; the
  // modal's confirm button calls `confirmAndRunPipeline` below.
  const handleRunNow = () => {
    setRunConfirmOpen(true);
  };

  const confirmAndRunPipeline = async () => {
    setRunConfirmOpen(false);
    setSubmitting(true);
    setRetryAfter(null);
    try {
      await startPipelineRun();
      // Optimistically pull a fresh status so the running card paints
      // immediately rather than waiting for the next 2s tick.
      try {
        const s = await getPipelineStatus();
        setStatus(s);
      } catch {
        // The polling effect will catch up on its own.
      }
    } catch (err) {
      if (err instanceof PipelineApiError && err.status === 429 && err.retryAfter) {
        setRetryAfter(err.retryAfter);
        toast({
          type: "warning",
          message: `Rate-limited — retry in ${err.retryAfter}s.`,
        });
      } else if (err instanceof PipelineApiError && err.status === 403) {
        // Admin-only endpoint. Previously the 403 returned by
        // `/pipeline/run` for non-admins was swallowed silently; the UI
        // left the operator staring at a non-running Run Now with no
        // explanation. Toast surfaces the real reason.
        toast({
          type: "error",
          message: "You don't have permission to run the pipeline.",
        });
      } else {
        // Generic fallback so a 5xx or network error isn't silent.
        const msg =
          err instanceof Error ? err.message : "Could not start the pipeline.";
        toast({ type: "error", message: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const executeCancelPipeline = async () => {
    setCancelling(true);
    try {
      await cancelPipeline();
      // Pull fresh status so the UI reflects the cancel having been
      // requested (the pipeline may take a few seconds to honour it).
      try {
        const s = await getPipelineStatus();
        setStatus(s);
      } catch {
        // ignore — next scheduled poll will catch up.
      }
      toast({
        type: "success",
        message: "Cancel requested. Pipeline will stop at next safe checkpoint.",
      });
    } catch (err) {
      // Previously this catch was empty — a 403 (non-admin) or 5xx left
      // the Cancel button showing "Cancelling..." with no feedback. Toast
      // the real status so the operator knows their click didn't work.
      if (err instanceof PipelineApiError && err.status === 403) {
        toast({
          type: "error",
          message: "You don't have permission to cancel the pipeline.",
        });
      } else {
        const msg =
          err instanceof Error ? err.message : "Could not cancel the pipeline.";
        toast({ type: "error", message: msg });
      }
    } finally {
      setCancelling(false);
    }
  };

  const handleCancel = () => {
    const runName = status?.run_id ? `Run #${status.run_id.slice(0, 8)}` : "Current run";
    destructive.request({
      title: "Cancel pipeline run",
      description: `${runName} aborts mid-step.`,
      consequences: [
        "Aborts the current pass mid-step.",
        "Costs incurred so far are not refunded.",
        "Next scheduled run starts fresh.",
      ],
      confirmLabel: "Cancel run",
      onConfirm: executeCancelPipeline,
    });
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
          <p className="font-display italic text-body text-fg-muted">Loading pipeline.</p>
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

  // `status.running` is the authoritative server-side flag; `submitting`
  // covers the (sub-second) window where we've POSTed /run but haven't
  // yet seen the server flip to running on the next poll.
  const isRunning = status?.running === true;
  const lastResult = status?.last_result ?? null;
  const lastRun = status?.last_run ?? null;
  const statusColor = isRunning
    ? "bg-[var(--profit)]"
    : lastResult === "cancelled"
    ? "bg-amber"
    : lastResult && lastResult.startsWith("error")
    ? "bg-[var(--loss)]"
    : "bg-muted-foreground";
  const statusLabel = isRunning
    ? "Running"
    : lastResult === "cancelled"
    ? "Cancelled"
    : lastResult && lastResult.startsWith("error")
    ? "Error"
    : "Idle";

  // Disable Run Now while submitting OR while a 429 backoff is active.
  // Cooldown text doubles as the button label so the operator sees why
  // the button is unavailable.
  const runDisabled = submitting || isRunning || (retryAfter ?? 0) > 0;
  const runLabel = retryAfter
    ? `Wait ${retryAfter}s`
    : submitting
    ? "Starting..."
    : isRunning
    ? "Running..."
    : "Run now";

  const pipelineActions = (
    <>
      {/* Status chip — explicit "RUNNING / IDLE / CANCELLED / ERROR" pill
          using the editorial `t-label` caps token so the state is legible
          at a glance alongside the clock + toggles. Previously the label
          was a flat 11px sans — too close to the surrounding meta text to
          register as a status reading. */}
      <div
        aria-label={`Pipeline status: ${statusLabel}`}
        className="flex items-center gap-2"
      >
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            statusColor,
            isRunning && "animate-pulse",
          )}
          aria-hidden
        />
        <span className="t-label text-fg">{statusLabel}</span>
      </div>
      {lastRun && (
        <span className="flex items-center gap-1 text-fg-muted">
          <Clock className="h-3 w-3" aria-hidden />
          <Mono className="t-meta">
            {new Date(lastRun).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" ET"}
          </Mono>
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setTemplatesOpen(true)}
        className="min-h-11 text-label gap-1.5"
      >
        <Sparkles className="h-3 w-3" />
        Templates
      </Button>
      <RiskMonitorToggle lastHeartbeat={scheduler?.last_heartbeat} />
      <Button
        size="sm"
        onClick={handleRunNow}
        disabled={runDisabled}
        className="min-h-11 text-label gap-1.5"
      >
        {submitting || isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {runLabel}
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
          // Phase-1 / SK-1: replace page-level spinner with content-shape
          // skeleton (Stripe / Linear / Notion pattern). Mirrors the eventual
          // Live Run card + summary card layout so the user sees the
          // *shape* of what's loading, not a generic pinwheel.
          <div className="space-y-3" data-slot="pipeline-loading">
            <Skeleton className="h-32 w-full rounded" />
            <Skeleton className="h-24 w-full rounded" />
            <SkeletonStack rows={5} cells={6} />
          </div>
        ) : (
          <>
            {/* Live Running Card — only visible while a run is in flight.
                Shows stage, progress bar, current strategy, elapsed clock,
                and a Cancel button (admin-only on the backend; we render
                it for everyone and let the API return 403 if non-admin —
                we have no client-side role data to gate on). */}
            {isRunning && status && (
              <section>
                <Card className="border-[var(--profit)]/40 bg-[var(--profit)]/5 overflow-hidden">
                  <div className="h-0.5 bg-[var(--profit)]/80 animate-pulse" />
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-[var(--profit)] animate-pulse" aria-hidden />
                        <span className="t-label text-foreground">
                          Pipeline running
                        </span>
                        {status.stage && (
                          <Badge variant="secondary" className="t-label">
                            {status.stage}
                          </Badge>
                        )}
                        {status.current_strategy && (
                          <Badge variant="outline" className="t-meta">
                            {status.current_strategy}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-fg-muted">
                        {status.started_at && (
                          <span className="flex items-center gap-1.5">
                            <span className="t-label">Elapsed</span>
                            <Mono className="t-num-md text-foreground">
                              {(() => {
                                const start = new Date(status.started_at).getTime();
                                const elapsedSec = Math.max(
                                  0,
                                  Math.floor((Date.now() - start) / 1000),
                                );
                                const m = Math.floor(elapsedSec / 60);
                                const s = elapsedSec % 60;
                                return `${m}:${String(s).padStart(2, "0")}`;
                              })()}
                            </Mono>
                          </span>
                        )}
                        {status.run_id && (
                          <Mono className="t-meta">
                            #{status.run_id.slice(0, 8)}
                          </Mono>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleCancel}
                          disabled={cancelling}
                          className="h-7 text-label gap-1.5"
                        >
                          {cancelling ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <StopCircle className="h-3 w-3" />
                          )}
                          {cancelling ? "Cancelling..." : "Cancel"}
                        </Button>
                      </div>
                    </div>
                    {status.progress && status.progress.total > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-fg-muted">
                          <span className="t-label">Strategies completed</span>
                          <Mono className="t-num-md text-foreground">
                            {status.progress.current} / {status.progress.total}
                          </Mono>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                          <div
                            className="h-full bg-[var(--profit)] transition-all"
                            style={{
                              width: `${Math.min(
                                100,
                                (status.progress.current / status.progress.total) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Scheduler State — when idle, surface the next scheduled run
                + last heartbeat so an operator can confirm the scheduler
                is alive (persona-7 #8). Hidden during a live run to keep
                the page focused on the running card above. */}
            {!isRunning && scheduler && (
              <section>
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="t-label">Next run</span>
                      {/* BUG-013: the header elsewhere on this page calls
                          the next run "09:30 ET" (market open). The
                          scheduler timestamp — formatted via `toLocaleString`
                          — rendered as "9:35:00 AM" in the user's local
                          locale, contradicting the header. Normalise to
                          "YYYY-MM-DD 09:30 ET" so both readings agree.
                          Using `t-num-md` so it lands mono-tabular and
                          slightly larger than meta — it's the actionable
                          number on this card. */}
                      <Mono className="t-num-md text-foreground">
                        {(() => {
                          // R6-8 / R5-B2 fix: same Invalid-Date guard used by
                          // the heartbeat readout below — if the timestamp
                          // string fails to parse we fall through to
                          // "Unavailable" instead of "Invalid Date 09:30 ET".
                          if (!scheduler.next_scheduled_run) return "Unknown";
                          const d = new Date(scheduler.next_scheduled_run);
                          if (isNaN(d.valueOf())) return "Unavailable";
                          return `${new Intl.DateTimeFormat("en-CA", {
                            timeZone: "America/New_York",
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          }).format(d)} 09:30 ET`;
                        })()}
                      </Mono>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="t-label">Heartbeat</span>
                      <Mono className="t-meta text-foreground">
                        {(() => {
                          // R6-8 / R5-B2 fix: a malformed/empty `last_heartbeat`
                          // string used to render literally as "Invalid Date ET".
                          // Validate the parsed Date so we fall through to a
                          // graceful "Unavailable" instead of leaking the JS
                          // error to the operator.
                          if (!scheduler.last_heartbeat) return "Never";
                          const d = new Date(scheduler.last_heartbeat);
                          if (isNaN(d.valueOf())) return "Unavailable";
                          return (
                            d.toLocaleString("en-US", {
                              timeZone: "America/New_York",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }) + " ET"
                          );
                        })()}
                      </Mono>
                      {scheduler.missed_runs > 0 && (
                        <Badge
                          className="t-label bg-amber/15 text-amber border-amber/30"
                        >
                          {scheduler.missed_runs} missed
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Section 1: Current Positions */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4" aria-hidden />
                <h2 className="t-section-display">
                  Current positions
                </h2>
                {displayPositions.length > 0 && (
                  <Badge variant="secondary" className="t-label">
                    {displayPositions.length}
                  </Badge>
                )}
              </div>
              {displayPositions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="p-0">
                    <div className="flex items-center justify-center gap-3 py-4 text-muted-foreground">
                      <Target className="h-5 w-5 opacity-30" />
                      <p className="text-label">No active positions — pipeline will open trades during market hours</p>
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
                        {/* `t-label` (12px caps, tracked 0.12em) is the
                            dashboard standard for column eyebrows. */}
                        <TableHead className="t-label">Symbol</TableHead>
                        <TableHead className="t-label">Shares</TableHead>
                        <TableHead className="t-label">Entry</TableHead>
                        <TableHead className="t-label">Current</TableHead>
                        <TableHead className="t-label">P&L ($)</TableHead>
                        <TableHead className="t-label">P&L (%)</TableHead>
                        <TableHead className="t-label">Stop loss</TableHead>
                        <TableHead className="t-label">Take profit</TableHead>
                        <TableHead className="t-label">Entry date</TableHead>
                        <TableHead className="t-label">Signal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayPositions.map((pos) => (
                        <TableRow key={`${pos.symbol}-${pos.entryDate}`} className="border-border">
                          <TableCell className="font-sans font-semibold text-body-sm text-foreground">
                            {pos.symbol}
                          </TableCell>
                          <TableCell className="t-num-md text-foreground">
                            {pos.shares}
                          </TableCell>
                          <TableCell className="t-num-md text-foreground">
                            {formatCurrency(pos.entryPrice)}
                          </TableCell>
                          <TableCell className="t-num-md text-foreground">
                            {formatCurrency(pos.currentPrice)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "t-num-md",
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
                              "t-num-md",
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
                          <TableCell className="t-num-md text-muted-foreground">
                            {pos.stopLoss
                              ? formatCurrency(pos.stopLoss)
                              : <span className="t-label text-amber" title="No stop loss set — position is unprotected">None</span>}
                          </TableCell>
                          <TableCell className="t-num-md text-muted-foreground">
                            {pos.takeProfit
                              ? formatCurrency(pos.takeProfit)
                              : "—"}
                          </TableCell>
                          <TableCell className="t-meta text-muted-foreground">
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
                <Zap className="h-4 w-4" aria-hidden />
                <h2 className="t-section-display">
                  Latest pipeline run
                </h2>
              </div>
              {todayRun ? (
                <PipelineFlow run={todayRun} />
              ) : (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                    <Zap className="h-7 w-7 text-muted-foreground/40" />
                    {(() => {
                      const session = getMarketSession();
                      const nextLabel = nextTradingSessionLabel();
                      // Weekend / after-hours copy acknowledges the
                      // scheduler's market-calendar awareness rather than
                      // claiming "next scheduled run: 09:30 ET" on Sunday.
                      const line =
                        session === "closed"
                          ? `Market is closed today. Next scheduled run: ${nextLabel}.`
                          : session === "post"
                          ? `Today's session has ended. Next scheduled run: ${nextLabel}.`
                          : `No pipeline run yet today. Next scheduled run: ${nextLabel}.`;
                      return (
                        <p className="font-display italic text-body text-fg leading-snug max-w-[440px]">
                          {line}
                        </p>
                      );
                    })()}
                    <Button
                      size="sm"
                      onClick={handleRunNow}
                      disabled={runDisabled}
                      className="h-7 text-label gap-1.5 mt-1"
                    >
                      {submitting || isRunning ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {runLabel}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Round-8 killer-move 3: StrategyBuilder + BacktestPanel
                were mounted on /pipeline (an operations page) — they are
                CREATION tools, not operations. The user proposed pulling
                them off ops pages so each view answers ONE question
                (R8). They now live in a small CTA card at the bottom of
                the Pipeline page, deep-linking to the dedicated routes
                (/strategies/new and /strategies/[id]/backtest, to be
                wired separately). The ~800 lines of creation UI return
                later via those routes; the operations page is now
                focused on "is the system running and what did it do?". */}
            <Separator className="border-border" />

            <section
              data-slot="pipeline-builder-cta"
              aria-label="Build or backtest a strategy"
            >
              <div className="rounded-xl border border-border bg-[var(--surface)] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="t-section-display text-foreground">
                      Build or backtest
                    </h2>
                    <p className="t-meta u-muted mt-1">
                      Strategy creation and historical backtesting moved to the
                      Strategies page — ops view stays focused on live runs.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <Link
                      href="/strategies"
                      className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-bg-elev-1 px-4 font-mono text-label u-brand transition-colors hover:bg-bg-card hover:border-[color:var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      ▸ Open Strategies
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <Separator className="border-border" />

            {/* Section 3: History */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4" aria-hidden />
                <h2 className="t-section-display">
                  History &nbsp;<span className="t-meta">· last 7 days</span>
                </h2>
              </div>
              {history.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-label text-muted-foreground">
                      No pipeline history available yet
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Slice-13 / SWIM-1 (2026 design brief, Datadog
                      observability pattern): 30-day swimlane heatmap
                      above the detail table. Each cell = one day,
                      tone-coded by run health: profit-green = clean run
                      (no errors), amber = partial (errors > 0 but
                      strategies ran), loss-coral = failed run, muted =
                      no run logged. Hover any cell for the day's
                      headline numbers; click to scroll the table to
                      that row. Renders the timeline as a single dense
                      glance — "is the pipeline healthy?" in 1 second. */}
                  <PipelineSwimlane
                    history={history}
                    onCellClick={(date) => handleExpandHistory(date)}
                  />
                  <Card className="border-border bg-[var(--surface)] overflow-hidden mt-3">
                  <Table className="min-w-[420px]">
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="t-label w-8" />
                        <TableHead className="t-label">Date</TableHead>
                        <TableHead className="t-label">Summary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h, index) => {
                        const rowDate = h.date ?? `run-${index + 1}`;
                        const run = historyRuns[rowDate];
                        const isExpanded = expandedDate === rowDate;
                        return (
                          <TableRow
                            key={rowDate}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            aria-label={`Pipeline run for ${rowDate}. ${isExpanded ? "Expanded" : "Collapsed"} — press Enter or Space to toggle.`}
                            className={cn(
                              "border-border cursor-pointer",
                              isExpanded && "bg-muted/30"
                            )}
                            onClick={() => handleExpandHistory(rowDate)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleExpandHistory(rowDate);
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
                            <TableCell>
                              {/* Date column — mono-tabular so vertically-
                                  stacked YYYY-MM-DDs align. */}
                              <Mono className="t-num-md text-foreground">
                                {rowDate}
                              </Mono>
                            </TableCell>
                            <TableCell className="t-meta text-muted-foreground">
                              {isExpanded && run ? (
                                <div className="space-y-1 py-1">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 t-meta">
                                    <span>
                                      <span className="t-label mr-1">Screened</span>
                                      <Mono className="t-num-md text-foreground">
                                        {run.counts?.screened ?? run.screened.length}
                                      </Mono>
                                    </span>
                                    <span>
                                      <span className="t-label mr-1">Analyzed</span>
                                      <Mono className="t-num-md text-foreground">
                                        {run.counts?.analyzed ?? run.analyzed.length}
                                      </Mono>
                                    </span>
                                    <span>
                                      <span className="t-label mr-1">Signals</span>
                                      <Mono className="t-num-md text-foreground">
                                        {run.signals.length}
                                      </Mono>
                                    </span>
                                    <span>
                                      <span className="t-label mr-1">Orders</span>
                                      <Mono className="t-num-md text-foreground">
                                        {run.ordersPlaced.length}
                                      </Mono>
                                    </span>
                                  </div>
                                  {run.portfolioSnapshot && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 t-meta">
                                      <span>
                                        <span className="t-label mr-1">Equity</span>
                                        <Mono className="t-num-md text-foreground">
                                          {formatCurrency(run.portfolioSnapshot.equity)}
                                        </Mono>
                                      </span>
                                      <span>
                                        <span className="t-label mr-1">Cash</span>
                                        <Mono className="t-num-md text-foreground">
                                          {formatCurrency(run.portfolioSnapshot.cash)}
                                        </Mono>
                                      </span>
                                      <span>
                                        <span className="t-label mr-1">Positions</span>
                                        <Mono className="t-num-md text-foreground">
                                          {run.portfolioSnapshot.positions}
                                        </Mono>
                                      </span>
                                    </div>
                                  )}
                                  {run.errors.length > 0 && (
                                    <div className="t-meta text-[var(--loss)]">
                                      {run.errors.length} error(s)
                                    </div>
                                  )}
                                </div>
                              ) : (
                                h.summary || (() => {
                                  // `strategies_run` is a count (number) on the
                                  // current backend — `Object.values(7)` yields []
                                  // and renders as 0. Also keep a fallback for
                                  // legacy payloads that might still be an object
                                  // `{strategy_id: count}` by summing values.
                                  const sRun = h.strategies_run;
                                  let strategiesRun = 0;
                                  if (typeof sRun === "number" && Number.isFinite(sRun)) {
                                    strategiesRun = sRun;
                                  } else if (sRun && typeof sRun === "object") {
                                    strategiesRun = Object.values(sRun).reduce(
                                      (sum: number, v: unknown) => {
                                        if (typeof v === "number") return sum + v;
                                        if (v && typeof v === "object") {
                                          const o = v as { screened?: number; count?: number };
                                          return sum + (o.screened ?? o.count ?? 0);
                                        }
                                        return sum;
                                      },
                                      0
                                    ) as number;
                                  }
                                  const parts: string[] = [];
                                  const screened = h.screened ?? 0;
                                  const orders =
                                    typeof h.orders_placed === "number"
                                      ? h.orders_placed
                                      : typeof h.ordersPlaced === "number"
                                      ? h.ordersPlaced
                                      : Array.isArray(h.orders_placed)
                                      ? h.orders_placed.length
                                      : 0;
                                  const signals =
                                    typeof h.signals === "number"
                                      ? h.signals
                                      : Array.isArray(h.signals)
                                      ? h.signals.length
                                      : 0;
                                  const errCount = Array.isArray(h.errors)
                                    ? h.errors.length
                                    : typeof h.errors === "number"
                                    ? h.errors
                                    : 0;
                                  if (strategiesRun)
                                    parts.push(
                                      `${strategiesRun} strateg${strategiesRun === 1 ? "y" : "ies"}`
                                    );
                                  if (screened) parts.push(`${screened} screened`);
                                  if (h.analyzed) parts.push(`${h.analyzed} analyzed`);
                                  if (signals)
                                    parts.push(
                                      `${signals} signal${signals !== 1 ? "s" : ""}`
                                    );
                                  if (orders)
                                    parts.push(`${orders} order${orders !== 1 ? "s" : ""}`);
                                  if (errCount)
                                    parts.push(
                                      `${errCount} error${errCount !== 1 ? "s" : ""}`
                                    );
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
                </>
              )}
            </section>

            <Separator className="border-border" />

            {/* Section 4: Performance Summary */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4" aria-hidden />
                <h2 className="t-section-display">
                  Performance summary
                </h2>
              </div>
              {!perfData && !hasPnlData && displayPositions.length === 0 ? (
                <Card className="border-border bg-[var(--surface)]">
                  <CardContent className="py-8 text-center">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-label text-muted-foreground">
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
                    <p className="t-label mb-1">Total P&L</p>
                    {(() => {
                      const closedPnl = perfData?.totalPnl ?? 0;
                      const openPnl = totalPnl;
                      const combined = closedPnl + openPnl;
                      return (
                        <p
                          className={cn(
                            "t-num-lg",
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
                    <p className="t-label mb-1">Win rate</p>
                    <p className="t-num-lg text-foreground">
                      {perfData ? ((perfData.winRate ?? 0) > 0 ? `${(perfData.winRate ?? 0).toFixed(1)}%` : "N/A") : winRate !== "N/A" ? `${winRate}%` : "N/A"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-primary/40" />
                  <CardContent className="p-4 text-center">
                    <p className="t-label mb-1">Total trades</p>
                    <p className="t-num-lg text-foreground">
                      {perfData ? perfData.totalTrades : displayPositions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-primary/30" />
                  <CardContent className="p-4 text-center">
                    <p className="t-label mb-1">Active positions</p>
                    <p className="t-num-lg text-foreground">
                      {displayPositions.length}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-[var(--profit)]/60" />
                  <CardContent className="p-4 text-center">
                    <p className="t-label mb-1">Best trade</p>
                    <p className={cn("t-num-lg", perfData?.bestTrade && perfData.bestTrade.pnl > 0 ? "text-[var(--profit)]" : bestTrade && (bestTrade.pnl ?? 0) > 0 ? "text-[var(--profit)]" : "text-muted-foreground")}>
                      {perfData?.bestTrade && perfData.bestTrade.pnl > 0
                        ? `+${formatCurrency(perfData.bestTrade.pnl)}`
                        : bestTrade && (bestTrade.pnl ?? 0) > 0
                        ? `+${formatCurrency(bestTrade.pnl)}`
                        : "—"}
                    </p>
                    {((perfData?.bestTrade && perfData.bestTrade.pnl > 0) || (bestTrade && (bestTrade.pnl ?? 0) > 0)) && (
                      <p className="t-meta mt-0.5">
                        {perfData?.bestTrade?.symbol ?? bestTrade?.symbol}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border bg-[var(--surface)] overflow-hidden">
                  <div className="h-0.5 bg-[var(--loss)]/60" />
                  <CardContent className="p-4 text-center">
                    <p className="t-label mb-1">Worst trade</p>
                    <p className={cn("t-num-lg", (perfData?.worstTrade || (worstTrade && (worstTrade.pnl ?? 0) < 0)) ? "text-[var(--loss)]" : "text-muted-foreground")}>
                      {perfData?.worstTrade
                        ? formatCurrency(perfData.worstTrade.pnl)
                        : worstTrade && (worstTrade.pnl ?? 0) < 0
                        ? formatCurrency(worstTrade.pnl)
                        : "—"}
                    </p>
                    {(perfData?.worstTrade || (worstTrade && (worstTrade.pnl ?? 0) < 0)) && (
                      <p className="t-meta mt-0.5">
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

      {/* BUG-011 — confirmation modal before triggering a pipeline run.
          The pipeline places real orders and burns API budget, so an
          accidental click must not fire. When the market is closed we
          additionally warn the operator (orders will not fill; results
          only land at next open). */}
      <Dialog open={runConfirmOpen} onOpenChange={setRunConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run the pipeline now?</DialogTitle>
            <DialogDescription>
              This triggers a full screener → analyzer → signal → order
              pass and can place real orders through the broker.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const session = getMarketSession();
            const marketClosed = session === "closed" || session === "post" || session === "pre";
            if (!marketClosed) return null;
            const label =
              session === "closed"
                ? "Market is closed"
                : session === "pre"
                ? "Market is in pre-open"
                : "Market has closed for the day";
            return (
              <div
                role="alert"
                className="rounded-md border border-amber/30 bg-amber/10 p-3 text-label text-amber"
              >
                <p className="font-semibold mb-1">Warning: {label}.</p>
                <p className="text-label text-amber/90">
                  Any orders the pipeline generates will be queued until
                  the next regular session open and may not fill at the
                  prices the analyzer saw. Consider waiting until 09:30 ET.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRunConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={confirmAndRunPipeline}
              disabled={submitting}
              data-testid="pipeline-run-confirm"
            >
              {submitting ? "Starting..." : "Run pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {destructive.pending && (
        <DestructiveConfirmModal
          open={true}
          onOpenChange={(open) => !open && destructive.dismiss()}
          loading={destructive.loading}
          title={destructive.pending.title}
          description={destructive.pending.description}
          consequences={destructive.pending.consequences}
          confirmLabel={destructive.pending.confirmLabel}
          onConfirm={destructive.fire}
        />
      )}
    </DashboardPageLayout>
  );
}

/**
 * Slice-13 / SWIM-1 (2026 design brief, Datadog observability pattern):
 * 30-day pipeline run swimlane. Each cell = one calendar day, tone-coded
 * by run health. Hover for the day's headline numbers; click to scroll
 * to the corresponding row in the detail table below. Renders as a
 * single dense glance ("is the pipeline healthy?" in 1 second).
 */
function PipelineSwimlane({
  history,
  onCellClick,
}: {
  history: Array<Record<string, unknown>>;
  onCellClick: (date: string) => void;
}) {
  // Build a 30-day map keyed by ISO date so cells render in chronological
  // order regardless of how the API returned them.
  const byDate = new Map<string, Record<string, unknown>>();
  for (const h of history) {
    const d = String(h.date ?? "");
    if (d) byDate.set(d, h);
  }
  const today = new Date();
  const days: { date: string; entry: Record<string, unknown> | null }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, entry: byDate.get(iso) ?? null });
  }
  return (
    <Card className="border-border bg-[var(--surface)] overflow-hidden mb-3">
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="t-label">Last 30 days</p>
          <p className="t-meta u-muted italic">
            click a day to expand · hover for details
          </p>
        </div>
        <div className="flex gap-[3px]">
          {days.map(({ date, entry }) => {
            let tone:
              | "muted"
              | "profit"
              | "amber"
              | "loss" = "muted";
            let title = `${date} · no run`;
            if (entry) {
              const errors = Number(entry.errors ?? 0);
              const stratsRun = Number(entry.strategies_run ?? 0);
              const ordersPlaced = Number(entry.orders_placed ?? 0);
              if (errors === 0 && stratsRun > 0) {
                tone = "profit";
              } else if (errors > 0 && stratsRun > 0) {
                tone = "amber";
              } else if (errors > 0) {
                tone = "loss";
              }
              title = `${date} · ${stratsRun} strategies run · ${ordersPlaced} orders · ${errors} errors`;
            }
            const bg =
              tone === "profit"
                ? "bg-[color:var(--profit)]/65"
                : tone === "amber"
                  ? "bg-[color:var(--state-warning,#d97706)]/65"
                  : tone === "loss"
                    ? "bg-[color:var(--loss)]/65"
                    : "bg-[color:var(--border)]/40";
            return (
              <button
                type="button"
                key={date}
                onClick={() => entry && onCellClick(date)}
                title={title}
                aria-label={title}
                disabled={!entry}
                className={cn(
                  "flex-1 h-10 rounded-sm transition-opacity",
                  bg,
                  entry
                    ? "hover:opacity-100 opacity-85 cursor-pointer"
                    : "cursor-default opacity-50",
                )}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 t-meta u-muted">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-[color:var(--profit)]/65" />
            clean
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-[color:var(--state-warning,#d97706)]/65" />
            partial
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-[color:var(--loss)]/65" />
            failed
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-[color:var(--border)]/40" />
            no run
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
