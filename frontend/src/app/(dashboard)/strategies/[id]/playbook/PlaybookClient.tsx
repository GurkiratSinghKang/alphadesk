"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import AgentChip, { type AgentArchetype } from "@/components/primitives/AgentChip";
import { cn } from "@/lib/utils";

interface PlaybookStage {
  id: string;
  ordinal: string;
  title: string;
  archetype: AgentArchetype;
  agentName: string;
  rules: string[];
  liveCaption: string;
}

const DEMO_STAGES: PlaybookStage[] = [
  {
    id: "entry",
    ordinal: "01",
    title: "Entry",
    archetype: "research",
    agentName: "Regime + Earnings",
    rules: [
      "Universe: Russell 1000 ex-financials.",
      "ROIC > 12% (TTM); net debt / EBITDA < 2.5×.",
      "Price > 50d EMA AND 50d > 200d EMA.",
    ],
    liveCaption: "12 candidates surfaced today · top NVDA · view watchlist →",
  },
  {
    id: "confirmation",
    ordinal: "02",
    title: "Confirmation",
    archetype: "signal",
    agentName: "Trend",
    rules: [
      "Volume > 1.4× 30d ADV on entry day.",
      "RSI(14) crossing 50 from below.",
      "Macro regime score ≥ 0.6 (not fragile).",
    ],
    liveCaption: "4 names confirmed since 09:30 ET",
  },
  {
    id: "position",
    ordinal: "03",
    title: "Position",
    archetype: "risk",
    agentName: "Portfolio",
    rules: [
      "Position size = 1% of NAV (Kelly-capped at 2%).",
      "Sector exposure cap: 30%.",
      "Per-name cap: 8% of NAV.",
    ],
    liveCaption: "8 positions live · 3.2% NAV at risk",
  },
  {
    id: "exit",
    ordinal: "04",
    title: "Exit",
    archetype: "exec",
    agentName: "Router",
    rules: [
      "Trailing stop: 8% from peak close.",
      "Profit take: 25% scale at +15%; remainder at +25%.",
      "Time stop: 60 trading days max hold.",
    ],
    liveCaption: "1 trail-stop fired this week · CRM (closed +14.2%)",
  },
];

interface PlaybookClientProps {
  strategyId: string;
}

export default function PlaybookClient({ strategyId }: PlaybookClientProps) {
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-8">
      <Section
        eyebrow={`STRATEGY · PLAYBOOK · ${strategyId}`}
        title="Momentum + Quality"
        description="Workflow document — stages, agents per stage, backtest summary, live trades, scoped watchlist."
        level={1}
        right={
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-pill bg-tint-up-1 border border-profit/40 text-profit text-eyebrow font-semibold uppercase tracking-[0.08em]">
            ENABLED
          </span>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 rounded-md border border-border-hair bg-bg-elev-1 p-4">
          <Stat label="MTD return" value="+4.8%" tone="profit" size="md" />
          <Stat label="Sharpe (1y)" value="1.84" tone="brand" size="md" />
          <Stat label="Max DD" value="−6.2%" tone="loss" size="md" />
          <Stat label="Positions" value={8} size="md" />
          <Stat label="Allocation" value="22.4%" sub="of NAV" size="md" />
          <Stat label="Win rate" value="58%" sub="Trailing 90d" size="md" />
        </div>
      </Section>

      <Section
        eyebrow="STRATEGY · STAGES"
        title="Workflow"
        description="Four ordered stages. Each stage names the responsible agent archetype + the rules it enforces."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {DEMO_STAGES.map((stage) => (
            <article
              key={stage.id}
              className="rounded-md border border-border-hair bg-bg-elev-1 p-4 flex flex-col gap-3"
            >
              <header className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-eyebrow uppercase tracking-[0.12em] text-brand font-semibold">
                    {stage.ordinal}
                  </span>
                  <h3 className="font-display italic text-h3 text-fg leading-snug">
                    {stage.title}
                  </h3>
                </div>
                <AgentChip archetype={stage.archetype} status="running" size="sm" />
              </header>
              <ol className="text-body-sm text-fg-dim space-y-1.5 list-decimal list-inside">
                {stage.rules.map((r, i) => (
                  <li key={i} className="leading-snug">{r}</li>
                ))}
              </ol>
              <footer className="pt-2 border-t border-border-hair">
                <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted italic">
                  {stage.liveCaption}
                </p>
                <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                  Owned by {stage.agentName}
                </p>
              </footer>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-6">
        <Section
          eyebrow="STRATEGY · BACKTEST"
          title="Latest backtest"
          description="Run #18 · 2024-01-01 → 2026-04-30 · cost model: Alpaca regular-hours."
          right={
            <Link
              href={`/strategies/${strategyId}/backtest`}
              className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted hover:text-fg underline-offset-2 hover:underline"
            >
              Open in workbench →
            </Link>
          }
        >
          <div className="rounded-md border border-border-hair bg-bg-elev-1 p-4 flex flex-col gap-3">
            <BacktestEquitySparkline />
            <dl className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-2 text-body-sm">
              <div className="flex flex-col"><dt className="t-label">Total return</dt><dd className="text-profit t-num-md">+38.4%</dd></div>
              <div className="flex flex-col"><dt className="t-label">CAGR</dt><dd className="text-fg t-num-md">+18.2%</dd></div>
              <div className="flex flex-col"><dt className="t-label">Sharpe</dt><dd className="text-fg t-num-md">1.62</dd></div>
              <div className="flex flex-col"><dt className="t-label">Sortino</dt><dd className="text-fg t-num-md">2.18</dd></div>
              <div className="flex flex-col"><dt className="t-label">Max DD</dt><dd className="text-loss t-num-md">−9.4%</dd></div>
            </dl>
          </div>
        </Section>

        <Section eyebrow="STRATEGY · LIVE" title="Open positions">
          <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden">
            <table className="w-full text-body-sm">
              <thead className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                <tr>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">P&amp;L</th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { tk: "NVDA", qty: 80, pnl: "+12.4%", note: "Trailing entry" },
                  { tk: "MSFT", qty: 60, pnl: "+6.2%", note: "Held since Q4" },
                  { tk: "AAPL", qty: 100, pnl: "+3.8%", note: "Above 200d" },
                  { tk: "CRM", qty: 40, pnl: "−1.4%", note: "Watch stop" },
                ].map((p) => (
                  <tr key={p.tk} className="border-t border-border-hair">
                    <td className="px-3 py-2 text-fg font-medium">{p.tk}</td>
                    <td className="px-3 py-2 text-right t-mono text-fg-muted">{p.qty}</td>
                    <td className={cn("px-3 py-2 text-right t-mono", p.pnl.startsWith("−") ? "text-loss" : "text-profit")}>{p.pnl}</td>
                    <td className="px-3 py-2 text-fg-muted hidden sm:table-cell">{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </main>
  );
}

/**
 * Inline mini equity sparkline. Pure SVG so the page renders without
 * pulling in lightweight-charts for what's effectively a teaser graph.
 */
function BacktestEquitySparkline() {
  // Deterministic upward-drifting curve with a couple of dips.
  const points = React.useMemo(() => {
    const N = 60;
    const arr: { x: number; y: number }[] = [];
    let y = 100;
    for (let i = 0; i < N; i++) {
      const drift = 0.45 + Math.sin(i / 5) * 0.6 + (i === 24 ? -3.2 : 0) + (i === 41 ? -2.1 : 0);
      y += drift;
      arr.push({ x: i, y });
    }
    return arr;
  }, []);
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const W = 600;
  const H = 80;
  const path = points
    .map((p, i) => {
      const x = (p.x / (points.length - 1)) * W;
      const y = H - ((p.y - minY) / (maxY - minY)) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fillPath = `${path} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" role="img" aria-label="Equity curve, +38.4% over 28 months">
      <path d={fillPath} fill="var(--tint-up-1)" />
      <path d={path} fill="none" stroke="var(--up-500)" strokeWidth={1.4} />
    </svg>
  );
}
