"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  getTradingAgentsRun,
  getTradingAgentsRuns,
  startTradingAgentsRun,
  type TradingAgentsRun,
} from "@/lib/api";

// T12: replaces AgentsDebateStub with a live section that queries the
// existing /tradingagents/runs endpoints. Runs are async and expensive
// (uses Anthropic credits + ~30s wall time) so we never auto-trigger —
// the user clicks "Run debate" / "Run new debate" explicitly. The POST
// returns 202 with status="queued"; we then poll GET /runs/{id} every
// 5s until "succeeded" / "failed", capped at 60s.

const RUNS_QUERY_KEY = "tradingagents-runs-by-symbol";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;
const PUBLIC_SYMBOL_DATA_OPTIONS = {
  suppressAuthRedirect: true,
  suppressGlobalError: true,
} as const;

export interface AgentsDebateCardProps {
  symbol: string;
  isETF: boolean;
}

interface RunDisplayProps {
  run: TradingAgentsRun;
}

interface SignalTone {
  text: string;
  bg: string;
  border: string;
}

interface DerivedLevel {
  value: string;
  label: string;
}

const SIGNAL_WORDS = [
  "OVERWEIGHT",
  "UNDERWEIGHT",
  "NEUTRAL",
  "HOLD",
  "BUY",
  "SELL",
  "REDUCE",
  "ACCUMULATE",
];

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value: string): string {
  return stripMarkdown(value.replace(/^\s*[-*]\s*/, "").replace(/^\|/, "").replace(/\|$/, ""));
}

function isBareLabelLine(value: string): boolean {
  return /^[A-Za-z][A-Za-z /&-]{2,}:$/.test(value.trim());
}

function extractSignal(decisionText: string, summary: string[]): string {
  const ratingMatch =
    decisionText.match(/RATING:\s*\**([A-Za-z][A-Za-z /_-]{1,40})\**/i) ||
    decisionText.match(/\b(Overweight|Underweight|Neutral|Hold|Buy|Sell|Reduce|Accumulate)\b/i);
  if (ratingMatch) return stripMarkdown(ratingMatch[1]).toUpperCase();

  const summarySignal = summary
    .map((line) => stripMarkdown(line))
    .find((line) => SIGNAL_WORDS.includes(line.toUpperCase()));
  return summarySignal?.toUpperCase() ?? "PENDING";
}

function signalTone(signal: string): SignalTone {
  const normalized = signal.toLowerCase();
  if (normalized.includes("overweight") || normalized === "buy" || normalized.includes("accumulate")) {
    return { text: "text-up-500", bg: "bg-up-500/10", border: "border-up-500/40" };
  }
  if (normalized.includes("underweight") || normalized === "sell" || normalized.includes("reduce")) {
    return { text: "text-down-500", bg: "bg-down-500/10", border: "border-down-500/40" };
  }
  return { text: "text-fg", bg: "bg-bg", border: "border-border-hair" };
}

function extractHighlights(summary: string[], decisionText: string, signal: string): string[] {
  const useful = summary
    .map(cleanLine)
    .filter((line) => line && line.toLowerCase() !== signal.toLowerCase())
    .filter((line) => !isBareLabelLine(line));
  if (useful.length >= 3) return useful.slice(0, 5);

  const markers = [
    "current price",
    "time horizon",
    "preferred entry",
    "position sizing",
    "resistance",
    "support",
    "stop",
    "target",
    "trim",
  ];
  const lines = decisionText
    .split(/\n+/)
    .map(cleanLine)
    .filter(
      (line) =>
        line.length > 16 &&
        !isBareLabelLine(line) &&
        markers.some((marker) => line.toLowerCase().includes(marker)),
    );
  return Array.from(new Set([...useful, ...lines])).slice(0, 5);
}

function extractLevels(text: string): DerivedLevel[] {
  const seen = new Set<string>();
  const out: DerivedLevel[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = cleanLine(rawLine);
    if (!line || !line.includes("$")) continue;
    const matches = line.match(/\$[0-9][0-9,.]*(?:\s*(?:-|–)\s*\$?[0-9][0-9,.]*)?/g);
    if (!matches) continue;
    for (const match of matches) {
      const value = match.replace(/\s+/g, "").replace(/[.,;:)]+$/g, "");
      if (seen.has(value)) continue;
      seen.add(value);
      const lower = line.toLowerCase();
      // Roughly classify the surrounding clause; the source memo isn't
      // structured, so this is heuristic but matches the sibling
      // /strategies/trading-agents-research treatment.
      let label = "Referenced level";
      if (lower.includes("current price")) label = "Current price";
      else if (lower.includes("support") || lower.includes("entry")) label = "Support / entry";
      else if (lower.includes("resistance") || lower.includes("trim")) label = "Resistance / trim";
      else if (lower.includes("stop")) label = "Stop";
      else if (lower.includes("target")) label = "Target";
      out.push({ value, label });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function isTerminal(status: TradingAgentsRun["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

function RunDisplay({ run }: RunDisplayProps) {
  const decisionText = run.decision_text?.trim() ?? "";
  const summary = run.summary_lines ?? [];
  const signal = useMemo(() => extractSignal(decisionText, summary), [decisionText, summary]);
  const tone = useMemo(() => signalTone(signal), [signal]);
  const highlights = useMemo(
    () => extractHighlights(summary, decisionText, signal),
    [summary, decisionText, signal],
  );
  const levels = useMemo(() => extractLevels(decisionText), [decisionText]);

  return (
    <div data-slot="run-display" className="mt-3">
      <div
        data-slot="verdict-pill"
        className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1 ${tone.border} ${tone.bg}`}
      >
        <span className={`t-mono text-eyebrow font-semibold uppercase ${tone.text}`}>{signal}</span>
        <span className="t-mono text-eyebrow u-muted">
          {run.trade_date ?? "no date"}
          {run.status !== "succeeded" ? ` · ${run.status}` : ""}
        </span>
      </div>

      {highlights.length > 0 ? (
        <ul data-slot="highlights" className="mt-3 space-y-1.5">
          {highlights.map((line, index) => (
            <li
              key={`${line}-${index}`}
              className="flex gap-2 text-body-sm leading-relaxed"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
              <span className="min-w-0 break-words">{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        decisionText && (
          <p data-slot="decision-snippet" className="mt-3 text-body-sm leading-relaxed u-muted">
            {decisionText.slice(0, 240)}
            {decisionText.length > 240 ? "…" : ""}
          </p>
        )
      )}

      {levels.length > 0 && (
        <div data-slot="levels-grid" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {levels.map((level) => (
            <div
              key={`${level.value}-${level.label}`}
              data-slot="level-cell"
              className="rounded-sm border border-border-hair bg-bg p-2"
            >
              <p className="t-mono text-body-sm font-semibold tabular-nums">{level.value}</p>
              <p className="t-mono text-eyebrow u-muted">{level.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentsDebateCard({ symbol, isETF }: AgentsDebateCardProps) {
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pollExpired, setPollExpired] = useState(false);

  const runsQuery = useQuery({
    queryKey: [RUNS_QUERY_KEY, symbol],
    // Backend list endpoint doesn't take a symbol param; filter client-side.
    queryFn: async () => {
      const all = await getTradingAgentsRuns(20, PUBLIC_SYMBOL_DATA_OPTIONS);
      const norm = symbol.toUpperCase();
      return all.filter((r) => (r.symbol ?? "").toUpperCase() === norm);
    },
    staleTime: 60_000,
    // ETFs aren't covered by the trading-agents universe; we early-return
    // null below, but disable the query here to skip the network call too.
    enabled: Boolean(symbol) && !isETF,
  });

  // Track an in-flight run by id so we can poll it. The poll query is
  // separate from the list query so we don't refetch the whole list
  // every 5s while a single run is cooking.
  const pollQuery = useQuery({
    queryKey: ["tradingagents-run-poll", runningId],
    queryFn: () => getTradingAgentsRun(runningId as string, PUBLIC_SYMBOL_DATA_OPTIONS),
    enabled: Boolean(runningId) && !pollExpired,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
  });

  const startMutation = useMutation({
    mutationFn: () => startTradingAgentsRun({ symbol }),
    onSuccess: (run) => {
      setPollExpired(false);
      // Seed the cache so the verdict pill flips to "queued"/"running"
      // immediately instead of waiting on the first refetch.
      queryClient.setQueryData([RUNS_QUERY_KEY, symbol], (prev: TradingAgentsRun[] | undefined) => {
        const without = (prev ?? []).filter((r) => r.run_id !== run.run_id);
        return [run, ...without];
      });
      if (!isTerminal(run.status)) {
        setRunningId(run.run_id);
      } else {
        runsQuery.refetch();
      }
    },
  });

  useEffect(() => {
    if (runningId || pollExpired) return;
    const activeRun = runsQuery.data?.find((run) => !isTerminal(run.status));
    if (activeRun) {
      setRunningId(activeRun.run_id);
    }
  }, [pollExpired, runningId, runsQuery.data]);

  // When the polled run reaches a terminal state, fold it back into the
  // list cache and stop polling. Defer the setState to a microtask so
  // we don't trigger a cascading render inside the effect (lint rule
  // react-hooks/set-state-in-effect).
  useEffect(() => {
    const polled = pollQuery.data;
    if (!polled) return;
    if (!isTerminal(polled.status)) return;
    queryClient.setQueryData([RUNS_QUERY_KEY, symbol], (prev: TradingAgentsRun[] | undefined) => {
      const without = (prev ?? []).filter((r) => r.run_id !== polled.run_id);
      return [polled, ...without];
    });
    queueMicrotask(() => setRunningId(null));
  }, [pollQuery.data, queryClient, symbol]);

  // Hard cap on polling so a hung backend doesn't keep us hammering forever.
  useEffect(() => {
    if (!runningId) return;
    const t = window.setTimeout(() => setPollExpired(true), POLL_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [runningId]);

  // ETFs aren't covered by the trading-agents universe; hide entirely.
  // The hooks above all early-out on `isETF` (disabled queries, no
  // mutation triggers), so this returns null without leaving stale
  // network state behind.
  if (isETF) return null;

  const liveRun = pollQuery.data ?? null;
  const cachedRuns = runsQuery.data ?? [];
  const latestRun: TradingAgentsRun | null =
    liveRun ?? (cachedRuns.length > 0 ? cachedRuns[0] : null);
  const isPolling = Boolean(runningId) && !pollExpired;
  const isPending = startMutation.isPending || isPolling;

  let buttonLabel: string;
  if (startMutation.isPending) buttonLabel = "Starting…";
  else if (isPolling) buttonLabel = "Running…";
  else buttonLabel = latestRun ? "Run new debate" : "Run debate";

  return (
    <section
      id="agents"
      data-testid="agents-debate-card"
      data-slot="agents-debate-card"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-label u-muted">AGENTS DEBATE</h2>
        <Button
          variant="outline"
          size="sm"
          data-testid="agents-debate-run-button"
          onClick={() => startMutation.mutate()}
          disabled={isPending}
        >
          {buttonLabel}
        </Button>
      </header>

      {runsQuery.isLoading ? (
        <div data-slot="loading" className="mt-4 h-32 rounded-sm bg-bg" />
      ) : startMutation.isError ? (
        <p data-slot="error" className="mt-4 t-mono text-label text-down-500">
          {startMutation.error instanceof Error
            ? startMutation.error.message
            : "Failed to start debate."}
        </p>
      ) : pollExpired && !liveRun ? (
        <p data-slot="poll-expired" className="mt-4 t-mono text-label u-muted">
          Debate is still running. Refresh in a moment to see results.
        </p>
      ) : latestRun ? (
        <RunDisplay run={latestRun} />
      ) : (
        <p data-slot="empty" className="mt-4 t-mono text-label u-muted">
          No debate run for {symbol} yet. Click &quot;Run debate&quot; to start one. Each run takes
          ~30s and uses Anthropic credits.
        </p>
      )}
    </section>
  );
}

export default AgentsDebateCard;
