"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import StatusDot from "@/components/primitives/StatusDot";

/**
 * RiskHero — VaR + Expected Shortfall + intraday risk-budget burn-down.
 *
 * Matches the v2 design's risk page hero exactly:
 *   - 5-card metric strip: PORTFOLIO VALUE, VAR 1d 95, VAR 1d 99,
 *     VAR 5d 99, EXPECTED SHORTFALL — ink-100 slabs with rust-tone
 *     for high-risk, amber for warn, near-black for portfolio value.
 *   - Intraday risk-budget burn-down bar with gold→rust gradient and
 *     60/80% threshold ticks.
 *
 * Numbers are seeded from a deterministic mock until backend
 * /api/v1/risk/var + /api/v1/risk/dashboard swap.
 */
export default function RiskHero() {
  const portfolioValue = 284512;
  const portfolioDelta = -1840;
  const var1d95 = 18420;
  const var1d99 = 26100;
  const var5d99 = 41200;
  const expectedShortfall = 24800;
  const dailyBudgetUsedPct = 32;
  const dailyBudgetCap = 60000;
  const dailyBudgetUsed = Math.round((dailyBudgetCap * dailyBudgetUsedPct) / 100);

  type Tone = "neutral" | "warn" | "down";
  const cards: Array<{ label: string; val: string; sub: string; tone: Tone }> = [
    {
      label: "PORTFOLIO VALUE",
      val: `$${portfolioValue.toLocaleString()}`,
      sub: `${portfolioDelta < 0 ? "−" : "+"}$${Math.abs(portfolioDelta).toLocaleString()} today`,
      tone: "neutral",
    },
    {
      label: "VAR · 1D · 95%",
      val: `$${var1d95.toLocaleString()}`,
      sub: `${((var1d95 / portfolioValue) * 100).toFixed(2)}% of book`,
      tone: "warn",
    },
    {
      label: "VAR · 1D · 99%",
      val: `$${var1d99.toLocaleString()}`,
      sub: `${((var1d99 / portfolioValue) * 100).toFixed(2)}% of book`,
      tone: "down",
    },
    {
      label: "VAR · 5D · 99%",
      val: `$${var5d99.toLocaleString()}`,
      sub: `${((var5d99 / portfolioValue) * 100).toFixed(2)}% of book`,
      tone: "down",
    },
    {
      label: "EXPECTED SHORTFALL",
      val: `$${expectedShortfall.toLocaleString()}`,
      sub: "tail beyond 99%",
      tone: "down",
    },
  ];

  return (
    <Section
      eyebrow="RISK · POSTURE"
      title="What can hurt us today"
      description="Value at risk, expected shortfall, intraday risk-budget burn-down. Refreshed every 30 seconds."
      level={1}
      right={
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-pill bg-tint-up-1 border border-profit/40 text-profit text-eyebrow font-semibold uppercase tracking-[0.08em]">
          <StatusDot tone="profit" size={5} />
          Within limits
        </span>
      }
    >
      {/* 5-card metric strip — design's exact shape. 1px border between
          cells reads as hairline divider on dark slab. */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
          gap: 1,
          background: "var(--border)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {cards.map((m) => (
          <div
            key={m.label}
            style={{
              padding: "16px 18px",
              background: "var(--ink-100)",
              position: "relative",
            }}
          >
            <div className="t-label" style={{ color: "var(--fg-hint)" }}>
              {m.label}
            </div>
            <div
              className="t-mono"
              style={{
                marginTop: 6,
                fontSize: 24,
                color:
                  m.tone === "down"
                    ? "var(--down-500)"
                    : m.tone === "warn"
                      ? "var(--gold-300)"
                      : "var(--ink-1000)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.val}
            </div>
            <div
              className="italic"
              style={{
                marginTop: 2,
                fontFamily: "var(--font-display)",
                fontSize: 13,
                color: "var(--fg-muted)",
              }}
            >
              {m.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Intraday risk budget burn-down — gold→rust gradient bar with
          60/80% threshold ticks matching the design's RiskBudgetCard. */}
      <div
        className="mt-4 rounded-md border border-border-hair p-4"
        style={{ background: "var(--ink-100)" }}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <div
              className="t-eyebrow-italic"
              style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
            >
              RISK BUDGET / INTRADAY
            </div>
            <div
              className="italic"
              style={{
                marginTop: 2,
                fontFamily: "var(--font-display)",
                fontSize: 18,
                color: "var(--ink-1000)",
              }}
            >
              ${dailyBudgetUsed.toLocaleString()} of $
              {dailyBudgetCap.toLocaleString()} used
            </div>
          </div>
          <div className="text-right">
            <div
              className="t-mono"
              style={{
                fontSize: 22,
                color: "var(--gold-300)",
                fontWeight: 500,
              }}
            >
              {dailyBudgetUsedPct}%
            </div>
            <div
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                color: "var(--fg-muted)",
              }}
            >
              ${(dailyBudgetCap - dailyBudgetUsed).toLocaleString()} remaining
            </div>
          </div>
        </div>
        <div
          className="mt-3 h-2 rounded-pill overflow-hidden relative"
          style={{ background: "var(--bg-elev-1)" }}
        >
          <div
            className="h-full"
            style={{
              width: `${dailyBudgetUsedPct}%`,
              background: "linear-gradient(90deg, var(--gold-500), var(--down-500))",
            }}
            role="progressbar"
            aria-valuenow={dailyBudgetUsedPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily risk budget used"
          />
          {[60, 80].map((threshold) => (
            <div
              key={threshold}
              aria-hidden
              style={{
                position: "absolute",
                left: `${threshold}%`,
                top: -2,
                bottom: -2,
                width: 1,
                background:
                  threshold === 80 ? "var(--down-500)" : "var(--gold-300)",
                opacity: 0.7,
              }}
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
