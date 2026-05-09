"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import StatusDot from "@/components/primitives/StatusDot";

/**
 * RiskHero — VaR + Expected Shortfall + intraday risk-budget burn-down.
 *
 * Phase 1.1 demo. Numbers are seeded from a deterministic mock until
 * backend `/api/v1/risk/var` + `/api/v1/risk/dashboard` swap. All
 * dollar amounts honor paper-mode color treatment via the existing
 * Stat tone="muted" path (no live $ here so pure-display).
 */
export default function RiskHero() {
  const var1d95 = 18420;
  const var1d99 = 26100;
  const var5d95 = 41200;
  const expectedShortfall = 24800;
  const dailyBudgetUsedPct = 32;
  const dailyBudgetCap = 60000;
  const dailyBudgetUsed = Math.round((dailyBudgetCap * dailyBudgetUsedPct) / 100);

  return (
    <Section
      eyebrow="RISK · POSTURE"
      title="Risk hero"
      description="VaR (1d/5d, 95/99), expected shortfall, intraday risk-budget burn-down."
      level={1}
      right={
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-pill bg-tint-up-1 border border-profit/40 text-profit text-eyebrow font-semibold uppercase tracking-[0.08em]">
          <StatusDot tone="profit" size={5} />
          Within limits
        </span>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 rounded-md border border-border-hair bg-bg-elev-1 p-4">
        <Stat label="VaR 1d 95%" value={`$${var1d95.toLocaleString()}`} sub="1.2% of NAV" size="md" />
        <Stat label="VaR 1d 99%" value={`$${var1d99.toLocaleString()}`} sub="1.7% of NAV" size="md" />
        <Stat label="VaR 5d 95%" value={`$${var5d95.toLocaleString()}`} sub="2.7% of NAV" size="md" tone="muted" />
        <Stat label="Expected shortfall" value={`$${expectedShortfall.toLocaleString()}`} sub="cVaR 95%" size="md" />
        <div className="flex flex-col gap-1.5 col-span-2 md:col-span-3 lg:col-span-1">
          <span className="t-label">Daily budget</span>
          <div className="flex items-baseline gap-2">
            <span className="t-num-lg text-fg">${dailyBudgetUsed.toLocaleString()}</span>
            <span className="text-eyebrow text-fg-muted">/ ${dailyBudgetCap.toLocaleString()}</span>
          </div>
          <div className="h-2 w-full rounded-pill bg-bg-elev-2 overflow-hidden">
            <div
              className={
                dailyBudgetUsedPct > 70
                  ? "h-full bg-loss"
                  : dailyBudgetUsedPct > 50
                  ? "h-full bg-state-warning"
                  : "h-full bg-profit"
              }
              style={{ width: `${dailyBudgetUsedPct}%` }}
              role="progressbar"
              aria-valuenow={dailyBudgetUsedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Daily risk budget used"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
