import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StrikeLadder from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/StrikeLadder";
import type { StrikeLadder as LadderShape } from "@/types";

const ladder: LadderShape = {
  expiry: "2026-04-25",
  underlying_price: 201.7,
  rows: [
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yield_pct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yield_pct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yield_pct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yield_pct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
  ],
};

describe("StrikeLadder", () => {
  it("renders header row with strike/delta/mid/IV/yield/POP columns", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toMatch(/STRIKE/);
    expect(container.textContent).toMatch(/Δ|DELTA/);
    expect(container.textContent).toMatch(/MID/);
    expect(container.textContent).toMatch(/IV/);
    expect(container.textContent).toMatch(/YIELD|YLD/);
    expect(container.textContent).toMatch(/POP/);
  });

  it("renders each row with strike + bucket label", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toContain("195");
    expect(container.textContent).toContain("200");
    expect(container.textContent).toContain("205");
    expect(container.textContent).toContain("210");
    expect(container.textContent).toMatch(/put 30|30Δ put/i);
    expect(container.textContent).toMatch(/call 30|30Δ call/i);
  });

  it("shows expiry + underlying in the header", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toContain("2026-04-25");
    expect(container.textContent).toContain("201.70");
  });

  it("renders empty state when ladder is null", () => {
    const { container } = render(<StrikeLadder ladder={null} />);
    expect(container.textContent).toMatch(/no|unavailable|—/i);
  });
});
