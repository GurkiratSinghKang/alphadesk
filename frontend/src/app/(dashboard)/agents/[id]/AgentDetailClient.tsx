"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";
import AgentChip from "@/components/primitives/AgentChip";
import StatusDot from "@/components/primitives/StatusDot";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types/agents";

/**
 * v2-plan Phase 2.1 — agent detail page.
 *
 * Composition: identity Section (back link + archetype chip + name + status) →
 * 4-stat hero (cost · runs · model · last run) → 2-col body
 * (output stream left + config + owner strategy + danger right). Read-only
 * Phase 0; per-agent pause / spend cap / model swap controls land with
 * backend B.2 (every control hits the same dispatch path as the global
 * controls in /admin/control-center).
 */
export default function AgentDetailClient({ id }: { id: string }) {
  const { data: agents = [] } = useAgents();
  const agent = agents.find((a) => a.id === id);

  if (!agent) {
    return (
      <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
        <Section eyebrow={`AGENT · ${id}`} title="Agent not found" level={1}>
          <EmptyState
            eyebrow="UNKNOWN AGENT"
            title="No agent matches this id."
            description="The agent may have been retired. Browse the active roster instead."
          />
          <p className="mt-3 text-center">
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 rounded-sm border border-brand/40 bg-tint-brand-1 px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] text-brand transition-colors hover:bg-brand hover:text-brand-on"
            >
              Roster ↗
            </Link>
          </p>
        </Section>
      </main>
    );
  }

  const stream = buildSyntheticStream(agent);

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-6">
      <Section
        eyebrow={`AGENT · ${agent.archetype.toUpperCase()}`}
        title={agent.name}
        description="Output stream, config, owner strategy. Per-agent pause and spend caps land with backend B.2."
        level={1}
        right={
          <div className="flex items-center gap-3">
            <Link
              href="/agents"
              className="t-mono text-eyebrow text-fg-muted hover:text-fg uppercase tracking-[0.08em]"
            >
              ← Roster
            </Link>
            <AgentChip archetype={agent.archetype} status={agent.status} size="lg" />
            <StatusDot
              tone={agent.health === "ok" ? "profit" : agent.health === "degraded" ? "amber" : "loss"}
              size={7}
              title={`Health: ${agent.health}`}
            />
          </div>
        }
      >
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border-hair rounded-md overflow-hidden border border-border-hair"
        >
          <DetailStat label="Cost · 24h" value={`$${agent.costToday.toFixed(2)}`} />
          <DetailStat label="Runs · 24h" value={agent.runs24h.toLocaleString()} />
          <DetailStat
            label="Last run"
            value={formatRelative(agent.lastRun)}
          />
          <DetailStat label="Model" value={agent.model} mono />
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr,1fr] gap-6">
        <Section eyebrow="STREAM" title="Output stream" rule={false}>
          <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
            {stream.map((entry) => (
              <li key={entry.id} className="px-4 py-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-label text-fg-hint">{entry.timeLabel}</span>
                  <span className="font-mono text-eyebrow text-fg-hint">
                    ${entry.cost.toFixed(2)} · {entry.tokens.toLocaleString()} tok
                  </span>
                </div>
                <p className="font-display italic text-body-sm text-fg-dim leading-relaxed">
                  {entry.body}
                </p>
              </li>
            ))}
          </ol>
        </Section>

        <div className="space-y-6">
          <Section eyebrow="CONFIG" title="Config" rule={false}>
            <dl className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
              <ConfigRow label="Archetype" value={
                <span className="font-mono text-body-sm uppercase tracking-[0.08em] text-fg">
                  {agent.archetype}
                </span>
              } />
              <ConfigRow label="Status" value={
                <span className="font-mono text-body-sm uppercase tracking-[0.08em] text-fg">
                  {agent.status}
                </span>
              } />
              <ConfigRow label="Model" value={
                <span className="font-mono text-body-sm text-fg">{agent.model}</span>
              } />
              <ConfigRow label="Daily cap" value={
                <span className="font-mono text-body-sm text-fg-muted italic">
                  $25.00 · backend B.2
                </span>
              } />
              <ConfigRow label="Owner strategy" value={
                agent.ownerStrategy ? (
                  <Link
                    href={`/strategies/${agent.ownerStrategy}`}
                    className="font-mono text-body-sm text-brand hover:underline"
                  >
                    {agent.ownerStrategy}
                  </Link>
                ) : (
                  <span className="font-mono text-body-sm text-fg-hint">—</span>
                )
              } />
            </dl>
          </Section>

          <Section eyebrow="DANGER" title="Pause + reset" rule={false}>
            <div className="rounded-md border border-loss/30 bg-tint-down-1 p-3 space-y-2">
              <p className="font-display italic text-body-sm text-fg-dim leading-relaxed">
                Pause halts new runs but keeps the agent visible in the roster.
                Reset replays the last 24h of inputs through the current model.
                Both controls open a typed-confirm flow.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled
                  className="rounded-sm border border-loss/50 bg-tint-down-1 text-loss px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
                  title="Backend B.2 wires the per-agent pause"
                >
                  Pause agent
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-sm border border-border bg-bg-elev-1 text-fg-muted px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
                  title="Backend B.2 wires the replay endpoint"
                >
                  Reset · last 24h
                </button>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}

function DetailStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-bg-elev-1 px-4 py-3 flex flex-col gap-1">
      <span className="t-label text-fg-hint">{label}</span>
      <span className={cn("text-body-sm tabular-nums text-fg", mono ? "font-mono" : "font-mono")}>
        {value}
      </span>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 grid grid-cols-[120px,1fr] items-center gap-3">
      <dt className="t-label text-fg-hint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 *  Synthetic stream — Phase 0. Backend B.2 returns the real per-agent
 *  output log; until then we render four entries seeded off the agent's
 *  current `lastOutput` so the page has something to show.
 * ──────────────────────────────────────────────────────────────────── */

interface StreamEntry {
  id: string;
  timeLabel: string;
  body: string;
  cost: number;
  tokens: number;
}

function buildSyntheticStream(agent: Agent): StreamEntry[] {
  const now = Date.now();
  const minute = 60 * 1000;
  return [
    {
      id: "now",
      timeLabel: "Just now",
      body: agent.lastOutput,
      cost: 0.18,
      tokens: 1240,
    },
    {
      id: "t-15",
      timeLabel: "15m ago",
      body: "Refreshed inputs from upstream feed; no material delta vs. previous tick.",
      cost: 0.04,
      tokens: 320,
    },
    {
      id: "t-30",
      timeLabel: "30m ago",
      body: "Cached prior conclusion; downstream consumers (signal · risk) still in agreement window.",
      cost: 0.0,
      tokens: 0,
    },
    {
      id: "t-60",
      timeLabel: "1h ago",
      body: agent.archetype === "risk"
        ? "Re-ran scenario sweep; sector concentration shifted +0.6pp on intraday action."
        : "Periodic re-evaluation; thesis unchanged.",
      cost: 0.22,
      tokens: 1480,
    },
  ];
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const delta = Date.now() - t;
  const min = Math.floor(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
