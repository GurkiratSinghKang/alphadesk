import "./setup-mocks";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import OptionsPayoffPanel, { buildSvgModel } from "@/components/options/OptionsPayoffPanel";
import {
  calculatePayoffSummary,
  type OptionStrategyDraft,
  type OptionStrategyLeg,
} from "@/lib/optionsPayoff";

// PM-A 2026-05-05: PM-A/6 tests for the redesigned options payoff
// panel. Covers the new buildSvgModel return-shape fields
// (maxProfitCoord, yAxisTicks, breakevenLeader) and renders the
// component with a long-straddle and iron-condor draft to verify
// the gradient defs and breakeven callouts surface in the SVG.

function leg(
  kind: "call" | "put",
  strike: number,
  side: "buy" | "sell",
  entryPrice: number | null,
): OptionStrategyLeg {
  const cp = kind === "call" ? "C" : "P";
  return {
    id: `${kind}-${strike}-${side}`,
    occSymbol: `AAPL260501${cp}${String(strike * 1000).padStart(8, "0")}`,
    underlying: "AAPL",
    expiry: "2026-05-01",
    kind,
    strike,
    side,
    qty: 1,
    entryPrice,
  };
}

function makeDraft(
  legs: OptionStrategyLeg[],
  comboType?: string,
  spot = 100,
): OptionStrategyDraft {
  return {
    underlying: "AAPL",
    spotPrice: spot,
    label: "test",
    source: "trade",
    comboType: comboType ?? null,
    legs,
  };
}

describe("buildSvgModel", () => {
  it("returns maxProfitCoord with finite (x, y, pnl, price) for a capped strategy", () => {
    // Bull call spread: capped max profit between strikes.
    const draft = makeDraft([
      leg("call", 100, "buy", 6),
      leg("call", 110, "sell", 2),
    ]);
    const summary = calculatePayoffSummary(draft);
    const model = buildSvgModel(summary.payoffPoints, summary);
    expect(model).not.toBeNull();
    expect(model!.maxProfitCoord).not.toBeNull();
    expect(model!.maxProfitCoord!.label).toBeUndefined();
    expect(Number.isFinite(model!.maxProfitCoord!.pnl)).toBe(true);
    expect(model!.maxProfitCoord!.pnl).toBeGreaterThan(0);
    // Coordinates land within the chart's plot area.
    expect(model!.maxProfitCoord!.x).toBeGreaterThanOrEqual(model!.padding);
    expect(model!.maxProfitCoord!.x).toBeLessThanOrEqual(model!.width - model!.padding);
    expect(model!.maxProfitCoord!.y).toBeGreaterThanOrEqual(model!.yTop);
    expect(model!.maxProfitCoord!.y).toBeLessThanOrEqual(model!.yBottom);
  });

  it("returns maxProfitCoord.label === '∞' when summary.maxProfit.kind === 'unlimited'", () => {
    // Long call: unbounded upside.
    const draft = makeDraft([leg("call", 100, "buy", 5)]);
    const summary = calculatePayoffSummary(draft);
    expect(summary.maxProfit.kind).toBe("unlimited");
    const model = buildSvgModel(summary.payoffPoints, summary);
    expect(model).not.toBeNull();
    expect(model!.maxProfitCoord).not.toBeNull();
    expect(model!.maxProfitCoord!.label).toBe("∞");
    expect(model!.maxProfitCoord!.pnl).toBe(Infinity);
  });

  it("returns yAxisTicks with at least 3 entries when range is non-zero", () => {
    const draft = makeDraft([
      leg("call", 100, "buy", 6),
      leg("call", 110, "sell", 2),
    ]);
    const summary = calculatePayoffSummary(draft);
    const model = buildSvgModel(summary.payoffPoints, summary);
    expect(model).not.toBeNull();
    expect(model!.yAxisTicks.length).toBeGreaterThanOrEqual(3);
    // $0 should always be in the set when the range straddles zero.
    expect(model!.yAxisTicks.some((t) => t.label === "$0")).toBe(true);
  });

  it("returns breakevenLeader with the same count as summary.breakevens", () => {
    // Iron condor — two breakevens.
    const draft = makeDraft(
      [
        leg("put", 90, "sell", 2),
        leg("put", 85, "buy", 1),
        leg("call", 110, "sell", 2),
        leg("call", 115, "buy", 1),
      ],
      "iron_condor",
    );
    const summary = calculatePayoffSummary(draft);
    const model = buildSvgModel(summary.payoffPoints, summary);
    expect(model).not.toBeNull();
    expect(model!.breakevenLeader).toHaveLength(summary.breakevens.length);
    // Each leader has chart-projected x within plot area.
    for (const leader of model!.breakevenLeader) {
      expect(leader.x).toBeGreaterThanOrEqual(model!.padding);
      expect(leader.x).toBeLessThanOrEqual(model!.width - model!.padding);
    }
  });
});

describe("OptionsPayoffPanel render", () => {
  it("renders a long straddle with profit-tint and loss-tint gradient defs", () => {
    const draft = makeDraft(
      [
        leg("call", 100, "buy", 5),
        leg("put", 100, "buy", 4),
      ],
      "long_straddle",
    );
    const { container } = render(<OptionsPayoffPanel draft={draft} />);
    const profitGradient = container.querySelector("#payoff-profit-fill");
    const lossGradient = container.querySelector("#payoff-loss-fill");
    expect(profitGradient).not.toBeNull();
    expect(lossGradient).not.toBeNull();
    // The strategy caption should also surface for a long straddle.
    expect(container.textContent).toMatch(/big move in either direction/i);
  });

  it("renders an iron condor with two breakeven callouts on the chart", () => {
    const draft = makeDraft(
      [
        leg("put", 90, "sell", 2),
        leg("put", 85, "buy", 1),
        leg("call", 110, "sell", 2),
        leg("call", 115, "buy", 1),
      ],
      "iron_condor",
    );
    const { container } = render(<OptionsPayoffPanel draft={draft} />);
    // PM-A renders breakeven labels as <text>BE $X</text>. There
    // should be exactly two for an iron condor.
    const beTexts = Array.from(container.querySelectorAll("text")).filter((node) =>
      (node.textContent ?? "").startsWith("BE "),
    );
    expect(beTexts.length).toBe(2);
    // The credit-strategy IV-crush note should surface.
    expect(container.textContent).toMatch(/selling IV crush/i);
  });
});
