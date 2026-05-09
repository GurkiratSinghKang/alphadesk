import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import StatusBanner from "@/components/composites/StatusBanner";

import RiskHero from "./_components/RiskHero";
import StressScenarios from "./_components/StressScenarios";
import SectorTreemap from "./_components/SectorTreemap";
import RiskConcentration from "./_components/RiskConcentration";
import RiskMemoAIStrip from "./_components/RiskMemoAIStrip";

export const metadata: Metadata = {
  title: "Risk dashboard — AlphaDesk",
  description:
    "Trader-facing risk view: VaR, scenario stress, sector exposure, beta correlation, concentration limits.",
};

/**
 * /risk-dashboard — Phase 1.1 risk-posture page per v2-plan §1.1.
 *
 * Composition: identity band → RiskHero (VaR + ES + intraday budget)
 * → StressScenarios → SectorTreemap → RiskConcentration → RiskMemoAIStrip.
 *
 * The data is currently demo-seeded so the page renders end-to-end
 * without backend dependencies. Wire to /api/v1/risk/* via Phase 1.1
 * follow-up (the existing endpoints — getRiskDashboard, getCorrelation,
 * getExposure, getVar, getDrawdown, getCrowding — are all live; the
 * scenario stress and intraday-burndown endpoints are NEW).
 */
export default function RiskDashboardPage() {
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-8">
      <Section
        eyebrow="RISK · DASHBOARD"
        title="Risk dashboard"
        description="VaR, stress scenarios, sector heat, concentration. Refreshed every 30s; AI memo every 15 minutes."
        level={1}
      >
        <StatusBanner
          tone="info"
          message="Phase 1.1 — page renders against demo data. Backend stress + intraday burn-down endpoints land in the Phase 1.1 follow-up cycle."
        />
      </Section>

      <RiskHero />
      <StressScenarios />
      <SectorTreemap />
      <RiskConcentration />
      <RiskMemoAIStrip />
    </main>
  );
}
