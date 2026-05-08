import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Users & access — AlphaDesk Admin",
};

export default function AdminUsersShell() {
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow="ADMIN · USERS"
        title="People & access"
        description="Approve applicants, provision dashboards, watch telemetry, revoke access, impersonate. Ships in Phase 1.6h."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="Admin · Users ships in Phase 1.6h."
          description="Applicants table with risk signals + approve/reject side-sheet. Active-users table with telemetry. User detail drawer. Impersonation with sticky red banner. Bulk actions."
        />
      </Section>
    </main>
  );
}
