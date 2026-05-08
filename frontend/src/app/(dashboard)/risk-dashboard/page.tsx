import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Risk dashboard — AlphaDesk",
  description:
    "Trader-facing risk view: VaR, scenario stress, sector exposure, beta correlation, concentration limits.",
};

/**
 * Phase 0 route shell. The full Risk dashboard is implemented in
 * Phase 1.1 — this shell exists so:
 *   1. ⌘K command palette + `g r` chord can target the route now.
 *   2. The `/risk` → `/legal/risk` migration ships in the same commit
 *      without leaving the trader-facing slug undefined.
 *   3. Internal links in TopBar nav (added in Phase 1.1) have a
 *      destination immediately upon navigation refactor.
 */
export default function RiskDashboardShell() {
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow="RISK · DASHBOARD"
        title="Risk dashboard"
        description="VaR, stress scenarios, sector heat, beta correlation, concentration. Trader-facing."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="The risk dashboard ships in Phase 1.1."
          description="Hero VaR (1d/5d, 95/99) + ES + intraday risk-budget burn-down. Scenario stress tests. Sector exposure heatmap. Beta + correlation matrix. Concentration limits with utilization bars. AI risk memo."
        />
      </Section>
    </main>
  );
}
