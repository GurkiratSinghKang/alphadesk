import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "User detail — AlphaDesk Admin",
};

interface AdminUserDetailShellProps {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailShell({
  params,
}: AdminUserDetailShellProps) {
  const { id } = await params;
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow={`ADMIN · USER · ${id}`}
        title="User detail"
        description="Profile, plan, permissions, telemetry, scoped layout/limits/agents, audit, sessions, support. Phase 1.6h."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="User detail drawer-as-route lands in Phase 1.6h."
          description="Tabbed sub-IA: Profile · Plan · Permissions · Telemetry · Dashboard composer (scoped) · Limits & risk (scoped) · Agents (scoped) · Audit · Sessions · Support."
        />
      </Section>
    </main>
  );
}
