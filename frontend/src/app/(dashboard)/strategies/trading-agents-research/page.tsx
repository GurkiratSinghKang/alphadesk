"use client";

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Buildings,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  Clock,
  FileText,
  Files,
  Gauge,
  Newspaper,
  Play,
  Pulse,
  Scales,
  ShieldCheck,
  Target,
  TrendDown,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";

import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import {
  getTradingAgentsRun,
  getTradingAgentsRuns,
  getTradingAgentsRuntimeStatus,
  startTradingAgentsRun,
  type TradingAgentsRun,
  type TradingAgentsRuntimeStatus,
  type TradingAgentsRunStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "", label: "System default" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "openrouter", label: "OpenRouter" },
];
const DEFAULT_ANALYSTS = ["market", "social", "news", "fundamentals"];
const SIGNAL_WORDS = ["OVERWEIGHT", "UNDERWEIGHT", "NEUTRAL", "HOLD", "BUY", "SELL", "REDUCE", "ACCUMULATE"];
const THIN_MEMO_WORDS = new Set(SIGNAL_WORDS.map((word) => word.toLowerCase()));

type IconType = React.ComponentType<{ className?: string; weight?: "regular" | "bold" | "fill" | "duotone" }>;
type MemoSection = { title: string; body: string };
type LevelItem = { label: string; value: string };
type LevelTone = "current" | "resistance" | "support" | "stop" | "target" | "reference";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatStamp(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(started: string | null, completed: string | null, updated: string) {
  const startMs = started ? Date.parse(started) : Number.NaN;
  const endMs = Date.parse(completed || updated);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "-";
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatTimeout(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value: string) {
  return stripMarkdown(value.replace(/^\s*[-*]\s*/, "").replace(/^\|/, "").replace(/\|$/, ""));
}

function truncate(value: string, max = 460) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
}

function splitMemoSections(text: string): MemoSection[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sections: MemoSection[] = [];
  const matches = Array.from(trimmed.matchAll(/^##\s+(.+)$/gm));
  if (!matches.length) {
    return [{ title: "Decision memo", body: trimmed }];
  }
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? trimmed.length : trimmed.length;
    const title = cleanLine(match[1]);
    const body = trimmed.slice(start, end).trim();
    if (title && body) sections.push({ title, body });
  });
  return sections;
}

function findMemoSection(sections: MemoSection[], needles: string[]) {
  return sections.find((section) =>
    needles.some((needle) => section.title.toLowerCase().includes(needle.toLowerCase())),
  );
}

function extractSubsection(text: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\n)###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|\\n##\\s+|$)`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() ?? "";
}

function extractSignal(decisionText: string, summary: string[]) {
  const ratingMatch =
    decisionText.match(/RATING:\s*\**([A-Za-z][A-Za-z /_-]{1,40})\**/i) ||
    decisionText.match(/\b(Overweight|Underweight|Neutral|Hold|Buy|Sell|Reduce|Accumulate)\b/i);
  if (ratingMatch) return stripMarkdown(ratingMatch[1]).toUpperCase();

  const summarySignal = summary
    .map((line) => stripMarkdown(line))
    .find((line) => SIGNAL_WORDS.includes(line.toUpperCase()));
  return summarySignal?.toUpperCase() ?? "PENDING";
}

function signalTone(signal: string) {
  const normalized = signal.toLowerCase();
  if (normalized.includes("overweight") || normalized === "buy" || normalized.includes("accumulate")) {
    return {
      text: "text-profit",
      bg: "bg-profit/10",
      border: "border-profit/40",
      soft: "bg-profit/5",
    };
  }
  if (normalized.includes("underweight") || normalized === "sell" || normalized.includes("reduce")) {
    return {
      text: "text-loss",
      bg: "bg-loss/10",
      border: "border-loss/40",
      soft: "bg-loss/5",
    };
  }
  return {
    text: "text-brand",
    bg: "bg-brand/10",
    border: "border-brand/40",
    soft: "bg-brand/5",
  };
}

function isThinMemo(text: string, summary: string[]) {
  const clean = stripMarkdown(text).toLowerCase();
  if (!clean) return true;
  if (clean.length <= 40 && THIN_MEMO_WORDS.has(clean)) return true;
  return clean.length <= 80 && summary.length <= 1;
}

function extractHighlights(summary: string[], decisionText: string, signal: string) {
  const useful = summary
    .map(cleanLine)
    .filter((line) => line && line.toLowerCase() !== signal.toLowerCase());
  if (useful.length >= 3) return useful.slice(0, 6);

  const markers = [
    "current price",
    "time horizon",
    "currently long",
    "currently flat",
    "preferred entry",
    "position sizing",
    "resistance",
    "support",
    "stop",
    "target",
    "trim",
    "do not initiate",
  ];
  const lines = decisionText
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line.length > 16 && markers.some((marker) => line.toLowerCase().includes(marker)));
  return Array.from(new Set([...useful, ...lines])).slice(0, 6);
}

function extractDollarLevels(text: string): LevelItem[] {
  const seen = new Set<string>();
  const levels: LevelItem[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = cleanLine(rawLine);
    if (!line || !line.includes("$")) continue;
    const matches = line.match(/\$[0-9][0-9,.]*(?:\s*(?:-|\u2013)\s*\$?[0-9][0-9,.]*)?/g);
    if (!matches) continue;
    for (const match of matches) {
      const value = match.replace(/\s+/g, "").replace(/[.,;:)]+$/g, "");
      if (seen.has(value)) continue;
      seen.add(value);
      const start = line.indexOf(match);
      const context = start >= 0
        ? line.slice(Math.max(0, start - 40), Math.min(line.length, start + match.length + 40))
        : line;
      const before = start >= 0 ? line.slice(Math.max(0, start - 44), start) : "";
      const after = start >= 0 ? line.slice(start + match.length, Math.min(line.length, start + match.length + 44)) : "";
      levels.push({ value, label: levelLabel(context, value, before, after) });
      if (levels.length >= 6) return levels;
    }
  }
  return levels;
}

function levelTone(label: string): LevelTone {
  const lower = label.toLowerCase();
  if (lower.includes("current")) return "current";
  if (lower.includes("resistance") || lower.includes("trim")) return "resistance";
  if (lower.includes("support") || lower.includes("entry")) return "support";
  if (lower.includes("stop")) return "stop";
  if (lower.includes("target")) return "target";
  return "reference";
}

function levelLabel(context: string, value: string, before = "", after = "") {
  const clean = context
    .replace(/\$[0-9][0-9,.]*(?:\s*(?:-|\u2013)\s*\$?[0-9][0-9,.]*)?/g, "")
    .replace(/\s+/g, " ")
    .replace(/[*:_|]+/g, " ")
    .trim();
  const lower = context.toLowerCase();
  const beforeLower = before.toLowerCase();
  const afterLower = after.toLowerCase();
  if (lower.includes("current price")) return "Current price reference";
  if (afterLower.includes("support") || afterLower.includes("entry")) return "Support / entry window";
  if (afterLower.includes("resistance") || afterLower.includes("trim")) return "Resistance / trim zone";
  if (afterLower.includes("stop") || beforeLower.includes("stop")) return "Risk stop";
  if (afterLower.includes("target") || beforeLower.includes("target")) return "Target zone";
  if (beforeLower.includes("support") || beforeLower.includes("entry")) return "Support / entry window";
  if (beforeLower.includes("resistance") || beforeLower.includes("trim")) return "Resistance / trim zone";
  return truncate(clean || `Referenced level ${value}`, 86);
}

function levelToneClass(tone: LevelTone) {
  if (tone === "resistance" || tone === "stop") return "border-loss/35 bg-loss/10";
  if (tone === "support" || tone === "target") return "border-profit/30 bg-profit/10";
  if (tone === "current") return "border-brand/35 bg-brand/10";
  return "border-border-hair bg-bg-card";
}

function statusClass(status: TradingAgentsRunStatus) {
  if (status === "succeeded") return "text-profit";
  if (status === "failed") return "text-loss";
  if (status === "running") return "text-brand";
  return "text-fg-muted";
}

function renderStatusIcon(status: TradingAgentsRunStatus, className?: string) {
  const iconClassName = cn(className);
  if (status === "succeeded") return <CheckCircle className={iconClassName} weight="bold" />;
  if (status === "failed") return <WarningCircle className={iconClassName} weight="bold" />;
  if (status === "running") return <ArrowClockwise className={iconClassName} weight="bold" />;
  return <ShieldCheck className={iconClassName} weight="bold" />;
}

function analystLabel(value: string) {
  if (value === "market") return "Market";
  if (value === "social") return "Social";
  if (value === "news") return "News";
  if (value === "fundamentals") return "Fundamentals";
  return value;
}

export default function TradingAgentsResearchPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [tradeDate, setTradeDate] = useState(todayIso);
  const [provider, setProvider] = useState("");
  const [researchDepth, setResearchDepth] = useState(1);
  const [analysts, setAnalysts] = useState<string[]>(DEFAULT_ANALYSTS);
  const [deepModel, setDeepModel] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [reason, setReason] = useState("");
  const [runs, setRuns] = useState<TradingAgentsRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<TradingAgentsRun | null>(null);
  const [runtime, setRuntime] = useState<TradingAgentsRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStatus = selectedRun?.status ?? null;
  const isActiveRun = selectedStatus === "queued" || selectedStatus === "running";
  const canStartRun = runtime?.ready !== false;

  const refreshRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getTradingAgentsRuns(20);
      setRuns(rows);
      if (!selectedRunId && rows[0]) {
        setSelectedRunId(rows[0].run_id);
        setSelectedRun(rows[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load TradingAgents runs");
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  const refreshRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    try {
      setRuntime(await getTradingAgentsRuntimeStatus());
    } catch (err) {
      setRuntime(null);
      setError(err instanceof Error ? err.message : "Failed to load TradingAgents runtime");
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    let cancelled = false;
    async function loadSelected() {
      try {
        const run = await getTradingAgentsRun(selectedRunId as string);
        if (cancelled) return;
        setSelectedRun(run);
        setRuns((prev) => {
          const without = prev.filter((item) => item.run_id !== run.run_id);
          return [run, ...without].sort(
            (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
          );
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load run");
        }
      }
    }
    loadSelected();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !isActiveRun) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const run = await getTradingAgentsRun(selectedRunId);
        if (cancelled) return;
        setSelectedRun(run);
        setRuns((prev) => {
          const without = prev.filter((item) => item.run_id !== run.run_id);
          return [run, ...without];
        });
      } catch {
        // Keep the last visible run. The shared API layer handles the toast.
      }
    };
    const timer = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedRunId, isActiveRun]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const run = await startTradingAgentsRun({
        symbol,
        trade_date: tradeDate,
        provider: provider || null,
        deep_model: deepModel || null,
        quick_model: quickModel || null,
        analysts,
        research_depth: researchDepth,
        reason: reason || null,
      });
      setRuns((prev) => [run, ...prev.filter((item) => item.run_id !== run.run_id)]);
      setSelectedRunId(run.run_id);
      setSelectedRun(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start TradingAgents");
    } finally {
      setSubmitting(false);
    }
  };

  const actions = (
    <span className="inline-flex items-center gap-2 rounded-pill border border-border px-3 py-1 t-label text-fg-muted">
      <ShieldCheck className="h-3.5 w-3.5" weight="bold" />
      READ-ONLY
    </span>
  );

  return (
    <DashboardPageLayout
      eyebrow="RESEARCH"
      title="TradingAgents Research"
      actions={actions}
      pageLabel="TradingAgents research"
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="order-2 flex flex-col gap-4 xl:order-1">
          <RunForm
            analysts={analysts}
            canStartRun={canStartRun}
            deepModel={deepModel}
            provider={provider}
            quickModel={quickModel}
            reason={reason}
            researchDepth={researchDepth}
            runtime={runtime}
            setAnalysts={setAnalysts}
            setDeepModel={setDeepModel}
            setProvider={setProvider}
            setQuickModel={setQuickModel}
            setReason={setReason}
            setResearchDepth={setResearchDepth}
            setSymbol={setSymbol}
            setTradeDate={setTradeDate}
            submitting={submitting}
            submit={submit}
            symbol={symbol}
            tradeDate={tradeDate}
          />
          <RuntimePanel runtime={runtime} runtimeLoading={runtimeLoading} refreshRuntime={refreshRuntime} />
          <RunHistory
            loading={loading}
            refreshRuns={refreshRuns}
            runs={runs}
            selectedRunId={selectedRunId}
            setSelectedRunId={setSelectedRunId}
          />
        </aside>

        <section className="order-1 min-w-0 xl:order-2">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-loss/40 bg-loss/10 px-4 py-3 text-[13px] leading-relaxed text-loss"
            >
              {error}
            </div>
          )}
          {!selectedRun ? (
            <EmptyResearchState />
          ) : (
            <ResearchBrief run={selectedRun} isActiveRun={isActiveRun} />
          )}
        </section>
      </div>
    </DashboardPageLayout>
  );
}

function RunForm({
  analysts,
  canStartRun,
  deepModel,
  provider,
  quickModel,
  reason,
  researchDepth,
  runtime,
  setAnalysts,
  setDeepModel,
  setProvider,
  setQuickModel,
  setReason,
  setResearchDepth,
  setSymbol,
  setTradeDate,
  submitting,
  submit,
  symbol,
  tradeDate,
}: {
  analysts: string[];
  canStartRun: boolean;
  deepModel: string;
  provider: string;
  quickModel: string;
  reason: string;
  researchDepth: number;
  runtime: TradingAgentsRuntimeStatus | null;
  setAnalysts: (value: string[] | ((previous: string[]) => string[])) => void;
  setDeepModel: (value: string) => void;
  setProvider: (value: string) => void;
  setQuickModel: (value: string) => void;
  setReason: (value: string) => void;
  setResearchDepth: (value: number) => void;
  setSymbol: (value: string) => void;
  setTradeDate: (value: string) => void;
  submitting: boolean;
  submit: (event: FormEvent) => void;
  symbol: string;
  tradeDate: string;
}) {
  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-border bg-bg-card p-4 shadow-[0_20px_60px_-48px_rgba(0,0,0,0.85)]"
      aria-label="TradingAgents run form"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-[18px] font-semibold tracking-tight text-fg">Research setup</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
            Multi-agent report saved as an auditable artifact.
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting || !canStartRun}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-md border border-brand bg-brand px-4",
            "font-sans text-[13px] font-semibold text-bg transition duration-200 active:translate-y-px",
            "hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Play className="h-4 w-4" weight="fill" />
          {submitting ? "Starting" : canStartRun ? "Run" : "Not ready"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Symbol">
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            className="h-10 rounded-md border border-border bg-bg-elev-1 px-3 font-mono text-[15px] text-fg outline-none transition focus:border-brand"
            maxLength={12}
            required
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={tradeDate}
            onChange={(event) => setTradeDate(event.target.value)}
            className="h-10 rounded-md border border-border bg-bg-elev-1 px-3 font-mono text-[15px] text-fg outline-none transition focus:border-brand"
            required
          />
        </Field>
        <Field label="Provider">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-10 rounded-md border border-border bg-bg-elev-1 px-3 font-sans text-[14px] text-fg outline-none transition focus:border-brand"
          >
            {PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Depth">
          <select
            value={researchDepth}
            onChange={(event) => setResearchDepth(Number(event.target.value))}
            className="h-10 rounded-md border border-border bg-bg-elev-1 px-3 font-sans text-[14px] text-fg outline-none transition focus:border-brand"
          >
            <option value={1}>1 round</option>
            <option value={2}>2 rounds</option>
            <option value={3}>3 rounds</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 rounded-md border border-border-hair bg-bg-elev-1 p-3">
        <p className="mb-2 t-label text-fg-muted">Analyst bench</p>
        <div className="grid grid-cols-2 gap-2">
          {(runtime?.supported_analysts ?? DEFAULT_ANALYSTS).map((item) => {
            const checked = analysts.includes(item);
            return (
              <label
                key={item}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 font-sans text-[13px] transition active:translate-y-px",
                  checked
                    ? "border-brand/70 bg-brand/10 text-fg"
                    : "border-border-hair bg-bg-card text-fg-muted hover:border-border",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setAnalysts((prev) => {
                      if (event.target.checked) {
                        return [...prev, item].filter((value, index, all) => all.indexOf(value) === index);
                      }
                      const next = prev.filter((value) => value !== item);
                      return next.length ? next : prev;
                    });
                  }}
                  className="h-3.5 w-3.5 accent-current"
                />
                <span>{analystLabel(item)}</span>
              </label>
            );
          })}
        </div>
      </div>

      <details className="mt-3 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2">
        <summary className="cursor-pointer t-label text-fg-muted">Model overrides</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Deep model">
            <input
              value={deepModel}
              onChange={(event) => setDeepModel(event.target.value)}
              placeholder="provider default"
              className="h-10 rounded-md border border-border bg-bg-card px-3 font-mono text-[13px] text-fg outline-none transition focus:border-brand"
            />
          </Field>
          <Field label="Quick model">
            <input
              value={quickModel}
              onChange={(event) => setQuickModel(event.target.value)}
              placeholder="provider default"
              className="h-10 rounded-md border border-border bg-bg-card px-3 font-mono text-[13px] text-fg outline-none transition focus:border-brand"
            />
          </Field>
        </div>
      </details>

      <Field label="Research note" className="mt-3">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Catalyst, position context, or question"
          className="resize-none rounded-md border border-border bg-bg-elev-1 px-3 py-2 font-sans text-[14px] leading-relaxed text-fg outline-none transition focus:border-brand"
        />
      </Field>
    </form>
  );
}

function ResearchBrief({ run, isActiveRun }: { run: TradingAgentsRun; isActiveRun: boolean }) {
  const decisionText = run.decision_text?.trim() ?? "";
  const summary = run.summary_lines ?? [];
  const sections = useMemo(() => splitMemoSections(decisionText), [decisionText]);
  const signal = extractSignal(decisionText, summary);
  const tone = signalTone(signal);
  const thinMemo = isThinMemo(decisionText, summary);
  const highlights = extractHighlights(summary, decisionText, signal);
  const levels = extractDollarLevels(decisionText);
  const portfolioSection = findMemoSection(sections, ["portfolio manager", "final decision", "rating", "decision memo"]);
  const traderSection = findMemoSection(sections, ["trader plan"]);
  const committeeSection = findMemoSection(sections, ["investment committee"]);

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-[0_20px_80px_-56px_rgba(0,0,0,0.9)] md:p-5">
      <header className="border-b border-border-hair pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-label text-fg-muted">Selected report</span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-semibold uppercase", tone.border, tone.bg, tone.text)}>
                {renderStatusIcon(run.status, cn("h-3.5 w-3.5", run.status === "running" && "animate-spin"))}
                {run.status}
              </span>
            </div>
            <h2 className="mt-3 break-words font-sans text-[34px] font-semibold leading-none tracking-tight text-fg md:text-[48px]">
              {run.symbol}
              <span className="text-fg-muted"> / {run.trade_date}</span>
            </h2>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-fg-muted">
              {run.provider} research with {run.analysts.map(analystLabel).join(", ")} analysts.
            </p>
          </div>

          <div className={cn("min-w-[220px] rounded-lg border p-4", tone.border, tone.soft)}>
            <p className="t-label text-fg-muted">Decision signal</p>
            <p className={cn("mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight", tone.text)}>
              {signal}
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
              {thinMemo
                ? "This saved run contains only the processed signal. Run it again to generate the full committee brief."
                : "Synthesized from portfolio manager, analyst evidence, and risk debate."}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-6">
          <Fact icon={Clock} label="Runtime" value={formatDuration(run.started_at, run.completed_at, run.updated_at)} />
          <Fact icon={Gauge} label="Depth" value={`${run.research_depth} round${run.research_depth === 1 ? "" : "s"}`} />
          <Fact icon={UsersThree} label="Analysts" value={String(run.analysts.length)} />
          <Fact icon={Target} label="Budget" value={formatTimeout(run.timeout_s)} />
          <Fact icon={Files} label="Artifacts" value={String(run.artifact_files.length)} />
          <Fact icon={ShieldCheck} label="Mode" value="Read-only" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {run.progress_message && (
            <InlineStatus status={run.status} message={run.progress_message} />
          )}

          {run.error && (
            <div className="rounded-md border border-loss/50 bg-loss/10 px-4 py-3">
              <p className="t-label text-loss">{run.error.code}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg">{run.error.message}</p>
            </div>
          )}

          {isActiveRun ? (
            <RunningSkeleton />
          ) : thinMemo ? (
            <ThinMemoPanel run={run} signal={signal} />
          ) : (
            <>
              <DecisionHighlights highlights={highlights} />
              <MemoSectionPreview
                icon={Scales}
                title="Portfolio manager"
                body={portfolioSection?.body || decisionText}
                emphasis
              />
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <MemoSectionPreview icon={ChartLineUp} title="Trader plan" body={traderSection?.body ?? ""} />
                <MemoSectionPreview icon={UsersThree} title="Committee read" body={committeeSection?.body ?? ""} />
              </div>
              <AnalystMosaic decisionText={decisionText} />
              <MemoSectionList sections={sections} />
            </>
          )}
        </div>

        <aside className="space-y-4">
          <KeyLevels levels={levels} />
          <ArtifactPanel files={run.artifact_files} />
          <div className="rounded-lg border border-border-hair bg-bg-elev-1 p-4">
            <p className="t-label text-fg-muted">Research guardrail</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">{run.advisory_disclaimer}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DecisionHighlights({ highlights }: { highlights: string[] }) {
  if (!highlights.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">Action brief</p>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {highlights.map((line, index) => (
          <div
            key={`${line}-${index}`}
            className="group rounded-md border border-border-hair bg-bg-elev-1 px-3 py-3 transition duration-200 hover:-translate-y-0.5 hover:border-border"
          >
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand/35 bg-brand/10 font-mono text-[10px] text-brand">
                {index + 1}
              </span>
              <p className="text-[13px] leading-relaxed text-fg">{line}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalystMosaic({ decisionText }: { decisionText: string }) {
  const analysts = [
    { title: "Market", icon: ChartLineUp, body: extractSubsection(decisionText, "Market Analyst") },
    { title: "Social", icon: Pulse, body: extractSubsection(decisionText, "Social Analyst") },
    { title: "News", icon: Newspaper, body: extractSubsection(decisionText, "News Analyst") },
    { title: "Fundamentals", icon: Buildings, body: extractSubsection(decisionText, "Fundamentals Analyst") },
  ].filter((item) => item.body);

  if (!analysts.length) return null;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">Analyst mosaic</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {analysts.map((item) => (
          <MemoSectionPreview key={item.title} icon={item.icon} title={item.title} body={item.body} compact />
        ))}
      </div>
    </section>
  );
}

function MemoSectionPreview({
  body,
  compact,
  emphasis,
  icon: Icon,
  title,
}: {
  body: string;
  compact?: boolean;
  emphasis?: boolean;
  icon: IconType;
  title: string;
}) {
  if (!body.trim()) return null;
  const lines = body
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("|---"))
    .slice(0, compact ? 5 : 8);

  return (
    <section className={cn("rounded-lg border p-4", emphasis ? "border-brand/30 bg-brand/5" : "border-border-hair bg-bg-elev-1")}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">{title}</p>
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <p key={`${title}-${index}-${line}`} className="text-[13px] leading-relaxed text-fg">
            {truncate(line, compact ? 210 : 320)}
          </p>
        ))}
      </div>
    </section>
  );
}

function MemoSectionList({ sections }: { sections: MemoSection[] }) {
  const displaySections = sections.filter((section) => section.body.trim()).slice(0, 7);
  if (!displaySections.length) return null;
  return (
    <section className="rounded-lg border border-border-hair bg-bg-elev-1">
      <div className="border-b border-border-hair px-4 py-3">
        <p className="t-label text-fg-muted">Full memo digest</p>
      </div>
      <div className="divide-y divide-border-hair">
        {displaySections.map((section) => (
          <details key={section.title} className="group px-4 py-3" open={section.title.toLowerCase().includes("portfolio")}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="font-sans text-[14px] font-semibold text-fg">{section.title}</span>
              <CaretRight className="h-4 w-4 text-fg-muted transition group-open:rotate-90" weight="bold" />
            </summary>
            <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-border-hair bg-bg-card p-3">
              <ReadableMemo body={section.body} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ReadableMemo({ body }: { body: string }) {
  const rows = body.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 80);
  return (
    <div className="space-y-2">
      {rows.map((line, index) => {
        const clean = cleanLine(line);
        if (!clean) return null;
        if (line.startsWith("###")) {
          return (
            <p key={`${index}-${line}`} className="pt-2 t-label text-brand">
              {clean}
            </p>
          );
        }
        if (line.startsWith("|")) {
          return (
            <p key={`${index}-${line}`} className="font-mono text-[12px] leading-relaxed text-fg-muted">
              {clean}
            </p>
          );
        }
        return (
          <p key={`${index}-${line}`} className="text-[13px] leading-relaxed text-fg">
            {truncate(clean, 420)}
          </p>
        );
      })}
    </div>
  );
}

function KeyLevels({ levels }: { levels: LevelItem[] }) {
  return (
    <section className="rounded-lg border border-border-hair bg-bg-elev-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendDown className="h-4 w-4 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">Price map</p>
      </div>
      {levels.length ? (
        <div className="space-y-2">
          {levels.map((level) => {
            const tone = levelTone(level.label);
            return (
              <div key={`${level.value}-${level.label}`} className={cn("rounded-md border px-3 py-2", levelToneClass(tone))}>
                <p className="font-mono text-[17px] font-semibold text-fg">{level.value}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{level.label || "Referenced level"}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border-hair px-3 py-5 text-center text-[12px] leading-relaxed text-fg-muted">
          No explicit price levels in this saved memo.
        </p>
      )}
    </section>
  );
}

function ArtifactPanel({ files }: { files: string[] }) {
  return (
    <section className="rounded-lg border border-border-hair bg-bg-elev-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Files className="h-4 w-4 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">Artifacts</p>
      </div>
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => (
            <span key={file} className="rounded-pill border border-border bg-bg-card px-2.5 py-1 font-mono text-[11px] text-fg-muted">
              {file}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-fg-muted">No artifacts saved.</p>
      )}
    </section>
  );
}

function InlineStatus({ status, message }: { status: TradingAgentsRunStatus; message: string }) {
  return (
    <div className="rounded-md border border-border-hair bg-bg-elev-1 px-4 py-3">
      <div className="flex items-center gap-2">
        {renderStatusIcon(status, cn("h-4 w-4", statusClass(status), status === "running" && "animate-spin"))}
        <p className="t-label text-fg-muted">Progress</p>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-fg">{message}</p>
    </div>
  );
}

function ThinMemoPanel({ run, signal }: { run: TradingAgentsRun; signal: string }) {
  return (
    <section className="rounded-lg border border-brand/35 bg-brand/10 p-5">
      <p className="t-label text-brand">Processed signal only</p>
      <h3 className="mt-2 font-sans text-[22px] font-semibold tracking-tight text-fg">{signal}</h3>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
        This run was saved before the research wrapper emitted the full committee memo. The artifacts exist, but
        the UI received only the terminal signal for {run.symbol}. A fresh run will populate the portfolio-manager
        decision, analyst evidence, debate, risk view, and price map.
      </p>
    </section>
  );
}

function RunningSkeleton() {
  return (
    <section className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-24 animate-pulse rounded-lg border border-border-hair bg-bg-elev-1"
          style={{ animationDelay: `${item * 120}ms` } as CSSProperties}
        />
      ))}
    </section>
  );
}

function EmptyResearchState() {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed border-border-hair bg-bg-card p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-bg-elev-1">
          <Scales className="h-5 w-5 text-brand" weight="bold" />
        </div>
        <h2 className="mt-4 font-sans text-[22px] font-semibold tracking-tight text-fg">No report selected</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          Select a saved run or start a new one to view the committee decision, analyst evidence, risk debate,
          and generated artifacts.
        </p>
      </div>
    </div>
  );
}

function RuntimePanel({
  refreshRuntime,
  runtime,
  runtimeLoading,
}: {
  refreshRuntime: () => void;
  runtime: TradingAgentsRuntimeStatus | null;
  runtimeLoading: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-[18px] font-semibold tracking-tight text-fg">Runtime</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
            {runtime
              ? runtime.ready
                ? runtime.bootstrap_required
                  ? "Ready; bootstrap may run first"
                  : "Ready to run"
                : "Action needed"
              : "Checking integration"}
          </p>
        </div>
        <button
          type="button"
          onClick={refreshRuntime}
          disabled={runtimeLoading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-fg-muted transition hover:text-fg active:translate-y-px disabled:opacity-60"
          aria-label="Refresh TradingAgents runtime"
        >
          <ArrowClockwise className={cn("h-4 w-4", runtimeLoading && "animate-spin")} weight="bold" />
        </button>
      </div>

      {runtime ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <RuntimeFact label="Provider" value={runtime.provider} good={runtime.provider_key_configured} />
            <RuntimeFact label="Wrapper" value={runtime.script_runnable ? "found" : "missing"} good={runtime.script_runnable} />
            <RuntimeFact label="Runtime" value={runtime.bootstrap_required ? "bootstrap" : runtime.installed_ref ?? "ready"} good />
            <RuntimeFact label="Limit" value={`${runtime.runs_per_hour}/hr`} good={runtime.enabled} />
          </div>
          <p className="mt-3 truncate font-mono text-[11px] text-fg-hint" title={runtime.skill_home}>
            {runtime.deep_model} / {runtime.quick_model}
          </p>
          {runtime.warnings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {runtime.warnings.map((warning) => (
                <li key={warning} className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-[12px] leading-relaxed text-fg">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="rounded-md border border-dashed border-border-hair px-3 py-5 text-center t-meta text-fg-muted">
          Runtime status unavailable.
        </p>
      )}
    </section>
  );
}

function RunHistory({
  loading,
  refreshRuns,
  runs,
  selectedRunId,
  setSelectedRunId,
}: {
  loading: boolean;
  refreshRuns: () => void;
  runs: TradingAgentsRun[];
  selectedRunId: string | null;
  setSelectedRunId: (value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-sans text-[18px] font-semibold tracking-tight text-fg">Run history</h2>
        <button
          type="button"
          onClick={refreshRuns}
          disabled={loading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-fg-muted transition hover:text-fg active:translate-y-px disabled:opacity-60"
          aria-label="Refresh TradingAgents runs"
        >
          <ArrowClockwise className={cn("h-4 w-4", loading && "animate-spin")} weight="bold" />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {runs.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-hair px-3 py-6 text-center t-meta text-fg-muted">
            No saved TradingAgents runs.
          </p>
        ) : (
          runs.map((run) => {
            const selected = run.run_id === selectedRunId;
            const signal = extractSignal(run.decision_text ?? "", run.summary_lines ?? []);
            return (
              <button
                key={run.run_id}
                type="button"
                onClick={() => setSelectedRunId(run.run_id)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition duration-200 active:translate-y-px",
                  selected ? "border-brand/70 bg-brand/10" : "border-border-hair bg-bg-elev-1 hover:border-border",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[14px] font-semibold text-fg">
                    {run.symbol} / {run.trade_date}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">
                    {signal} - {formatStamp(run.created_at)}
                  </span>
                </span>
                {renderStatusIcon(run.status, cn("h-4 w-4 shrink-0", statusClass(run.status)))}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function Field({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="t-label text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Fact({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-brand" weight="bold" />
        <p className="t-label text-fg-muted">{label}</p>
      </div>
      <p className="mt-1 font-mono text-[13px] text-fg">{value}</p>
    </div>
  );
}

function RuntimeFact({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2">
      <p className="t-label text-fg-muted">{label}</p>
      <p className={cn("mt-1 font-mono text-[13px]", good ? "text-profit" : "text-loss")}>{value}</p>
    </div>
  );
}
