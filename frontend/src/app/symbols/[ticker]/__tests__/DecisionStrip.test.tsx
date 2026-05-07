import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import type { Analysis, ClaudeStructured } from "@/types";

import { DecisionStrip } from "../_sections/DecisionStrip";
import { verdictTone } from "../_lib/verdictTone";

function makeClaude(overrides: Partial<ClaudeStructured> = {}): ClaudeStructured {
  return {
    verdict: "bullish",
    directionMagnitude: { bullCasePct: 60, bearCasePct: 40 },
    thesis: "thesis",
    catalysts: [],
    risks: [],
    suggestedPlay: "long call",
    suggestedPlayReason: "reason",
    confidence: 0.8,
    model: "claude-x",
    generatedAt: "2026-05-05T00:00:00Z",
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    symbol: "NVDA",
    technicalScore: 0.7,
    fundamentalScore: 0.6,
    sentimentScore: 0.5,
    composite: 0.74,
    summary: "Bullish trend with strong volume",
    signals: [],
    ...overrides,
  };
}

describe("DecisionStrip", () => {
  it("renders BUY pill when suggestedPlay is a long_call (long call)", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={makeClaude({ suggestedPlay: "long call" })}
        analysis={makeAnalysis()}
      />,
    );
    const pill = getByTestId("verdict-pill");
    expect(pill.getAttribute("data-tone")).toBe("buy");
    expect(pill.textContent).toContain("BUY");
    expect(pill.textContent).toContain("0.74 conviction");
  });

  it("falls back to analysis.summary when claudeStructured is undefined", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={null}
        analysis={makeAnalysis({ summary: "buy" })}
      />,
    );
    const pill = getByTestId("verdict-pill");
    expect(pill.getAttribute("data-tone")).toBe("buy");
    expect(pill.textContent).toContain("BUY");
  });

  it("conviction bar fill width = 74% when composite = 0.74", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={makeClaude()}
        analysis={makeAnalysis({ composite: 0.74 })}
      />,
    );
    const fill = getByTestId("conviction-bar-fill") as HTMLElement;
    expect(fill.style.width).toBe("74%");
  });

  it("conviction bar exposes role=progressbar with aria-valuenow", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={makeClaude()}
        analysis={makeAnalysis({ composite: 0.74 })}
      />,
    );
    const bar = getByTestId("conviction-bar");
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0.74");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("1");
  });

  it("verdictTone(undefined) === 'neutral' and does not crash", () => {
    expect(verdictTone(undefined)).toBe("neutral");
    expect(verdictTone(null)).toBe("neutral");
    expect(verdictTone("")).toBe("neutral");
    expect(verdictTone("totally-unknown-action")).toBe("neutral");
  });

  it("renders the region landmark with the correct aria-label", () => {
    const { getByTestId } = render(
      <DecisionStrip symbol="NVDA" claudeStructured={null} analysis={null} />,
    );
    const region = getByTestId("decision-strip");
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("AI verdict and conviction");
  });

  it("shows 'Analysis pending' with neutral StatusDot when both inputs are null", () => {
    const { getByTestId, queryByTestId } = render(
      <DecisionStrip symbol="NVDA" claudeStructured={null} analysis={null} />,
    );
    const pending = getByTestId("verdict-pending");
    expect(pending.textContent).toContain("Analysis pending");
    expect(queryByTestId("verdict-pill")).toBeNull();
    expect(queryByTestId("conviction-bar")).toBeNull();
  });

  it("appends ' (market-wide)' to the regime pill label", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={makeClaude()}
        analysis={makeAnalysis()}
        marketRegime={{ regime: "bull", label: "bull", vix_level: 16 }}
      />,
    );
    const regime = getByTestId("decision-strip-regime");
    expect(regime.textContent).toContain("(market-wide)");
  });

  it("maps long_put / bear* / sell to SELL tone", () => {
    expect(verdictTone("long put")).toBe("sell");
    expect(verdictTone("bear call spread")).toBe("sell");
    expect(verdictTone("sell")).toBe("sell");
  });

  it("maps neutral defined-risk setups (iron condor, calendar) to HOLD tone", () => {
    expect(verdictTone("iron condor")).toBe("hold");
    expect(verdictTone("calendar spread")).toBe("hold");
    expect(verdictTone("hold")).toBe("hold");
  });

  it("maps covered call (long stock + short call income strategy) to HOLD tone", () => {
    expect(verdictTone("covered call")).toBe("hold");
  });

  it("conviction bar exposes aria-label and aria-valuetext for screen readers", () => {
    const { getByTestId } = render(
      <DecisionStrip
        symbol="NVDA"
        claudeStructured={makeClaude()}
        analysis={makeAnalysis({ composite: 0.74 })}
      />,
    );
    const bar = getByTestId("conviction-bar");
    expect(bar.getAttribute("aria-label")).toBe("Conviction");
    expect(bar.getAttribute("aria-valuetext")).toBe("74%");
  });

  // ─── P1 audit (2026-05-06): confidence-bucket tone parity with EOP ─
  describe("P1 audit (2026-05-06) — confidence-bucket pill tone", () => {
    it("verdict pill carries brand tone when conviction >= 0.65 (high)", () => {
      const { getByTestId } = render(
        <DecisionStrip
          symbol="NVDA"
          claudeStructured={makeClaude({ suggestedPlay: "long call", confidence: 0.75 })}
          analysis={makeAnalysis({ composite: 0.75 })}
        />,
      );
      const pill = getByTestId("verdict-pill");
      expect(pill.className).toMatch(/u-brand/);
      expect(pill.className).toMatch(/border-\[color:var\(--brand\)\]/);
    });

    it("verdict pill carries muted tone when conviction is in [0.40, 0.65) (medium)", () => {
      const { getByTestId } = render(
        <DecisionStrip
          symbol="NVDA"
          claudeStructured={makeClaude({ suggestedPlay: "long call", confidence: 0.50 })}
          analysis={makeAnalysis({ composite: 0.50 })}
        />,
      );
      const pill = getByTestId("verdict-pill");
      expect(pill.className).toMatch(/u-muted/);
      expect(pill.className).toMatch(/border-\[color:var\(--border\)\]/);
    });

    it("verdict pill carries warn tone when conviction < 0.40 (low)", () => {
      const { getByTestId } = render(
        <DecisionStrip
          symbol="NVDA"
          claudeStructured={makeClaude({ suggestedPlay: "long call", confidence: 0.30 })}
          analysis={makeAnalysis({ composite: 0.30 })}
        />,
      );
      const pill = getByTestId("verdict-pill");
      expect(pill.className).toMatch(/text-state-warning-fg/);
      expect(pill.className).toMatch(/border-state-warning-border/);
    });

    it("falls back to verdictTone setup-string mapping when conviction is null (no analysis composite, no claude confidence)", () => {
      // ClaudeStructured.confidence is required but is non-finite here so
      // pickConviction returns null; analysis composite is also non-finite.
      const { getByTestId } = render(
        <DecisionStrip
          symbol="NVDA"
          claudeStructured={makeClaude({
            suggestedPlay: "long call",
            confidence: Number.NaN,
          })}
          analysis={makeAnalysis({ composite: Number.NaN, summary: "long call" })}
        />,
      );
      const pill = getByTestId("verdict-pill");
      // Without conviction we keep the legacy tone (BUY/profit) via the
      // borderColor inline-style; no warn or muted class applied.
      expect(pill.className).not.toMatch(/text-state-warning-fg/);
      expect(pill.className).not.toMatch(/u-muted/);
      // Tone attribute still derives from the setup string ("long call" → buy).
      expect(pill.getAttribute("data-tone")).toBe("buy");
    });
  });
});
