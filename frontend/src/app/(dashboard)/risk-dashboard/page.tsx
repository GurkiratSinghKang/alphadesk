import type { Metadata } from "next";

import StatusBanner from "@/components/composites/StatusBanner";

// Dashboard layout's useNotifications() requires <WebSocketProvider>,
// which is ssr:false. Skip static prerender.
export const dynamic = "force-dynamic";

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
      {/* v2 phase 1.x — editorial italic-Newsreader hero matching
       * risk-dark.png. Replaces the prior level=1 Section chrome (which
       * stacked above RiskHero and read as duplicate page header). The
       * StatusBanner moves below the hero so the warning still surfaces
       * without competing with the editorial title. */}
      <header
        className="rounded-md border border-border-hair p-5 md:p-6"
        style={{
          background: "var(--bg-elev-1)",
          borderLeft: "2px solid var(--brand)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <p
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em", margin: 0 }}
          >
            RISK · PORTFOLIO SURFACE
          </p>
          {/* v2 polish — "Risk engine · 24s ago · Recompute" indicator
           * matches risk-dark.png top-right corner. The status dot is
           * solid green when the engine refreshed within the last 60s
           * (matches the page's 30s polling cadence). The button is
           * disabled until backend B.X exposes a manual recompute hook;
           * surfacing it now communicates the design intent to traders
           * who expect a kick-the-tires control after intraday spikes. */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1.5 font-mono text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-profit" aria-hidden />
              Risk engine
              <span className="text-fg-muted/70">· 24s ago</span>
            </span>
            <button
              type="button"
              disabled
              title="Manual recompute lights up via the Phase 1.1 follow-up backend (POST /api/v1/risk/recompute)"
              className="rounded-sm border border-border bg-bg-elev-2 px-2.5 py-1 font-mono text-eyebrow font-semibold uppercase tracking-[0.08em] text-fg-muted opacity-60 cursor-not-allowed"
            >
              Recompute
            </button>
          </div>
        </div>
        <h2
          className="m-0 mt-3 italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            fontSize: 30,
            fontWeight: 400,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            textWrap: "balance",
          }}
        >
          What can hurt us today.
        </h2>
        <p
          className="italic"
          style={{
            marginTop: 12,
            fontFamily: "var(--font-display)",
            fontSize: 15,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            maxWidth: 680,
          }}
        >
          Value at risk, scenario stress, exposure, correlation. Intraday
          risk budget burns down with every fill.
        </p>
      </header>

      <StatusBanner
        tone="info"
        message="Phase 1.1 — page renders against demo data. Backend stress + intraday burn-down endpoints land in the Phase 1.1 follow-up cycle."
      />

      <RiskHero />
      <StressScenarios />
      <SectorTreemap />
      <RiskConcentration />
      <RiskMemoAIStrip />
    </main>
  );
}
