"use client";

import * as React from "react";
import Link from "next/link";

import AgentChip from "@/components/primitives/AgentChip";
import StatusDot from "@/components/primitives/StatusDot";
import EmptyState from "@/components/primitives/EmptyState";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent, AgentArchetype } from "@/lib/types/agents";

/**
 * AgentsOnThisName — v2-plan §2.2.
 *
 * Per-symbol agent attribution: instead of a single generic "AI memo," show
 * what each archetype is currently saying about THIS name. Three cards in a
 * row (Research thesis · Signal score · Risk flags), each rendered with the
 * archetype voice from the global agent roster.
 *
 * Phase 0 reads MOCK_AGENTS and synthesises a per-symbol output line; once
 * backend B.2 lands the queryFn becomes `/api/v1/agents/by-symbol/{sym}`.
 *
 * The fourth archetype (Exec) is intentionally suppressed — there's nothing
 * useful for it to say about a symbol the user isn't trading. Once we have
 * an open position, the position page surfaces its Exec attribution.
 */
export interface AgentsOnThisNameProps {
  symbol: string;
  className?: string;
}

const FEATURED: AgentArchetype[] = ["research", "signal", "risk"];

const ARCHETYPE_PROMPT: Record<AgentArchetype, string> = {
  research: "What the regime + flow + earnings setup say.",
  signal: "Where the model scores this name today.",
  risk: "What could go wrong if we own it.",
  exec: "How a fill would clear here.",
};

export default function AgentsOnThisName({ symbol, className }: AgentsOnThisNameProps) {
  const { data: agents = [] } = useAgents();
  const featured = React.useMemo<Agent[]>(
    () =>
      FEATURED.map((arch) => agents.find((a) => a.archetype === arch)).filter(
        (a): a is Agent => Boolean(a),
      ),
    [agents],
  );

  if (featured.length === 0) {
    return (
      <div className={cn("rounded-md border border-border-hair bg-bg-elev-1 p-6", className)}>
        <EmptyState
          eyebrow="QUIET"
          title="No agents have spoken on this name yet."
          description="Run an agent from the roster to surface a per-symbol thesis."
        />
      </div>
    );
  }

  return (
    <section
      aria-label={`Agents on ${symbol}`}
      className={cn("flex flex-col gap-3", className)}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="t-label text-fg-hint">AGENTS · ON {symbol.toUpperCase()}</p>
          <h2 className="font-display italic text-h2 text-fg mt-1" style={{ letterSpacing: "-0.015em" }}>
            What the desk thinks
          </h2>
        </div>
        <Link
          href="/agents"
          className="t-mono text-eyebrow text-fg-muted hover:text-fg uppercase tracking-[0.08em]"
        >
          Roster ↗
        </Link>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        {featured.map((agent) => (
          <ArchetypeCard key={agent.id} agent={agent} symbol={symbol} />
        ))}
      </div>
    </section>
  );
}

function ArchetypeCard({ agent, symbol }: { agent: Agent; symbol: string }) {
  const memo = synthesizeSymbolMemo(agent, symbol);
  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.id)}`}
      className="group flex flex-col gap-3 rounded-md border border-border-hair bg-bg-elev-1 p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      data-archetype={agent.archetype}
    >
      <header className="flex items-start justify-between gap-2">
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
              {ARCHETYPE_PROMPT[agent.archetype]}
            </p>
          </div>
        </div>
        <StatusDot
          tone={agent.health === "ok" ? "profit" : agent.health === "degraded" ? "amber" : "loss"}
          size={7}
          title={`Health: ${agent.health}`}
        />
      </header>
      <p
        className="font-display italic text-body-sm text-fg-dim"
        style={{ lineHeight: 1.55 }}
      >
        {renderHighlightedOutput(memo)}
      </p>
      <footer className="t-mono text-eyebrow text-fg-hint flex items-center justify-between pt-2 border-t border-border-hair">
        <span>Last run · {relativeTime(agent.lastRun)}</span>
        <span className="text-brand opacity-0 group-hover:opacity-100 transition-opacity">
          Open ↗
        </span>
      </footer>
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 *  Per-symbol memo synthesis — Phase 0. Backend B.2 returns per-symbol
 *  output; until then we splice the symbol into a deterministic template
 *  per archetype so the panel renders something specific instead of
 *  echoing the global lastOutput.
 * ──────────────────────────────────────────────────────────────────── */

function synthesizeSymbolMemo(agent: Agent, symbol: string): string {
  const sym = symbol.toUpperCase();
  if (agent.archetype === "research") {
    return `Regime read carries to **${sym}**: late-cycle quality bias works in name's favor. ${agent.lastOutput.split(".")[0]}. Watch upcoming earnings + sector rotation.`;
  }
  if (agent.archetype === "signal") {
    return `Trend score for ${sym} reads **0.68** (long bias). Volume confirmation above 30d ADV; setup intact while prior swing low holds.`;
  }
  if (agent.archetype === "risk") {
    return `${sym} concentration would push sector exposure +1.4pp. Within limits, but **monitor** if added to existing tech-overweight book.`;
  }
  return agent.lastOutput;
}

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

function relativeTime(iso: string): string {
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
