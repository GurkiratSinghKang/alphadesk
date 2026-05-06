import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import type {
  ClaudeFullResearch,
  ClaudeStructured,
  EarningsMetricsBlock,
  IVTermPoint,
  SkewBlock,
} from "@/types";

import { OptionsThesisBand } from "../_sections/OptionsThesisBand";
import type { IVDataResult } from "../_hooks/useSymbolPageData";

function makeClaude(overrides: Partial<ClaudeStructured> = {}): ClaudeStructured {
  return {
    verdict: "bullish",
    directionMagnitude: { bullCasePct: 0.06, bearCasePct: -0.05 },
    thesis: "Strong setup with elevated IV ahead of catalyst.",
    catalysts: ["earnings beat"],
    risks: ["macro shock"],
    suggestedPlay: "long call",
    suggestedPlayReason: "directional with defined risk",
    confidence: 0.72,
    model: "claude-opus-4-7",
    generatedAt: "2026-05-05T00:00:00Z",
    ...overrides,
  };
}

function makeIV(overrides: Partial<IVDataResult> = {}): IVDataResult {
  return {
    ivRank: 60,
    ivPctl: 70,
    currentIV: 0.42,
    hvRatio: 1.2,
    fetchedAt: "2026-05-05T00:00:00Z",
    isDemo: false,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<EarningsMetricsBlock> = {}): EarningsMetricsBlock {
  return {
    ivRank: 60,
    ivPercentile: 70,
    currentIv: 0.42,
    hv20: 0.31,
    hv50: 0.28,
    hv100: 0.25,
    hvIvRatio: 1.35,
    expectedMovePct: 0.07,
    expectedMoveDollars: 12.4,
    histAvgAbsMovePct: 0.06,
    beatRate: 0.7,
    daysToEarnings: 5,
    daysToExpiry: 7,
    ...overrides,
  };
}

const TERM: IVTermPoint[] = [
  { expiry: "2026-05-09", dte: 4, atmIv: 0.55 },
  { expiry: "2026-05-16", dte: 11, atmIv: 0.45 },
];

const SKEW: SkewBlock = {
  putIv25d: 0.5,
  callIv25d: 0.46,
  skewPoints: 4,
  interpretation: "put-heavy skew",
};

const FULL: ClaudeFullResearch = {
  thesisParagraph: "Full research narrative...",
  comparableSetups: [],
  postEarningsDriftPlaybook: "drift",
  sectorBackdrop: "backdrop",
  analystConsensusDelta: "delta",
  whatWouldChangeMyMind: "mind",
  confidence: 0.8,
  model: "claude-opus-4-7",
  generatedAt: "2026-05-05T00:00:00Z",
};

describe("OptionsThesisBand", () => {
  it("renders IVTermSkew with shaped term + skew data when iv is present", () => {
    const { container, getByTestId } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={makeIV()}
        claudeStructured={makeClaude()}
        claudeFullResearch={FULL}
        ivTermStructure={TERM}
        skew={SKEW}
        metrics={makeMetrics()}
        isETF={false}
      />,
    );

    expect(getByTestId("options-thesis-band")).toBeInTheDocument();
    expect(getByTestId("options-section")).toBeInTheDocument();
    expect(getByTestId("iv-stat-row")).toBeInTheDocument();
    const termSkew = container.querySelector('[data-slot="iv-term-skew"]');
    expect(termSkew).not.toBeNull();
    expect(termSkew?.textContent).toContain("IV term structure");
    expect(termSkew?.textContent).toContain("Put/call skew");
  });

  it("renders AIThesisCard with the structured prop when claudeStructured is present", () => {
    const claude = makeClaude({ thesis: "Unique thesis text marker" });
    const { container } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={makeIV()}
        claudeStructured={claude}
        claudeFullResearch={null}
        ivTermStructure={TERM}
        skew={SKEW}
        metrics={makeMetrics()}
        isETF={false}
      />,
    );

    const aiCard = container.querySelector('[data-slot="ai-thesis"]');
    expect(aiCard).not.toBeNull();
    const thesisText = container.querySelector('[data-slot="ai-thesis-text"]');
    expect(thesisText?.textContent).toContain("Unique thesis text marker");
  });

  // T7 P1 #1: the symbol page passes showRunControls={false} so the dead
  // "▸ Run full research" button (which only had a no-op handler wired)
  // disappears from the rendered card.
  it("suppresses the FullResearchTrigger button on the symbol page (showRunControls=false)", () => {
    const { container, queryByRole } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={makeIV()}
        claudeStructured={makeClaude()}
        claudeFullResearch={null}
        ivTermStructure={TERM}
        skew={SKEW}
        metrics={makeMetrics()}
        isETF={false}
      />,
    );

    expect(container.querySelector('[data-slot="ai-thesis"]')).not.toBeNull();
    expect(queryByRole("button", { name: /Run full research/i })).toBeNull();
  });

  it("falls back to analysisSummary in a Quick analysis card when claudeStructured is null", () => {
    const { container, queryByTestId } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={makeIV()}
        claudeStructured={null}
        claudeFullResearch={null}
        analysisSummary="Bullish trend with strong volume"
        metrics={makeMetrics()}
        isETF={false}
      />,
    );

    const quick = container.querySelector('[data-slot="quick-analysis-card"]');
    expect(quick).not.toBeNull();
    expect(quick?.textContent).toContain("QUICK ANALYSIS");
    expect(quick?.textContent).toContain("Bullish trend with strong volume");
    expect(container.querySelector('[data-slot="ai-thesis"]')).toBeNull();
    expect(queryByTestId("thesis-empty-state")).toBeNull();
  });

  it("hides IVStatRow when iv.currentIV is null but still renders the thesis card", () => {
    const claude = makeClaude({ thesis: "Thesis renders without IV" });
    const { queryByTestId, getByTestId, container } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={{ ...makeIV(), currentIV: null }}
        claudeStructured={claude}
        claudeFullResearch={null}
        ivTermStructure={null}
        skew={null}
        isETF={false}
      />,
    );

    expect(queryByTestId("iv-stat-row")).toBeNull();
    expect(queryByTestId("options-section")).toBeNull();
    expect(getByTestId("thesis-section")).toBeInTheDocument();
    const thesisText = container.querySelector('[data-slot="ai-thesis-text"]');
    expect(thesisText?.textContent).toContain("Thesis renders without IV");
  });

  it("renders ETF empty-state copy in the thesis card when isETF=true and no claude data", () => {
    const { getByTestId, queryByTestId } = render(
      <OptionsThesisBand
        symbol="SPY"
        ivData={null}
        claudeStructured={null}
        claudeFullResearch={null}
        analysisSummary={null}
        isETF={true}
      />,
    );

    expect(queryByTestId("options-section")).toBeNull();
    const empty = getByTestId("thesis-empty-state");
    expect(empty.textContent).toMatch(/AI thesis available for individual equities only/i);
  });

  it("anchors options + thesis with id='options' and id='thesis'", () => {
    const { getByTestId } = render(
      <OptionsThesisBand
        symbol="NVDA"
        ivData={makeIV()}
        claudeStructured={makeClaude()}
        claudeFullResearch={null}
        ivTermStructure={TERM}
        skew={SKEW}
        metrics={makeMetrics()}
        isETF={false}
      />,
    );

    expect(getByTestId("options-section").getAttribute("id")).toBe("options");
    expect(getByTestId("thesis-section").getAttribute("id")).toBe("thesis");
    expect(getByTestId("options-section").className).toContain("scroll-mt-24");
    expect(getByTestId("thesis-section").className).toContain("scroll-mt-24");
  });
});
