"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import StatusBanner from "@/components/composites/StatusBanner";
import { cn } from "@/lib/utils";

interface BacktestRunSummary {
  id: string;
  label: string;
  startedAt: string;
  totalReturnPct: number;
  sharpe: number;
  maxDdPct: number;
  trades: number;
}

const RUNS: BacktestRunSummary[] = [
  { id: "run-18", label: "Run #18 (current)", startedAt: "2026-05-08 09:42", totalReturnPct: 38.4, sharpe: 1.62, maxDdPct: -9.4, trades: 124 },
  { id: "run-17", label: "Run #17", startedAt: "2026-05-04 14:18", totalReturnPct: 36.1, sharpe: 1.58, maxDdPct: -10.2, trades: 121 },
  { id: "run-16", label: "Run #16", startedAt: "2026-04-29 11:02", totalReturnPct: 41.7, sharpe: 1.74, maxDdPct: -8.6, trades: 138 },
  { id: "run-15", label: "Run #15", startedAt: "2026-04-22 16:30", totalReturnPct: 33.8, sharpe: 1.42, maxDdPct: -11.8, trades: 119 },
];

interface BacktestClientProps {
  strategyId: string;
}

export default function BacktestClient({ strategyId }: BacktestClientProps) {
  const [selectedRun, setSelectedRun] = React.useState<string>(RUNS[0].id);
  const active = RUNS.find((r) => r.id === selectedRun) ?? RUNS[0];

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-8">
      {/* v2 phase 1.x — editorial italic-Newsreader hero matching
       * backtest-dark.png. Sits above the existing config + run-output
       * sections so the workbench gets the design's voice without
       * touching any of the live workflow UI below. */}
      <header
        className="rounded-md border border-border-hair p-5 md:p-6"
        style={{
          background: "var(--bg-elev-1)",
          borderLeft: "2px solid var(--brand)",
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <p
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em", margin: 0 }}
          >
            WORKBENCH · BACKTEST
          </p>
          <Link
            href={`/strategies/${strategyId}/playbook`}
            className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted hover:text-fg underline-offset-2 hover:underline"
          >
            ← Back to playbook
          </Link>
        </div>
        <h2
          className="m-0 mt-3 italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            // 28px matches the playbook + design backtest.jsx; was 38px
            // which over-shouted the identity-band eyebrow above.
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            textWrap: "balance",
          }}
        >
          Test before you commit capital.
        </h2>
        <p
          className="italic"
          style={{
            marginTop: 12,
            fontFamily: "var(--font-display)",
            fontSize: 15,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            maxWidth: 680,
          }}
        >
          Run a strategy across history. Compare runs side by side. Publish
          one as the strategy's current backtest.
        </p>
      </header>

      <Section
        eyebrow={`STRATEGY · BACKTEST · ${strategyId}`}
        title="Backtest workbench"
        description="Configure universe + date range + cost model + sweep params; compare runs; publish to playbook."
        level={1}
      >
        <StatusBanner
          tone="info"
          message="Phase 1.10 — workbench renders against 4 demo runs. Backend B.10 (POST /backtest/runs + asyncio orchestrator + WS progress) lights up the live execution path."
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-6">
        <aside className="space-y-3">
          <Section eyebrow="CONFIG" title="Run config" rule={false}>
            <div className="rounded-md border border-border-hair bg-bg-elev-1 p-3 space-y-3">
              <Field label="Strategy" value="Momentum + Quality" />
              <Field label="Universe" value="Russell 1000 ex-financials" />
              <Field label="Date range" value="2024-01-01 → 2026-04-30" />
              <Field label="Cost model" value="Alpaca regular hours" />
              <Field label="Capital" value="$1,000,000" mono />
              <Field label="Sizing" value="1% NAV per name (Kelly-cap 2%)" />
              <Field label="Rebalance" value="Daily close" />
              <button
                type="button"
                disabled
                className="w-full rounded-sm border border-brand/50 bg-tint-brand-1 text-brand px-3 py-2 text-body-sm font-semibold uppercase tracking-[0.08em] opacity-50 cursor-not-allowed"
                title="Phase 1.10 backend (B.10) wires the live run dispatch"
              >
                Run backtest
              </button>
            </div>
          </Section>

          <Section eyebrow="HISTORY" title="Run history" rule={false}>
            <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
              {RUNS.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRun(r.id)}
                    className={cn(
                      "w-full px-3 py-2.5 text-left flex flex-col gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      selectedRun === r.id ? "bg-bg-elev-2" : "hover:bg-bg-elev-2",
                    )}
                  >
                    <span className="text-body text-fg font-medium truncate">{r.label}</span>
                    <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                      {r.startedAt} · {r.trades} trades
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Section>
        </aside>

        <div className="space-y-6">
          <Section
            eyebrow={`RUN · ${active.label.toUpperCase()}`}
            title="Equity + drawdown"
            description={`Started ${active.startedAt}`}
            right={
              <button
                type="button"
                disabled
                className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted opacity-50 cursor-not-allowed"
                title="Publish lights up via Phase 1.10 backend (B.10 publish endpoint + DangerConfirm)"
              >
                Publish to playbook →
              </button>
            }
          >
            <div className="rounded-md border border-border-hair bg-bg-elev-1 p-4 space-y-4">
              <EquityAndDrawdownChart seed={active.id} />
              <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2 text-body-sm">
                <Metric label="Total return" value={`${active.totalReturnPct > 0 ? "+" : ""}${active.totalReturnPct}%`} tone={active.totalReturnPct >= 0 ? "profit" : "loss"} />
                <Metric label="CAGR" value="+18.2%" />
                <Metric label="Sharpe" value={active.sharpe.toFixed(2)} tone="brand" />
                <Metric label="Sortino" value="2.18" />
                <Metric label="Calmar" value={(active.totalReturnPct / Math.abs(active.maxDdPct)).toFixed(2)} />
                <Metric label="Max DD" value={`${active.maxDdPct.toFixed(1)}%`} tone="loss" />
                <Metric label="Win rate" value="58%" />
              </dl>
            </div>
          </Section>

          <Section
            eyebrow="COMPARE"
            title="Side-by-side runs"
            description="Pick up to 3 runs to compare. Phase 1.10 follow-up wires the small-multiples chart."
          >
            <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden">
              <table className="w-full text-body-sm">
                <thead className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                  <tr>
                    <th className="text-left px-3 py-2">Run</th>
                    <th className="text-left px-3 py-2 hidden sm:table-cell">Started</th>
                    <th className="text-right px-3 py-2">Return</th>
                    <th className="text-right px-3 py-2">Sharpe</th>
                    <th className="text-right px-3 py-2 hidden md:table-cell">Max DD</th>
                    <th className="text-right px-3 py-2 hidden md:table-cell">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {RUNS.map((r) => (
                    <tr key={r.id} className="border-t border-border-hair">
                      <td className="px-3 py-2 text-fg font-medium">{r.label}</td>
                      <td className="px-3 py-2 text-fg-muted hidden sm:table-cell t-mono">{r.startedAt}</td>
                      <td className={cn("px-3 py-2 text-right t-mono", r.totalReturnPct >= 30 ? "text-profit" : "text-fg")}>
                        {r.totalReturnPct > 0 ? "+" : ""}{r.totalReturnPct}%
                      </td>
                      <td className="px-3 py-2 text-right t-mono text-fg">{r.sharpe.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right t-mono text-loss hidden md:table-cell">{r.maxDdPct}%</td>
                      <td className="px-3 py-2 text-right t-mono text-fg-muted hidden md:table-cell">{r.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-label">{label}</span>
      <span className={cn("text-body text-fg", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "profit" | "loss" | "brand" }) {
  return (
    <div className="flex flex-col">
      <dt className="t-label">{label}</dt>
      <dd className={cn("t-num-md", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "brand" && "text-brand", tone === "default" && "text-fg")}>
        {value}
      </dd>
    </div>
  );
}

function EquityAndDrawdownChart({ seed }: { seed: string }) {
  // Deterministic curve seeded by id so each run looks distinct.
  const points = React.useMemo(() => {
    const N = 120;
    let y = 100;
    const out: { x: number; y: number; dd: number }[] = [];
    let peak = y;
    let phase = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 0; i < N; i++) {
      const drift = 0.42 + Math.sin((i + phase) / 6) * 0.7 - (i === 38 ? 4.2 : 0) - (i === 78 ? 3.6 : 0);
      y += drift;
      peak = Math.max(peak, y);
      out.push({ x: i, y, dd: ((y - peak) / peak) * 100 });
    }
    return out;
  }, [seed]);

  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const W = 720;
  const HEq = 110;
  const HDd = 50;

  const eqPath = points
    .map((p, i) => {
      const x = (p.x / (points.length - 1)) * W;
      const y = HEq - ((p.y - minY) / (maxY - minY)) * HEq;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const ddMax = Math.min(...points.map((p) => p.dd));
  const ddPath = points
    .map((p, i) => {
      const x = (p.x / (points.length - 1)) * W;
      const y = ((p.dd / ddMax) * HDd).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y}`;
    })
    .join(" ");

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${HEq}`} className="w-full h-28" role="img" aria-label="Equity curve">
        <path d={`${eqPath} L${W},${HEq} L0,${HEq} Z`} fill="var(--tint-up-1)" />
        <path d={eqPath} fill="none" stroke="var(--up-500)" strokeWidth={1.4} />
      </svg>
      <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">Drawdown</p>
      <svg viewBox={`0 0 ${W} ${HDd}`} className="w-full h-12" role="img" aria-label="Drawdown curve">
        <path d={`${ddPath} L${W},0 L0,0 Z`} fill="var(--tint-down-1)" />
        <path d={ddPath} fill="none" stroke="var(--down-500)" strokeWidth={1.2} />
      </svg>
    </div>
  );
}
