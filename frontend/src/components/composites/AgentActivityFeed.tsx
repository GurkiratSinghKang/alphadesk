"use client";

import * as React from "react";

import EmptyState from "@/components/primitives/EmptyState";
import type { Agent } from "@/lib/types/agents";
import { cn } from "@/lib/utils";

import AgentRow from "./AgentRow";

/**
 * AgentActivityFeed
 * ──────────────────
 * v2 redesign — scrollable list of AgentRow. Used by the Dashboard
 * agent-feed card, the Phase 2 status-bar global drawer, the Agents
 * page roster, the Symbol "Agents on this name" tab, and the
 * Strategy playbook agents-per-stage subsection.
 *
 * The component does NOT fetch — upstream supplies agents via props.
 * That keeps it usable by both real React Query callers and the
 * `/_design` preview. Empty agents render an EmptyState.
 */
export interface AgentActivityFeedProps {
  agents: Agent[];
  /** Maximum rows to render. Defaults to 6. */
  limit?: number;
  /** Click handler — opens agent detail. */
  onOpen?: (id: string) => void;
  /** Whether to render rows in dense mode (tighter padding, no metadata). */
  dense?: boolean;
  /** Override the empty state copy. */
  emptyEyebrow?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export default function AgentActivityFeed({
  agents,
  limit = 6,
  onOpen,
  dense = false,
  emptyEyebrow = "QUIET",
  emptyTitle = "No agents running.",
  emptyDescription = "When an agent starts a research, signal, risk, or exec run, it appears here in real time.",
  className,
}: AgentActivityFeedProps) {
  const visible = React.useMemo(() => agents.slice(0, limit), [agents, limit]);

  if (visible.length === 0) {
    return (
      <EmptyState
        eyebrow={emptyEyebrow}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <ul
      data-slot="agent-activity-feed"
      role="list"
      className={cn("flex flex-col gap-2", className)}
    >
      {visible.map((agent) => (
        <li key={agent.id} className="contents">
          <AgentRow agent={agent} onOpen={onOpen} dense={dense} />
        </li>
      ))}
    </ul>
  );
}
