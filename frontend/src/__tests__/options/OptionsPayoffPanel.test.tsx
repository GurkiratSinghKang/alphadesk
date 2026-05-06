import "../setup-mocks";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OptionsPayoffPanel from "@/components/options/OptionsPayoffPanel";
import type { OptionStrategyDraft } from "@/lib/optionsPayoff";

const draft: OptionStrategyDraft = {
  underlying: "AAPL",
  spotPrice: 100,
  label: "Long call",
  source: "trade",
  legs: [
    {
      id: "AAPL260501C00100000:buy",
      occSymbol: "AAPL260501C00100000",
      underlying: "AAPL",
      expiry: "2026-05-01",
      kind: "call",
      strike: 100,
      side: "buy",
      qty: 1,
      entryPrice: 5,
    },
  ],
};

describe("OptionsPayoffPanel", () => {
  it("renders max profit, max loss, and chart (breakeven now lives on the chart)", () => {
    render(<OptionsPayoffPanel draft={draft} />);
    expect(screen.getByText("Options payoff")).toBeInTheDocument();
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    expect(screen.getAllByText("$500.00").length).toBeGreaterThan(0);
    // PM-A 2026-05-05: breakeven moved out of the MetricGrid into
    // an in-chart "BE $X" callout. The exact dollar string still
    // appears in the SVG markup as a <text>; assert that any
    // element on the page contains "BE $105.00" or that the SVG
    // has the breakeven callout content.
    expect(screen.getByText(/BE \$105\.00/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /options profit and loss/i })).toBeInTheDocument();
  });

  it("renders an explicit empty state", () => {
    render(<OptionsPayoffPanel draft={null} />);
    expect(screen.getByText(/open the builder/i)).toBeInTheDocument();
  });
});
