import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TradeButtonRow from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow";
import type { StrikeLadder } from "@/types";

const ladder: StrikeLadder = {
  expiry: "2026-04-25",
  underlying_price: 201.7,
  rows: [
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yield_pct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yield_pct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yield_pct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yield_pct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
  ],
};

describe("TradeButtonRow", () => {
  it("renders three deep-link buttons: short call, short put, strangle", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    expect(container.textContent).toMatch(/short call/i);
    expect(container.textContent).toMatch(/short put/i);
    expect(container.textContent).toMatch(/strangle/i);
  });

  it("short call button links to /trade with ATM call contract", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-short-call"]') as HTMLAnchorElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("href")).toMatch(/\/trade\?/);
    expect(btn.getAttribute("href")).toContain("symbol=NVDA");
    expect(btn.getAttribute("href")).toMatch(/side=sell/);
    expect(btn.getAttribute("href")).toContain("205"); // ATM call strike
  });

  it("short put button links to ATM put", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-short-put"]') as HTMLAnchorElement;
    expect(btn.getAttribute("href")).toContain("200"); // ATM put strike
  });

  it("strangle button encodes two legs via ?legs= param", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-strangle"]') as HTMLAnchorElement;
    expect(btn.getAttribute("href")).toContain("legs=");
    // 30Δ put + 30Δ call strikes = 195 + 210
    expect(btn.getAttribute("href")).toMatch(/195.*sell/);
    expect(btn.getAttribute("href")).toMatch(/210.*sell/);
  });

  it("renders disabled state when ladder is null", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={null} />);
    expect(container.textContent).toMatch(/unavailable|no chain/i);
  });
});
