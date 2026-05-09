import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Agent detail — AlphaDesk",
};

// Dashboard layout's useNotifications() requires <WebSocketProvider>,
// which is ssr:false. Skip static prerender so the build doesn't trip
// on "useWs must be used within Providers".
export const dynamic = "force-dynamic";

interface AgentDetailShellProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailShell({
  params,
}: AgentDetailShellProps) {
  const { id } = await params;
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow={`AGENT · ${id}`}
        title="Agent detail"
        description="Output stream, config, cost, performance score. Phase 2."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="Agent detail page lands in Phase 2."
          description="Full output stream with archetype attribution. Per-agent spend cap, model picker, run history. Pause/resume controls scoped to this single agent."
        />
      </Section>
    </main>
  );
}
