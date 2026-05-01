import "../setup-mocks";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import DecisionStrip from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/DecisionStrip";
import type { ClaudeStructured, EarningsMetricsBlock } from "@/types";

const structured: ClaudeStructured = {
  verdict: "neutral-bull",
  directionMagnitude: { bullCasePct: 0.62, bearCasePct: 0.38 },
  thesis: "Premium is rich relative to the expected earnings move.",
  catalysts: ["AI capex guide"],
  risks: ["Guidance reset"],
  suggestedPlay: "iron condor",
  suggestedPlayReason: "Defined risk around a one sigma band.",
  confidence: 0.72,
  model: "claude-test",
  generatedAt: "2026-04-29T16:00:00Z",
};

const metrics: EarningsMetricsBlock = {
  ivRank: 78,
  ivPercentile: 74,
  currentIv: 0.61,
  hv20: 0.42,
  hv50: 0.38,
  hv100: 0.35,
  hvIvRatio: 0.69,
  expectedMovePct: 0.064,
  expectedMoveDollars: 12.8,
  histAvgAbsMovePct: 0.052,
  beatRate: 0.58,
  daysToEarnings: 1,
  daysToExpiry: 3,
};

describe("DecisionStrip", () => {
  it("renders the verdict without negative letter spacing", () => {
    const { getByText } = render(
      <DecisionStrip structured={structured} metrics={metrics} />,
    );

    const verdict = getByText("NEUTRAL-BULL");
    expect(verdict).toHaveStyle({ letterSpacing: "0" });
  });

  it("labels cached legacy undefined-risk plays as not tradeable", () => {
    const { container } = render(
      <DecisionStrip
        structured={{ ...structured, suggestedPlay: "short strangle" }}
        metrics={metrics}
      />,
    );

    expect(container.textContent).toMatch(/legacy, not tradeable/i);
  });
});
