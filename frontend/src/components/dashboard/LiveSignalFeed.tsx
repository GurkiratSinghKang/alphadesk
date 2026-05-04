"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Radio, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMarketStore, useQuotes } from "@/stores/market";
import { getPipelineHistory, getPipelineRun, type PipelineRun, type PipelineAnalysis } from "@/lib/api";
import { STRATEGY_META } from "@/lib/strategies";
import type { Quote } from "@/types";

// ─── Types ───────────────────────────────────────────────────

export interface Signal {
  id: string;
  timestamp: Date;
  type: "buy" | "sell" | "watch" | "alert";
  symbol: string;
  strategy: string;
  reasoning: string;
  confidence: number;
}

// ─── Constants ───────────────────────────────────────────────

const COLLAPSED_COUNT = 5;
const EXPANDED_COUNT = 20;
const REFRESH_INTERVAL_MS = 60_000;

const TYPE_BORDER: Record<Signal["type"], string> = {
  buy: "border-l-profit",
  sell: "border-l-loss",
  watch: "border-l-amber",
  alert: "border-l-ice",
};

const TYPE_BADGE_CLASS: Record<Signal["type"], string> = {
  buy: "bg-profit/15 text-profit border-profit/30",
  sell: "bg-loss/15 text-loss border-loss/30",
  watch: "bg-amber/15 text-amber border-amber/30",
  alert: "bg-ice/15 text-ice border-ice/30",
};

// ─── Helpers ─────────────────────────────────────────────────

function humanizeStrategyId(id: string): string {
  const meta = STRATEGY_META[id];
  if (meta) return meta.shortName;
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── Signal Extraction ──────────────────────────────────────

/** Extract signals from a pipeline run (analyzed stocks, rejections) */
function extractPipelineSignals(run: PipelineRun): Signal[] {
  const signals: Signal[] = [];
  const ts = run.timestamp ? new Date(run.timestamp) : new Date();

  // From analyzed stocks — each has a signal and conviction
  if (Array.isArray(run.analyzed)) {
    for (const a of run.analyzed as PipelineAnalysis[]) {
      const signalLower = (a.signal ?? "").toLowerCase();
      let type: Signal["type"] = "watch";
      if (signalLower === "buy" || signalLower === "long" || signalLower === "bullish") type = "buy";
      else if (signalLower === "sell" || signalLower === "short" || signalLower === "bearish") type = "sell";
      else if (signalLower === "hold" || signalLower === "watch" || signalLower === "neutral") type = "watch";

      signals.push({
        id: `pipeline-analysis-${a.symbol}-${run.date}`,
        timestamp: ts,
        type,
        symbol: a.symbol,
        strategy: "Pipeline Analysis",
        reasoning: a.rationale || `Signal: ${a.signal}, conviction ${a.conviction}%`,
        confidence: Math.min(100, Math.max(0, a.conviction ?? 50)),
      });
    }
  }

  // From master agent rejections
  const master = run.master_agent ?? {};
  const rejections = Array.isArray(master.rejections) ? master.rejections : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(typed-api): rejection shape; type via FastAPI codegen
  for (const r of rejections as any[]) {
    signals.push({
      id: `pipeline-rejection-${r.symbol}-${r.strategy}-${run.date}`,
      timestamp: ts,
      type: "alert",
      symbol: r.symbol ?? "???",
      strategy: humanizeStrategyId(r.strategy ?? "risk-manager"),
      reasoning: `Rejected: ${r.reason ?? "Risk threshold exceeded"}${r.remediation ? ` — ${r.remediation}` : ""}`,
      confidence: 0,
    });
  }

  // From per-strategy breakdown — look for strategies that generated candidates
  const strats = run.strategies ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(typed-api): strategy result shape; type via FastAPI codegen
  for (const [stratId, data] of Object.entries(strats) as [string, any][]) {
    const requested = data.trades_requested ?? 0;
    const approved = data.trades_approved ?? 0;
    if (requested > 0 && approved > 0) {
      // Don't duplicate if already covered by analyzed signals
      const alreadyCovered = signals.some(
        (s) => s.id.startsWith("pipeline-analysis-") && s.strategy === "Pipeline Analysis"
      );
      if (!alreadyCovered) {
        signals.push({
          id: `pipeline-strategy-${stratId}-${run.date}`,
          timestamp: ts,
          type: "buy",
          symbol: `${approved} trades`,
          strategy: humanizeStrategyId(stratId),
          reasoning: `${data.screened ?? 0} screened, ${data.analyzed ?? 0} analyzed, ${approved}/${requested} approved`,
          confidence: requested > 0 ? Math.round((approved / requested) * 100) : 0,
        });
      }
    }
  }

  return signals;
}

/** Generate intraday signals from watchlist quote data */
function generateWatchlistSignals(quotes: Record<string, Quote>): Signal[] {
  const signals: Signal[] = [];
  const now = new Date();

  for (const [symbol, q] of Object.entries(quotes)) {
    if (!q || !q.close || q.close <= 0) continue;

    const changePct = q.changePct ?? ((q.last - q.close) / q.close) * 100;
    const gapPct = q.open && q.close ? ((q.open - q.close) / q.close) * 100 : 0;

    // Stock drops >3% → WATCH signal
    if (changePct <= -3) {
      signals.push({
        id: `intraday-drop-${symbol}`,
        timestamp: now,
        type: "watch",
        symbol,
        strategy: "Intraday Scan",
        reasoning: `Down ${changePct.toFixed(1)}% today — approaching oversold territory`,
        confidence: Math.min(80, Math.round(Math.abs(changePct) * 10)),
      });
    }

    // RSI proxy: if the stock is down significantly with high volume relative to the range
    // Simple proxy: price near the low of the day with > 3% decline
    if (changePct <= -5 && q.last <= q.low * 1.005) {
      signals.push({
        id: `intraday-rsi-${symbol}`,
        timestamp: now,
        type: "buy",
        symbol,
        strategy: "Intraday Scan",
        reasoning: `RSI proxy triggered: ${changePct.toFixed(1)}% decline, trading near day low`,
        confidence: Math.min(85, Math.round(Math.abs(changePct) * 12)),
      });
    }

    // Gap up >5% → ALERT signal
    if (gapPct >= 5) {
      signals.push({
        id: `intraday-gap-${symbol}`,
        timestamp: now,
        type: "alert",
        symbol,
        strategy: "Intraday Scan",
        reasoning: `Gapped up ${gapPct.toFixed(1)}% at open — unusual activity`,
        confidence: Math.min(75, Math.round(gapPct * 8)),
      });
    }

    // Strong mover up >5% → ALERT
    if (changePct >= 5) {
      signals.push({
        id: `intraday-surge-${symbol}`,
        timestamp: now,
        type: "alert",
        symbol,
        strategy: "Intraday Scan",
        reasoning: `Up ${changePct.toFixed(1)}% today — strong momentum`,
        confidence: Math.min(70, Math.round(changePct * 8)),
      });
    }
  }

  return signals;
}

// ─── Signal Card Component ──────────────────────────────────

const SignalCard = React.memo(function SignalCard({
  signal,
  index,
}: {
  signal: Signal;
  index: number;
}) {
  const router = useRouter();
  const isNew = Date.now() - signal.timestamp.getTime() < 5 * 60 * 1000;

  const handleView = useCallback(() => {
    useMarketStore.getState().setSelectedSymbol(signal.symbol);
    router.push("/trade");
  }, [signal.symbol, router]);

  // Don't render "View" for aggregate signals like "3 trades"
  const isViewable = !signal.symbol.includes(" ");

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-l-2 bg-[var(--panel)] px-3 py-2 transition-all card-stagger",
        TYPE_BORDER[signal.type],
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {isNew && (
        <span className="relative flex h-2 w-2 mt-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("text-label px-1.5 py-0 h-4 uppercase tracking-wider font-semibold", TYPE_BADGE_CLASS[signal.type])}
          >
            {signal.type}
          </Badge>
          <span className="font-medium text-sm text-foreground">{signal.symbol}</span>
          <span className="text-label text-muted-foreground truncate">{signal.strategy}</span>
        </div>
        <p className="text-label text-muted-foreground mt-0.5 truncate" title={signal.reasoning}>
          {signal.reasoning}
        </p>
        {signal.confidence > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <div className="h-1 flex-1 rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  signal.confidence >= 70 ? "bg-profit" :
                  signal.confidence >= 40 ? "bg-amber" :
                  "bg-loss"
                )}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
            <span className="text-label text-muted-foreground tabular-nums w-7 text-right">
              {signal.confidence}%
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-label text-muted-foreground tabular-nums">
          {relativeTime(signal.timestamp)}
        </span>
        {isViewable && (
          <button
            onClick={handleView}
            className="text-label text-primary hover:underline"
          >
            View
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Live Signal Feed Panel ─────────────────────────────────

interface LiveSignalFeedProps {
  /** Pre-loaded pipeline log data from the dashboard (avoids duplicate fetch) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(typed-api): pipeline log shape; type via FastAPI codegen
  pipelineLog?: Record<string, any> | null;
}

export function LiveSignalFeed({ pipelineLog }: LiveSignalFeedProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const hasFetched = useRef(false);

  // Build signals from pipeline data + watchlist quotes
  // Note: reads quotes from store directly (not via dependency) to avoid
  // recreating this callback on every WebSocket tick, which would reset
  // the 60-second refresh interval.
  const buildSignals = useCallback(async () => {
    const allSignals: Signal[] = [];

    // 1. Pipeline signals — use pre-loaded data or fetch fresh
    try {
      if (pipelineLog) {
        // Build a minimal PipelineRun from the pre-loaded log data
        const run: PipelineRun = {
          date: pipelineLog.date ?? "",
          timestamp: pipelineLog.timestamp ?? new Date().toISOString(),
          screened: [],
          analyzed: pipelineLog.analyzed ?? [],
          signals: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(typed-api): order shape; type via FastAPI codegen
          ordersPlaced: (pipelineLog.orders_placed ?? []).map((o: any) => ({
            symbol: o.symbol, side: o.side, qty: o.qty,
            price: o.price, orderId: o.order_id ?? "", status: "", timestamp: o.timestamp ?? "",
          })),
          ordersClosed: [],
          portfolioSnapshot: { equity: 0, cash: 0, positions: 0 },
          errors: pipelineLog.errors ?? [],
          strategies: pipelineLog.strategies_run ?? {},
          master_agent: pipelineLog.master_agent ?? {},
        };
        allSignals.push(...extractPipelineSignals(run));
      } else {
        // Fetch pipeline history and get the latest run
        const history = await getPipelineHistory();
        if (Array.isArray(history) && history.length > 0) {
          const latestDate = history[0]?.date;
          if (latestDate) {
            try {
              const fullRun = await getPipelineRun(latestDate);
              allSignals.push(...extractPipelineSignals(fullRun));
            } catch {
              // Use summary data
            }
          }
        }
      }
    } catch {
      // Pipeline data unavailable — continue with watchlist signals
    }

    // 2. Watchlist-derived intraday signals — read quotes directly from store
    const currentQuotes = useMarketStore.getState().quotes;
    const watchlistSignals = generateWatchlistSignals(currentQuotes);
    allSignals.push(...watchlistSignals);

    // Deduplicate by id and sort by timestamp descending
    const seen = new Set<string>();
    const deduped = allSignals.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    setSignals(deduped);
    setLastRefresh(new Date());
    setIsLoading(false);
  }, [pipelineLog]);

  // Initial fetch
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    buildSignals();
  }, [buildSignals]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      buildSignals();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [buildSignals]);

  // Also rebuild when quotes change (for watchlist signals).
  // Wave 14 perf-audit-r3 P0 #3: scoped to the watchlist via `useQuotes`, so
  // unrelated ticks (e.g. a stream of symbols not on the watchlist) no
  // longer kick this effect. The debounce remains in place.
  const watchlist = useMarketStore((s) => s.watchlist);
  const quotes = useQuotes(watchlist);
  const quotesRef = useRef(quotes);
  useEffect(() => {
    if (quotesRef.current !== quotes && hasFetched.current) {
      quotesRef.current = quotes;
      // Debounce quote updates — don't rebuild on every tick
      const timer = setTimeout(() => {
        buildSignals();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [quotes, buildSignals]);

  const visibleSignals = useMemo(
    () => signals.slice(0, expanded ? EXPANDED_COUNT : COLLAPSED_COUNT),
    [signals, expanded],
  );

  const hasMore = signals.length > COLLAPSED_COUNT;
  const newCount = signals.filter((s) => Date.now() - s.timestamp.getTime() < 5 * 60 * 1000).length;

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            Live Signal Feed
          </h2>
          {newCount > 0 && (
            <Badge variant="outline" className="text-label border-primary/30 text-primary">
              {newCount} new
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-label text-muted-foreground tabular-nums">
              {relativeTime(lastRefresh)}
            </span>
          )}
          <button
            onClick={() => buildSignals()}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-[var(--surface)] transition-colors"
            title="Refresh signals"
            aria-label="Refresh signals"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className={expanded ? "max-h-[600px]" : "max-h-[340px]"}>
        <div className="space-y-1 p-3">
          {isLoading ? (
            <div className="space-y-2 py-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 animate-pulse">
                  <div className="h-4 w-10 rounded bg-muted-foreground/20 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-muted-foreground/20" />
                    <div className="h-2.5 w-1/2 rounded bg-muted-foreground/10" />
                    <div className="h-1 w-full rounded bg-muted-foreground/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Radio className="h-6 w-6 mb-2 opacity-30 text-muted-foreground" />
              <p className="text-label text-muted-foreground">No signals yet.</p>
              <p className="text-label text-muted-foreground mt-1">
                Signals appear after pipeline runs or when watchlist stocks cross thresholds.
              </p>
              <button
                onClick={() => router.push("/pipeline")}
                className="mt-2 text-label text-[var(--primary)] hover:underline"
              >
                Run pipeline &rarr;
              </button>
            </div>
          ) : (
            visibleSignals.map((signal, i) => (
              <SignalCard key={signal.id} signal={signal} index={i} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer — View All / Collapse */}
      {hasMore && !isLoading && (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center justify-center gap-1 text-label text-primary hover:underline"
          >
            {expanded ? (
              <>
                Show Less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                View All ({signals.length}) <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
