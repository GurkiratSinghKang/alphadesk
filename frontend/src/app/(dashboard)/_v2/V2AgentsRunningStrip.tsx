"use client";

import * as React from "react";
import Link from "next/link";

import AgentChip from "@/components/primitives/AgentChip";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types/agents";

/**
 * V2AgentsRunningStrip
 * ─────────────────────
 * v2-plan §2.2 — "agents running right now" surface on the dashboard.
 * Sits between the BriefingStrip and the BodyGrid as a compact strip
 * of the agents currently doing work, with their last output truncated
 * to a single line. Click → /agents/[id]; open the activity drawer
 * via the trailing Roster ↗ link.
 *
 * Renders nothing when no agents are running — the desk doesn't need a
 * "0 running" banner taking up vertical space.
 */
export default function V2AgentsRunningStrip({ className }: { className?: string }) {
  const { data: agents = [] } = useAgents();
  const running = React.useMemo<Agent[]>(
    () => agents.filter((a) => a.status === "running").slice(0, 4),
    [agents],
  );

  if (running.length === 0) return null;

  return (
    <section
      aria-label="Agents running right now"
      className={cn(
        "border-y border-border-hair bg-bg-elev-1/60",
        "px-6 sm:px-8 py-3",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 mb-2">
        <p className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.18em" }}>
          AGENTS · RUNNING NOW
        </p>
        <Link
          href="/agents"
          className="t-mono text-eyebrow text-fg-muted hover:text-fg uppercase tracking-[0.08em]"
        >
          Roster ↗
        </Link>
      </header>
      <ul
        role="list"
        className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4"
      >
        {running.map((agent) => (
          <li key={agent.id}>
            <Link
              href={`/agents/${encodeURIComponent(agent.id)}`}
              className="group flex items-baseline gap-2 min-w-0 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
            >
              <AgentChip archetype={agent.archetype} status={agent.status} size="sm" />
              <span
                className="font-display italic text-body-sm text-fg-dim leading-snug truncate min-w-0"
                style={{ letterSpacing: "-0.005em" }}
              >
                <span className="text-fg not-italic font-medium">{agent.name}</span>
                <span className="text-fg-muted"> · {firstSentence(agent.lastOutput)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function firstSentence(text: string): string {
  // Strip ** markers + return the first sentence (or first 80 chars if no period).
  const stripped = text.replace(/\*\*/g, "");
  const dot = stripped.indexOf(".");
  if (dot > 0 && dot < 120) return stripped.slice(0, dot + 1);
  return stripped.length > 80 ? stripped.slice(0, 80) + "…" : stripped;
}
