"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import AgentChip from "@/components/primitives/AgentChip";

/**
 * RiskMemoAIStrip — Risk-archetype agent memo per v2-plan §1.1.
 *
 * Phase 1.1 demo. Real data wires through Phase 2 agent reframe
 * (B.2 backend exposes archetype-attributed memos). The italic
 * Newsreader body + golden pulse dot voice the editorial v2 tone
 * called out in the design bundle.
 */
export default function RiskMemoAIStrip() {
  return (
    <Section
      eyebrow="RISK · MEMO"
      title="What the risk agent thinks"
      description="Regime-aware analysis of current posture. Refreshed every 15 minutes; pinned in audit log."
    >
      <article className="rounded-md border border-border-hair bg-bg-elev-1 p-4 flex flex-col gap-3">
        <header className="flex items-center justify-between gap-3">
          <AgentChip archetype="risk" status="running" size="lg" />
          <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            ai-research-4.7 · 1.4s · just now
          </span>
        </header>
        <p className="font-display italic text-h3 text-fg leading-relaxed">
          &ldquo;Sector concentration <strong className="not-italic font-semibold text-loss">flagged</strong> &mdash;
          info-tech at 38.4% of book vs 35% cap. NVDA and MSFT alone
          contribute 13.6% of NAV. <strong className="not-italic font-semibold text-fg">Recommend</strong> trimming
          either name OR hedging via SMH puts (40Δ Jul,
          ~0.3% of NAV cost). Macro regime tilted{" "}
          <strong className="not-italic font-semibold text-state-warning">fragile</strong> on the
          last Regime run; tighter risk gates apply until VIX
          reverts below 18.&rdquo;
        </p>
        <footer className="flex items-center gap-3 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
          <span>Confidence 0.81</span>
          <span aria-hidden>·</span>
          <span>Inputs: position book · regime score · VaR snapshot · 30d sector returns</span>
        </footer>
      </article>
    </Section>
  );
}
