import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TradeButtonRow from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow";
import type { StrikeLadder } from "@/types";

const ladder: StrikeLadder = {
  expiry: "2026-04-25",
  underlyingPrice: 201.7,
  rows: [
    { strike: 190, side: "put", bucket: "15Δ", delta: -0.15, bid: 1.8, ask: 2.0, mid: 1.9, iv: 0.83, yieldPct: 0.010, pop: 0.85, theta: -0.18, gamma: 0.014, vega: 0.24, oi: 800, volume: 300 },
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yieldPct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yieldPct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yieldPct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yieldPct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
    { strike: 215, side: "call", bucket: "15Δ", delta: 0.15, bid: 2.1, ask: 2.3, mid: 2.2, iv: 0.82, yieldPct: 0.011, pop: 0.85, theta: -0.19, gamma: 0.015, vega: 0.25, oi: 700, volume: 250 },
  ],
};

describe("TradeButtonRow (Round-12 DR-1: defined-risk only)", () => {
  it("renders defined-risk buttons including directional debit verticals", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    expect(container.textContent).toMatch(/bull put spread/i);
    expect(container.textContent).toMatch(/bear call spread/i);
    expect(container.textContent).toMatch(/bull call spread/i);
    expect(container.textContent).toMatch(/bear put spread/i);
    expect(container.textContent).toMatch(/long call/i);
    expect(container.textContent).toMatch(/long put/i);
    expect(container.textContent).toMatch(/iron condor/i);
    expect(container.textContent).toMatch(/long straddle/i);
    // No undefined-risk pills any more — every button is capped.
    expect(container.textContent).toMatch(/defined risk/i);
    expect(container.textContent).not.toMatch(/undefined risk/i);
  });

  it("marks Claude's recommended setup without changing other buttons", () => {
    const { container } = render(
      <TradeButtonRow
        symbol="NVDA"
        ladder={ladder}
        recommendedSetup="bull call spread"
      />,
    );
    const recommended = container.querySelector(
      'a[data-slot="trade-button-bull-call-spread"]',
    ) as HTMLAnchorElement;
    const nonRecommended = container.querySelector(
      'a[data-slot="trade-button-bear-put-spread"]',
    ) as HTMLAnchorElement;

    expect(recommended.textContent).toMatch(/Suggested/i);
    expect(nonRecommended.textContent).not.toMatch(/Suggested/i);
  });

  // ── EOP-AUDIT 2026-05-06 / B1.11 — RECOMMENDED badge prominence ─
  it("shows a 🎯 RECOMMENDED badge on the recommended card with brand tint and 2px border (B1.11)", () => {
    const { container } = render(
      <TradeButtonRow
        symbol="NVDA"
        ladder={ladder}
        recommendedSetup="long straddle"
      />,
    );
    const recommended = container.querySelector(
      'a[data-slot="trade-button-long-straddle"]',
    ) as HTMLAnchorElement;
    expect(recommended.getAttribute("data-recommended")).toBe("true");
    expect(recommended.className).toMatch(/border-2/);
    expect(recommended.className).toMatch(/brand-tint/);
    const badge = recommended.querySelector(
      '[data-slot="trade-button-recommended-badge"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/RECOMMENDED/i);
    expect(badge?.textContent).toContain("🎯");
  });

  it("non-recommended cards keep the 1px default border and no RECOMMENDED badge (B1.11)", () => {
    const { container } = render(
      <TradeButtonRow
        symbol="NVDA"
        ladder={ladder}
        recommendedSetup="long straddle"
      />,
    );
    const nonRec = container.querySelector(
      'a[data-slot="trade-button-iron-condor"]',
    ) as HTMLAnchorElement;
    expect(nonRec.getAttribute("data-recommended")).toBeNull();
    expect(nonRec.className).not.toMatch(/border-2/);
    expect(
      nonRec.querySelector('[data-slot="trade-button-recommended-badge"]'),
    ).toBeNull();
  });

  // ── EOP-AUDIT 2026-05-06 / B1.15 — DEFINED RISK semantic copy ─
  it("vertical / iron condor cards keep the ✓ DEFINED RISK pill (B1.15)", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const ic = container.querySelector('a[data-slot="trade-button-iron-condor"]');
    expect(ic?.getAttribute("data-risk-shape")).toBe("defined_risk");
    expect(ic?.textContent).toMatch(/Defined risk/i);
    expect(ic?.textContent).not.toMatch(/Defined loss/i);
  });

  it("long straddle / strangle / long call / long put cards read ✓ DEFINED LOSS · ∞ UPSIDE (B1.15)", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const ls = container.querySelector('a[data-slot="trade-button-long-straddle"]');
    expect(ls?.getAttribute("data-risk-shape")).toBe("defined_loss_unbounded_upside");
    expect(ls?.textContent).toMatch(/Defined loss/i);
    expect(ls?.textContent).toMatch(/upside|∞/i);

    const lc = container.querySelector('a[data-slot="trade-button-long-call"]');
    expect(lc?.getAttribute("data-risk-shape")).toBe("defined_loss_unbounded_upside");
    expect(lc?.textContent).toMatch(/Defined loss/i);
  });

  it("bull put spread sells ATM put, buys 30Δ put", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-bull-put-spread"]') as HTMLAnchorElement;
    expect(btn).not.toBeNull();
    const href = btn.getAttribute("href")!;
    expect(href).toMatch(/\/trade\?/);
    expect(href).toContain("symbol=NVDA");
    expect(href).toContain("combo_type=vertical_spread");
    // ATM put at 200 sold; 30Δ put at 195 bought
    expect(href).toMatch(/200.*sell/);
    expect(href).toMatch(/195.*buy/);
  });

  it("bear call spread sells ATM call, buys 30Δ call", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-bear-call-spread"]') as HTMLAnchorElement;
    const href = btn.getAttribute("href")!;
    expect(href).toContain("combo_type=vertical_spread");
    expect(href).toMatch(/205.*sell/);
    expect(href).toMatch(/210.*buy/);
  });

  it("bull call spread buys ATM call and sells 30Δ call", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-bull-call-spread"]') as HTMLAnchorElement;
    const href = btn.getAttribute("href")!;
    expect(href).toContain("combo_type=vertical_spread");
    expect(href).toMatch(/205.*buy/);
    expect(href).toMatch(/210.*sell/);
  });

  it("bear put spread buys ATM put and sells 30Δ put", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-bear-put-spread"]') as HTMLAnchorElement;
    const href = btn.getAttribute("href")!;
    expect(href).toContain("combo_type=vertical_spread");
    expect(href).toMatch(/200.*buy/);
    expect(href).toMatch(/195.*sell/);
  });

  it("long call buys the ATM call as a capped-debit single leg", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-long-call"]') as HTMLAnchorElement;
    const href = btn.getAttribute("href")!;
    expect(href).toContain("side=buy");
    expect(href).toMatch(/205/);
    expect(href).not.toContain("combo_type");
  });

  it("long put buys the ATM put as a capped-debit single leg", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-long-put"]') as HTMLAnchorElement;
    const href = btn.getAttribute("href")!;
    expect(href).toContain("side=buy");
    expect(href).toMatch(/200/);
    expect(href).not.toContain("combo_type");
  });

  it("iron condor encodes 4 legs (sell 30Δ put/call, buy 15Δ put/call)", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-iron-condor"]') as HTMLAnchorElement;
    expect(btn).not.toBeNull();
    const href = btn.getAttribute("href")!;
    expect(href).toContain("combo_type=iron_condor");
    // Short 30Δ put / call = 195 / 210; long 15Δ wings = 190 / 215
    expect(href).toMatch(/195.*sell/);
    expect(href).toMatch(/210.*sell/);
    expect(href).toMatch(/190.*buy/);
    expect(href).toMatch(/215.*buy/);
  });

  it("long straddle buys both ATM legs (debit max-loss)", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-long-straddle"]') as HTMLAnchorElement;
    expect(btn).not.toBeNull();
    const href = btn.getAttribute("href")!;
    // Both ATM contracts BOUGHT, not sold — capped loss = debit paid
    expect(href).toMatch(/205.*buy/);
    expect(href).toMatch(/200.*buy/);
    expect(href).not.toMatch(/sell/);
  });

  it("renders disabled state when ladder is null", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={null} />);
    expect(container.textContent).toMatch(/unavailable|no chain/i);
  });

  it("disables trade links for synthetic option chains", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={{ ...ladder, isDemo: true }} />);
    expect(container.textContent).toMatch(/synthetic options chain/i);
    expect(container.querySelectorAll('a[href^="/trade"]').length).toBe(0);
  });

  it("disables trade links when backend error codes mark a synthetic chain", () => {
    const { container } = render(
      <TradeButtonRow symbol="NVDA" ladder={ladder} syntheticChain />,
    );
    expect(container.textContent).toMatch(/synthetic options chain/i);
    expect(container.querySelectorAll('a[href^="/trade"]').length).toBe(0);
  });

  it("disables trade links after the earnings event has passed", () => {
    const { container } = render(
      <TradeButtonRow symbol="NVDA" ladder={ladder} reportState="today_done" />,
    );
    expect(container.textContent).toMatch(/already passed/i);
    expect(container.querySelectorAll('a[href^="/trade"]').length).toBe(0);
  });

  it("disables trade links when row expiries do not match the ladder expiry", () => {
    const mismatched: StrikeLadder = {
      ...ladder,
      rows: ladder.rows.map((row, idx) => ({
        ...row,
        expiry: idx === 0 ? "2026-05-01" : ladder.expiry,
      })),
    };
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={mismatched} />);
    expect(container.textContent).toMatch(/expiry mismatch/i);
    expect(container.querySelectorAll('a[href^="/trade"]').length).toBe(0);
  });

  it("normalizes dot share-class tickers before building OCC symbols", () => {
    const { container } = render(<TradeButtonRow symbol="BRK.B" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-long-call"]') as HTMLAnchorElement;
    const href = decodeURIComponent(btn.getAttribute("href")!);
    expect(href).toContain("contract=BRKB260425C00205000");
    expect(href).not.toContain("BRK.B260425");
  });

  it("includes max-loss copy in the link description", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-bull-put-spread"]') as HTMLAnchorElement;
    const describedBy = btn.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("trade-button-bull-put-spread-risk-copy");
    expect(container.textContent).toMatch(/max loss/i);
  });

  // ─── Wave V V5: pre-trade slippage forecast surface ────────
  describe("Wave V V5 — pre-trade slippage forecast", () => {
    it("renders 'Expected fill' line when fillForecast is provided", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.40,
            p10Fill: 6.55,
            p90Fill: 6.25,
            expectedSlippageDollars: 22,
            confidence: "medium",
            reasoning: ["patient fill mode (10% of spread per leg)"],
          }}
        />,
      );
      const node = container.querySelector('[data-slot="trade-button-fill-forecast"]');
      expect(node).not.toBeNull();
      expect(node!.textContent).toMatch(/Expected fill/i);
      expect(node!.textContent).toMatch(/6\.40/);
      expect(node!.textContent).toMatch(/6\.25/);
      expect(node!.textContent).toMatch(/6\.55/);
      expect(node!.textContent).toMatch(/22 slippage/);
    });

    it("renders the 'Net credit $X.XX' anchor when net is positive", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.40,
            p10Fill: 6.55,
            p90Fill: 6.25,
            expectedSlippageDollars: 22,
            confidence: "medium",
            reasoning: [],
          }}
        />,
      );
      expect(container.textContent).toMatch(/Net credit \$6\.62/);
    });

    it("renders the 'Net debit' anchor when net is negative", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={-1.05}
          recommendedSetupFillForecast={{
            targetMid: -1.05,
            expectedFill: -1.06,
            p10Fill: -1.055,
            p90Fill: -1.065,
            expectedSlippageDollars: 1,
            confidence: "high",
            reasoning: [],
          }}
        />,
      );
      expect(container.textContent).toMatch(/Net debit \$1\.05/);
    });

    it("appends '(low confidence — illiquid chain)' when confidence is low", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.40,
            p10Fill: 6.55,
            p90Fill: 6.25,
            expectedSlippageDollars: 22,
            confidence: "low",
            reasoning: ["1 illiquid leg adds 2.5x penalty"],
          }}
        />,
      );
      const lowConf = container.querySelector('[data-slot="fill-forecast-low-confidence"]');
      expect(lowConf).not.toBeNull();
      expect(lowConf!.textContent).toMatch(/low confidence/i);
      expect(lowConf!.textContent).toMatch(/illiquid chain/i);
    });

    it("does NOT append low-confidence suffix when confidence is medium or high", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.40,
            p10Fill: 6.55,
            p90Fill: 6.25,
            expectedSlippageDollars: 22,
            confidence: "high",
            reasoning: [],
          }}
        />,
      );
      expect(container.querySelector('[data-slot="fill-forecast-low-confidence"]')).toBeNull();
    });

    it("color-codes slippage as profit when below $5", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.61,
            p10Fill: 6.61,
            p90Fill: 6.60,
            expectedSlippageDollars: 2,
            confidence: "high",
            reasoning: [],
          }}
        />,
      );
      const slip = container.querySelector('[data-slot="fill-forecast-slippage"]');
      expect(slip!.className).toContain("u-profit");
    });

    it("color-codes slippage as warn when between $5 and $25", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.40,
            p10Fill: 6.55,
            p90Fill: 6.25,
            expectedSlippageDollars: 12,
            confidence: "medium",
            reasoning: [],
          }}
        />,
      );
      const slip = container.querySelector('[data-slot="fill-forecast-slippage"]');
      expect(slip!.className).toContain("u-warn");
    });

    it("color-codes slippage as loss when above $25", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={{
            targetMid: 6.62,
            expectedFill: 6.10,
            p10Fill: 6.30,
            p90Fill: 5.90,
            expectedSlippageDollars: 52,
            confidence: "low",
            reasoning: [],
          }}
        />,
      );
      const slip = container.querySelector('[data-slot="fill-forecast-slippage"]');
      expect(slip!.className).toContain("u-loss");
    });

    it("hides the line entirely when fillForecast is null", () => {
      const { container } = render(
        <TradeButtonRow
          symbol="NVDA"
          ladder={ladder}
          recommendedNetCreditOrDebit={6.62}
          recommendedSetupFillForecast={null}
        />,
      );
      expect(container.querySelector('[data-slot="trade-button-fill-forecast"]')).toBeNull();
    });
  });
});
