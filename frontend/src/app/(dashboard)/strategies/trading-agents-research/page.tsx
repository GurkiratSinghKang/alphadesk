"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import Display from "@/components/typography/Display";
import Mono from "@/components/typography/Mono";
import {
  getTradingAgentsRun,
  getTradingAgentsRuns,
  startTradingAgentsRun,
  type TradingAgentsRun,
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

function statusClass(status: TradingAgentsRunStatus) {
  if (status === "succeeded") return "text-profit";
  if (status === "failed") return "text-loss";
  if (status === "running") return "text-brand";
  return "text-fg-muted";
}

function statusIcon(status: TradingAgentsRunStatus) {
  if (status === "succeeded") return CheckCircle2;
  if (status === "failed") return AlertTriangle;
  if (status === "running") return RefreshCw;
  return ShieldCheck;
}

export default function TradingAgentsResearchPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [tradeDate, setTradeDate] = useState(todayIso);
  const [provider, setProvider] = useState("");
  const [researchDepth, setResearchDepth] = useState(1);
  const [deepModel, setDeepModel] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [reason, setReason] = useState("");
  const [runs, setRuns] = useState<TradingAgentsRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<TradingAgentsRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStatus = selectedRun?.status ?? null;
  const isActiveRun = selectedStatus === "queued" || selectedStatus === "running";

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

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

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
        // The global API toast handles the visible error; keep the last run.
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

  const StatusIcon = selectedRun ? statusIcon(selectedRun.status) : ShieldCheck;
  const summary = selectedRun?.summary_lines ?? [];
  const decisionText = selectedRun?.decision_text?.trim() ?? "";

  const runSubtitle = useMemo(() => {
    if (!selectedRun) return "No report selected";
    return `${selectedRun.provider} - ${selectedRun.deep_model} / ${selectedRun.quick_model}`;
  }, [selectedRun]);

  const actions = (
    <span className="inline-flex items-center gap-2 rounded-pill border border-border px-3 py-1 t-label text-fg-muted">
      <ShieldCheck className="h-3.5 w-3.5" />
      READ-ONLY
    </span>
  );

  return (
    <DashboardPageLayout
      eyebrow="RESEARCH"
      title="TradingAgents Research"
      actions={actions}
    >
      <main className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <form
            onSubmit={submit}
            className="rounded-lg border border-border bg-bg-card p-4"
            aria-label="TradingAgents run form"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Display size="md" as="h2" className="text-[20px]">
                  New run
                </Display>
                <p className="t-meta text-fg-muted">Pinned wrapper - saved artifact</p>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-sm border border-brand bg-brand px-4",
                  "font-sans text-[13px] font-semibold text-bg transition-opacity",
                  "disabled:cursor-wait disabled:opacity-60",
                )}
              >
                <Play className="h-4 w-4" />
                {submitting ? "Starting" : "Run"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="t-label text-fg-muted">Symbol</span>
                <input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-mono text-base text-fg outline-none focus:border-brand"
                  maxLength={12}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-label text-fg-muted">Date</span>
                <input
                  type="date"
                  value={tradeDate}
                  onChange={(event) => setTradeDate(event.target.value)}
                  className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-mono text-base text-fg outline-none focus:border-brand"
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-label text-fg-muted">Provider</span>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-sans text-base text-fg outline-none focus:border-brand"
                >
                  {PROVIDERS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="t-label text-fg-muted">Depth</span>
                <select
                  value={researchDepth}
                  onChange={(event) => setResearchDepth(Number(event.target.value))}
                  className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-sans text-base text-fg outline-none focus:border-brand"
                >
                  <option value={1}>1 round</option>
                  <option value={2}>2 rounds</option>
                  <option value={3}>3 rounds</option>
                </select>
              </label>
            </div>

            <details className="mt-3 rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2">
              <summary className="cursor-pointer t-label text-fg-muted">
                Model overrides
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="t-label text-fg-muted">Deep model</span>
                  <input
                    value={deepModel}
                    onChange={(event) => setDeepModel(event.target.value)}
                    placeholder="provider default"
                    className="h-10 rounded-sm border border-border bg-bg-card px-3 font-mono text-base text-fg outline-none focus:border-brand"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="t-label text-fg-muted">Quick model</span>
                  <input
                    value={quickModel}
                    onChange={(event) => setQuickModel(event.target.value)}
                    placeholder="provider default"
                    className="h-10 rounded-sm border border-border bg-bg-card px-3 font-mono text-base text-fg outline-none focus:border-brand"
                  />
                </label>
              </div>
            </details>

            <label className="mt-3 flex flex-col gap-1">
              <span className="t-label text-fg-muted">Research note</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional catalyst, position context, or question"
                className="resize-none rounded-sm border border-border bg-bg-elev-1 px-3 py-2 font-sans text-base text-fg outline-none focus:border-brand"
              />
            </label>
          </form>

          <section className="rounded-lg border border-border bg-bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <Display size="md" as="h2" className="text-[20px]">
                Run history
              </Display>
              <button
                type="button"
                onClick={refreshRuns}
                disabled={loading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border text-fg-muted hover:text-fg disabled:opacity-60"
                aria-label="Refresh TradingAgents runs"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {runs.length === 0 ? (
                <p className="rounded-sm border border-dashed border-border-hair px-3 py-6 text-center t-meta text-fg-muted">
                  No saved TradingAgents runs.
                </p>
              ) : (
                runs.map((run) => {
                  const Icon = statusIcon(run.status);
                  const selected = run.run_id === selectedRunId;
                  return (
                    <button
                      key={run.run_id}
                      type="button"
                      onClick={() => setSelectedRunId(run.run_id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left",
                        selected
                          ? "border-brand bg-bg-elev-2"
                          : "border-border-hair bg-bg-elev-1 hover:border-border",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[14px] font-semibold text-fg">
                          {run.symbol} - {run.trade_date}
                        </span>
                        <span className="block truncate t-meta text-fg-muted">
                          {formatStamp(run.created_at)} - {run.provider}
                        </span>
                      </span>
                      <Icon className={cn("h-4 w-4 shrink-0", statusClass(run.status))} />
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </section>

        <section className="rounded-lg border border-border bg-bg-card p-5">
          <header className="mb-5 flex flex-col gap-4 border-b border-border-hair pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="t-label text-fg-muted">Selected report</p>
              <Display size="md" as="h2" className="mt-1 text-[28px]">
                {selectedRun ? `${selectedRun.symbol} - ${selectedRun.trade_date}` : "TradingAgents"}
              </Display>
              <p className="mt-1 t-meta text-fg-muted">{runSubtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon
                className={cn(
                  "h-4 w-4",
                  selectedRun ? statusClass(selectedRun.status) : "text-fg-muted",
                  selectedRun?.status === "running" && "animate-spin",
                )}
              />
              <Mono className={cn("text-[13px] uppercase", selectedRun && statusClass(selectedRun.status))}>
                {selectedRun?.status ?? "idle"}
              </Mono>
            </div>
          </header>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-sm border border-loss/40 bg-loss/10 px-3 py-2 t-meta text-loss"
            >
              {error}
            </div>
          )}

          {!selectedRun ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-sm border border-dashed border-border-hair">
              <p className="t-meta text-fg-muted">Start or select a run.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Started" value={formatStamp(selectedRun.started_at)} />
                <Fact label="Updated" value={formatStamp(selectedRun.updated_at)} />
                <Fact
                  label="Depth"
                  value={`${selectedRun.research_depth} round${selectedRun.research_depth === 1 ? "" : "s"}`}
                />
                <Fact label="Artifacts" value={String(selectedRun.artifact_files.length)} />
              </div>

              {selectedRun.error && (
                <div className="rounded-sm border border-loss/50 bg-loss/10 px-4 py-3">
                  <p className="t-label text-loss">{selectedRun.error.code}</p>
                  <p className="mt-1 font-sans text-[13px] leading-relaxed text-fg">
                    {selectedRun.error.message}
                  </p>
                </div>
              )}

              <section>
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand" />
                  <p className="t-label text-fg-muted">Summary</p>
                </div>
                {summary.length ? (
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {summary.map((line, idx) => (
                      <li
                        key={`${line}-${idx}`}
                        className="rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2 font-sans text-[13px] leading-relaxed text-fg"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-sm border border-dashed border-border-hair px-3 py-5 text-center t-meta text-fg-muted">
                    {isActiveRun ? "Research is running." : "No summary extracted."}
                  </p>
                )}
              </section>

              <section>
                <p className="mb-2 t-label text-fg-muted">Decision memo</p>
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-sm border border-border-hair bg-bg-elev-1 p-4 font-mono text-[12.5px] leading-relaxed text-fg">
                  {decisionText || (isActiveRun ? "Waiting for the TradingAgents memo..." : "No memo available.")}
                </pre>
              </section>

              <footer className="grid grid-cols-1 gap-3 border-t border-border-hair pt-4 md:grid-cols-[1fr_auto] md:items-end">
                <p className="font-sans text-[12.5px] leading-relaxed text-fg-hint">
                  {selectedRun.advisory_disclaimer}
                </p>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {selectedRun.artifact_files.map((file) => (
                    <span
                      key={file}
                      className="rounded-pill border border-border px-2 py-1 font-mono text-[11px] text-fg-muted"
                    >
                      {file}
                    </span>
                  ))}
                </div>
              </footer>
            </div>
          )}
        </section>
      </main>
    </DashboardPageLayout>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2">
      <p className="t-label text-fg-muted">{label}</p>
      <p className="mt-1 font-mono text-[13px] text-fg">{value}</p>
    </div>
  );
}
