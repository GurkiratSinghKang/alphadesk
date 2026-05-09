"use client";

import * as React from "react";
import Link from "next/link";
import { Robot } from "@phosphor-icons/react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import AgentActivityFeed from "@/components/composites/AgentActivityFeed";
import EmptyState from "@/components/primitives/EmptyState";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent, AgentArchetype } from "@/lib/types/agents";

/**
 * AgentDrawer
 * ────────────
 * v2-plan §2.1 — globally accessible agent activity feed. Slide-over from
 * the right, identical mount pattern to NotificationDrawer (Sheet
 * primitive). Triggered by AgentBell in TopBar.
 *
 * Composition: header (italic Newsreader title + running count) → archetype
 * filter chips (All / Research / Signal / Risk / Exec / Failing) →
 * scrollable AgentActivityFeed → footer link to /agents.
 *
 * Uses MOCK_AGENTS via useAgents in Phase 0; backend B.2 swaps the
 * queryFn with no consumer changes.
 */
export interface AgentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional override list — for /_design previews and tests. */
  agents?: Agent[];
}

type FilterValue = "all" | AgentArchetype | "failing";

const FILTER_CHIPS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "research", label: "Research" },
  { value: "signal", label: "Signal" },
  { value: "risk", label: "Risk" },
  { value: "exec", label: "Exec" },
  { value: "failing", label: "Failing" },
];

export default function AgentDrawer({ open, onOpenChange, agents: agentsOverride }: AgentDrawerProps) {
  const { data: storeAgents = [] } = useAgents();
  const agents = agentsOverride ?? storeAgents;
  const [filter, setFilter] = React.useState<FilterValue>("all");

  const runningCount = React.useMemo(
    () => agents.filter((a) => a.status === "running").length,
    [agents],
  );
  const failingCount = React.useMemo(
    () => agents.filter((a) => a.status === "failed" || a.health === "failed").length,
    [agents],
  );

  const visible = React.useMemo<Agent[]>(() => {
    if (filter === "all") return agents;
    if (filter === "failing") return agents.filter((a) => a.status === "failed" || a.health === "failed");
    return agents.filter((a) => a.archetype === filter);
  }, [agents, filter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-none border-l border-border bg-bg-card p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-4 py-3 border-b border-border-hair">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="font-display italic text-h2 text-fg flex items-center gap-2">
              <Robot className="size-4 text-brand" weight="regular" />
              Agents
              {runningCount > 0 && (
                <span className="t-label text-brand">· {runningCount} running</span>
              )}
              {failingCount > 0 && (
                <span className="t-label text-loss">· {failingCount} failing</span>
              )}
            </SheetTitle>
            <Link
              href="/agents"
              onClick={() => onOpenChange(false)}
              className="text-body-sm text-fg-muted hover:text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
            >
              Roster ↗
            </Link>
          </div>
        </SheetHeader>

        <div
          role="tablist"
          aria-label="Filter agents"
          className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-border-hair"
        >
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.value}
              role="tab"
              aria-selected={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={cn(
                "px-2.5 py-1 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                filter === chip.value
                  ? "bg-brand text-brand-on"
                  : chip.value === "failing" && failingCount > 0
                  ? "bg-tint-down-1 text-loss border border-loss/40"
                  : "bg-bg-elev-1 text-fg-muted hover:text-fg",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="p-6">
              <EmptyState
                eyebrow="QUIET"
                title={filter === "failing" ? "Nothing failing." : "No agents in this archetype."}
                description={
                  filter === "all"
                    ? "When agents start, queue, or complete runs, they appear here."
                    : `Switch to All to see the full roster.`
                }
              />
            </div>
          ) : (
            <AgentActivityFeed
              agents={visible}
              limit={visible.length}
              dense
              onOpen={() => onOpenChange(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
