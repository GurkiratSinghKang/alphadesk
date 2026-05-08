"use client";

import * as React from "react";

import AgentChip from "@/components/primitives/AgentChip";
import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import type { Agent, AgentHealth } from "@/lib/types/agents";
import { cn } from "@/lib/utils";

/**
 * AgentRow
 * ─────────
 * v2 redesign — single-row representation of one agent. Used by
 * AgentActivityFeed (Dashboard, status-bar drawer in Phase 2),
 * Symbol "Agents on this name" tab, Strategy playbook stages, the
 * Agents page roster.
 *
 * Layout: AgentChip on the left, italic Newsreader output line in
 * the middle, owner strategy + cost/runs metadata, health dot on the
 * right. Hoverable + keyboard-focusable when `onOpen` is set.
 */
export interface AgentRowProps {
  agent: Agent;
  onOpen?: (id: string) => void;
  /** When true, skip the model + lastRun footer (use in tight grids). */
  dense?: boolean;
  className?: string;
}

const healthToneMap: Record<AgentHealth, StatusDotTone> = {
  ok: "profit",
  degraded: "amber",
  failed: "loss",
};

function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

export default function AgentRow({
  agent,
  onOpen,
  dense = false,
  className,
}: AgentRowProps) {
  const interactive = Boolean(onOpen);
  const Component = interactive ? "button" : "div";

  return (
    <Component
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onOpen?.(agent.id) : undefined}
      data-slot="agent-row"
      data-archetype={agent.archetype}
      data-status={agent.status}
      data-health={agent.health}
      className={cn(
        "group flex w-full items-start gap-3 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2.5 text-left transition-colors",
        interactive && "hover:bg-bg-elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer",
        dense && "py-2",
        className,
      )}
    >
      <div className="shrink-0 mt-0.5">
        <AgentChip archetype={agent.archetype} status={agent.status} size="sm" />
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <p
          className="font-display italic text-body-sm text-fg leading-snug line-clamp-2"
          data-slot="agent-row-output"
        >
          {agent.lastOutput || "No output yet."}
        </p>
        {!dense && (
          <div className="flex items-center gap-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            {agent.ownerStrategy && (
              <span className="truncate">↳ {agent.ownerStrategy}</span>
            )}
            <span aria-hidden>·</span>
            <span className="t-mono">{fmtUsd(agent.costToday)}/d</span>
            <span aria-hidden>·</span>
            <span className="t-mono">{agent.runs24h}r/24h</span>
            <span aria-hidden>·</span>
            <span className="t-mono truncate">{agent.model}</span>
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center" aria-hidden>
        <StatusDot tone={healthToneMap[agent.health]} size={5} />
      </div>
    </Component>
  );
}
