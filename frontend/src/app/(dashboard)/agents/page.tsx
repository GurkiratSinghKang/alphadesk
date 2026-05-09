"use client";

import Section from "@/components/composites/Section";
import AgentActivityFeed from "@/components/composites/AgentActivityFeed";
import { useAgents } from "@/hooks/useAgents";

// Dashboard layout calls useNotifications() which depends on useWs — that
// hook only resolves under <WebSocketProvider>, which is dynamic({ ssr:
// false }) for browser-only WebSocket APIs. Static prerender therefore
// throws "useWs must be used within Providers". Force dynamic render so
// the build skips the prerender attempt.
export const dynamic = "force-dynamic";

/**
 * Phase 0 route shell. The full Agents page (roster + filter +
 * search + per-agent drill) lands in Phase 2 — but this shell
 * already shows the live MOCK_AGENTS feed because AgentActivityFeed
 * + useAgents are Phase 0c primitives. Useful for ⌘K targets and
 * for verifying the agent type system end-to-end.
 */
export default function AgentsShell() {
  const { data: agents = [] } = useAgents();
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow="AGENTS · PROTAGONIST"
        title="Agents"
        description="Research, Signal, Risk, Exec — the protagonists of v2. Full roster lands in Phase 2."
        level={1}
      >
        <AgentActivityFeed
          agents={agents}
          limit={agents.length}
          emptyEyebrow="COMING SOON"
          emptyTitle="Agents page ships in Phase 2."
          emptyDescription="Mock data is wired now via lib/mocks/agents.ts. Phase 2 swaps the queryFn for backend B.2."
        />
      </Section>
    </main>
  );
}
