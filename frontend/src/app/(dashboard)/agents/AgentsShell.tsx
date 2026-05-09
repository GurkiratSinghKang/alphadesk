"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";
import AgentChip from "@/components/primitives/AgentChip";
import StatusDot from "@/components/primitives/StatusDot";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent, AgentArchetype } from "@/lib/types/agents";

/**
 * v2-plan Phase 2.1 — full agent roster + status overview.
 *
 * Composition: identity Section (with per-archetype counts) → archetype
 * filter chips → roster grid (3-up on desktop). Each card is the design
 * comp's Agent row: archetype chip + status + name + italic last output
 * (with **bold** rendered in gold) + footer (owner strategy · cost · runs ·
 * model · health dot). Click → /agents/[id] detail.
 *
 * Phase 0 reads `useAgents()` which returns MOCK_AGENTS. Phase 2 backend
 * cycle (B.2) swaps the queryFn for live `/api/v1/agents/list`.
 */
export default function AgentsShell() {
  const { data: agents = [] } = useAgents();
  const [filter, setFilter] = React.useState<"all" | AgentArchetype | "failed">("all");

  const counts = React.useMemo(() => {
    const c = { all: agents.length, research: 0, signal: 0, risk: 0, exec: 0, failed: 0 };
    for (const a of agents) {
      c[a.archetype] += 1;
      if (a.status === "failed" || a.health === "failed") c.failed += 1;
    }
    return c;
  }, [agents]);

  const visible = React.useMemo<Agent[]>(() => {
    if (filter === "all") return agents;
    if (filter === "failed") return agents.filter((a) => a.status === "failed" || a.health === "failed");
    return agents.filter((a) => a.archetype === filter);
  }, [agents, filter]);

  const totalCost = React.useMemo(
    () => agents.reduce((sum, a) => sum + (a.costToday ?? 0), 0),
    [agents],
  );
  const totalRuns = React.useMemo(
    () => agents.reduce((sum, a) => sum + (a.runs24h ?? 0), 0),
    [agents],
  );

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-6">
      <Section
        eyebrow="AGENTS · PROTAGONIST"
        title="Agents"
        description="Research reads. Signal scores. Risk gates. Exec routes. Four archetypes, ten agents — the protagonists of v2."
        level={1}
        right={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-right">
            <RosterStat label="Roster" value={String(counts.all)} />
            <RosterStat label="Failing" value={String(counts.failed)} tone={counts.failed > 0 ? "loss" : "muted"} />
            <RosterStat label="Cost · 24h" value={`$${totalCost.toFixed(2)}`} />
            <RosterStat label="Runs · 24h" value={totalRuns.toLocaleString()} />
          </div>
        }
      >
        <nav
          aria-label="Filter agents"
          role="tablist"
          className="flex flex-wrap gap-1.5"
        >
          {(
            [
              { id: "all", label: "All", count: counts.all },
              { id: "research", label: "Research", count: counts.research },
              { id: "signal", label: "Signal", count: counts.signal },
              { id: "risk", label: "Risk", count: counts.risk },
              { id: "exec", label: "Exec", count: counts.exec },
              { id: "failed", label: "Failing", count: counts.failed },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={filter === chip.id}
              onClick={() => setFilter(chip.id)}
              className={cn(
                "px-2.5 py-1 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand inline-flex items-center gap-1.5",
                filter === chip.id
                  ? "bg-brand text-brand-on"
                  : chip.id === "failed" && chip.count > 0
                  ? "bg-tint-down-1 text-loss border border-loss/40"
                  : "bg-bg-elev-1 text-fg-muted hover:text-fg",
              )}
            >
              <span>{chip.label}</span>
              <span className={cn("font-mono", filter === chip.id ? "text-brand-on/80" : "text-fg-hint")}>
                {chip.count}
              </span>
            </button>
          ))}
        </nav>
      </Section>

      {visible.length === 0 ? (
        <EmptyState
          eyebrow="NO MATCH"
          title="No agents match this filter."
          description="Switch to All, or pick a different archetype from the filter row."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </main>
  );
}

function RosterStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "loss" | "muted";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-label text-fg-hint">{label}</span>
      <span
        className={cn(
          "font-mono text-body-sm tabular-nums",
          tone === "loss" ? "text-loss" : tone === "muted" ? "text-fg-muted" : "text-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.id)}`}
      className="group flex flex-col gap-3 rounded-md border border-border-hair bg-bg-elev-1 p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      data-archetype={agent.archetype}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AgentChip archetype={agent.archetype} status={agent.status} size="lg" />
          <div className="min-w-0">
            <p
              className="font-display italic text-body text-fg truncate"
              style={{ letterSpacing: "-0.005em" }}
            >
              {agent.name}
            </p>
            <p className="font-mono text-eyebrow text-fg-hint mt-0.5">
              {agent.model}
            </p>
          </div>
        </div>
        <StatusDot tone={agent.health === "ok" ? "profit" : agent.health === "degraded" ? "amber" : "loss"} size={7} title={`Health: ${agent.health}`} />
      </header>

      <p
        className="font-display italic text-body-sm text-fg-dim"
        style={{ lineHeight: 1.55 }}
      >
        {renderHighlightedOutput(agent.lastOutput)}
      </p>

      <footer className="grid grid-cols-3 gap-2 pt-2 border-t border-border-hair text-eyebrow">
        <RosterStat label="Cost · 24h" value={`$${agent.costToday.toFixed(2)}`} tone="muted" />
        <RosterStat label="Runs · 24h" value={agent.runs24h.toLocaleString()} tone="muted" />
        <RosterStat
          label="Owner"
          value={agent.ownerStrategy ?? "—"}
          tone="muted"
        />
      </footer>
    </Link>
  );
}

/**
 * Render `**bold**` markers in the lastOutput as gold-highlighted spans.
 * Mirrors the design's archetype-attributed memo voice where key facts
 * (numbers, regime calls, breach flags) read in brand-gold against the
 * italic Newsreader body. Anything not wrapped in `**` renders plain.
 */
function renderHighlightedOutput(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={i} className="text-brand not-italic font-medium">
          {part.slice(2, -2)}
        </span>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
