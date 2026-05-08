"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import { cn } from "@/lib/utils";

interface Scenario {
  id: string;
  label: string;
  desc: string;
  pnlImpact: number;
  pctNAV: number;
}

const SCENARIOS: Scenario[] = [
  { id: "rates-up", label: "Rates +50bps", desc: "Hawkish FOMC repricing", pnlImpact: -11_800, pctNAV: -0.66 },
  { id: "oil-down", label: "Oil −20%", desc: "Demand-shock energy selloff", pnlImpact: -32_100, pctNAV: -1.79 },
  { id: "vol-up", label: "Vol +30%", desc: "VIX 18.6 → 24.2 spike", pnlImpact: -22_400, pctNAV: -1.25 },
  { id: "spy-down", label: "SPY −10%", desc: "Broad market drawdown", pnlImpact: -41_200, pctNAV: -2.30 },
  { id: "dollar-up", label: "DXY +5%", desc: "USD strength, EM weakness", pnlImpact: -8_400, pctNAV: -0.47 },
  { id: "credit-wider", label: "HY +200bps", desc: "Credit spreads widening", pnlImpact: -16_900, pctNAV: -0.94 },
];

export default function StressScenarios() {
  return (
    <Section
      eyebrow="RISK · STRESS"
      title="Scenario stress tests"
      description="Hypothetical P&L impact under macro shocks. Re-run nightly; live recompute via Risk dashboard."
      right={
        <button
          type="button"
          disabled
          className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted opacity-50 cursor-not-allowed"
          title="Backend stress endpoint lands in Phase 1.1 follow-up"
        >
          Recompute →
        </button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SCENARIOS.map((s) => {
          const severe = s.pctNAV <= -1.5;
          return (
            <article
              key={s.id}
              className={cn(
                "rounded-md border bg-bg-elev-1 p-3 flex flex-col gap-1.5",
                severe ? "border-loss/40 bg-tint-down-1" : "border-border-hair",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-body font-medium text-fg">{s.label}</h3>
                <span className={cn("t-num-md", severe ? "text-loss" : "text-fg-dim")}>
                  ${s.pnlImpact.toLocaleString()}
                </span>
              </div>
              <p className="text-body-sm text-fg-muted leading-snug">{s.desc}</p>
              <p className={cn("text-eyebrow uppercase tracking-[0.08em] font-semibold", severe ? "text-loss" : "text-fg-muted")}>
                {s.pctNAV.toFixed(2)}% of NAV
              </p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
