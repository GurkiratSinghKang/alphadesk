"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AgentActivityFeed from "@/components/composites/AgentActivityFeed";
import Section from "@/components/composites/Section";
import { useAgents } from "@/hooks/useAgents";

/**
 * AgentFeedPanel
 * ───────────────
 * v2 redesign — dashboard agent activity panel per v2-plan §1.0 +
 * §Phase 2 (agent reframe). Surfaces the most-recent agent state at
 * a glance: which agents are running, what they last produced, their
 * health.
 *
 * Wired to MOCK_AGENTS via useAgents() in Phase 0; backend B.2 swap
 * lights up the live feed without any consumer changes here.
 *
 * Mounted inside a ConfigurableSection so the operator can hide /
 * reorder the panel from Admin → Dashboard layout composer (per
 * v2-plan §1.6f). Section id matches MOCK_DASHBOARD_SECTIONS entry
 * "agent-feed".
 */
export default function AgentFeedPanel() {
  const router = useRouter();
  const { data: agents = [], isLoading } = useAgents();

  return (
    <Section
      eyebrow="AGENTS · LIVE"
      title="Agent activity"
      description="Research · Signal · Risk · Exec — the protagonists. Click any row for the full output stream."
      right={
        <button
          type="button"
          onClick={() => router.push("/agents")}
          className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted hover:text-fg underline-offset-2 hover:underline"
        >
          Open roster →
        </button>
      }
    >
      {isLoading ? (
        <div
          aria-live="polite"
          aria-busy="true"
          className="h-32 rounded-md border border-border-hair bg-bg-elev-1/40 animate-pulse"
        />
      ) : (
        <AgentActivityFeed
          agents={agents}
          limit={5}
          onOpen={(id) => router.push(`/agents/${id}`)}
        />
      )}
    </Section>
  );
}
