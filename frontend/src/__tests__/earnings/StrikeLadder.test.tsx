import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// PM-C row-expand mounts ContractNBBO inside expanded rows; that pulls
// in the React Query hook. Stub it out so the existing render-only
// tests don't need a QueryClientProvider.
vi.mock("@/hooks/useContractSnapshot", () => ({
  useContractSnapshot: () => ({ data: undefined, isLoading: false, error: null }),
}));

import StrikeLadder from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/StrikeLadder";
import type { StrikeLadder as LadderShape } from "@/types";

const ladder: LadderShape = {
  expiry: "2026-04-25",
  underlyingPrice: 201.7,
  rows: [
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yieldPct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yieldPct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yieldPct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yieldPct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
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

  // ── Round-4 additions ──────────────────────────────────────

  it("renders a DEMO DATA badge when ladder.isDemo is true (CLUSTER D/13)", () => {
    const demoLadder: LadderShape = { ...ladder, isDemo: true };
    const { container } = render(<StrikeLadder ladder={demoLadder} />);
    const badge = container.querySelector('[data-slot="strike-ladder-demo-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/DEMO DATA/i);
  });

  it("does not render DEMO DATA badge when isDemo is false / undefined", () => {
    const { container: c1 } = render(<StrikeLadder ladder={{ ...ladder, isDemo: false }} />);
    expect(c1.querySelector('[data-slot="strike-ladder-demo-badge"]')).toBeNull();
    const { container: c2 } = render(<StrikeLadder ladder={ladder} />);
    expect(c2.querySelector('[data-slot="strike-ladder-demo-badge"]')).toBeNull();
  });

  it("wraps the ladder in a scrollable region with role=region (CLUSTER E/15)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-label")).toMatch(/scrollable/i);
    expect(region?.getAttribute("tabIndex")).toBe("0");
    expect(region?.className).toMatch(/overflow-x-auto/);
  });

  // ── PM-C row-expand + Maverick FIX-E: chevron-button a11y ─────

  it("does NOT make rows interactive when underlying prop is missing (graceful degrade)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    const dataRows = container.querySelectorAll("tr.t-ladder-row.t-ladder-row--data");
    expect(dataRows.length).toBeGreaterThan(0);
    dataRows.forEach((row) => {
      expect(row.getAttribute("role")).not.toBe("button");
      expect(row.getAttribute("aria-expanded")).toBeNull();
    });
    // FIX-E: no chevron-button rendered when there's nothing to expand.
    expect(container.querySelectorAll('[data-slot="ladder-row-toggle"]').length).toBe(0);
  });

  // Maverick FIX-E (new-trader P0 #4): role=button + tabIndex moved off
  // <tr> onto a real <button> wrapping the chevron in the STRIKE cell.
  // Row stays a plain <tr> so SR table navigation works cell-by-cell.
  it("keeps <tr> a plain table row (FIX-E) — no role=button on the row itself", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const dataRows = container.querySelectorAll("tr.t-ladder-row.t-ladder-row--data");
    expect(dataRows.length).toBe(ladder.rows.length);
    dataRows.forEach((row) => {
      expect(row.getAttribute("role")).toBeNull();
      expect(row.getAttribute("tabIndex")).toBeNull();
      expect(row.getAttribute("aria-expanded")).toBeNull();
    });
  });

  it("renders a chevron <button> per row with aria-expanded / aria-controls / aria-label (FIX-E)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const buttons = container.querySelectorAll('[data-slot="ladder-row-toggle"]');
    expect(buttons.length).toBe(ladder.rows.length);
    buttons.forEach((btn, i) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(btn.getAttribute("aria-controls")).toMatch(/^nbbo-NVDA/);
      const row = ladder.rows[i];
      expect(btn.getAttribute("aria-label")).toBe(
        `Toggle NBBO for ${row.strike} ${row.side}`,
      );
    });
  });

  it("toggles aria-expanded + mounts the NBBO row when the chevron button is clicked", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstButton = container.querySelector('[data-slot="ladder-row-toggle"]') as HTMLButtonElement;
    expect(firstButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).toBeNull();
    fireEvent.click(firstButton);
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).not.toBeNull();
  });

  it("collapses when the same chevron button is clicked twice", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstButton = container.querySelector('[data-slot="ladder-row-toggle"]') as HTMLButtonElement;
    fireEvent.click(firstButton);
    fireEvent.click(firstButton);
    expect(firstButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).toBeNull();
  });

  it("only one row can be expanded at a time (single-expansion model preserved)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const buttons = container.querySelectorAll('[data-slot="ladder-row-toggle"]');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[data-slot="strike-ladder-nbbo-row"]').length).toBe(1);
  });

  // FIX-E: keyboard activation now comes for free via the native <button>
  // (Enter and Space both fire onClick), so no custom onKeyDown path.
  it("Enter / Space activate the chevron button via native semantics", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstButton = container.querySelector('[data-slot="ladder-row-toggle"]') as HTMLButtonElement;
    // Native <button> dispatches click on Enter/Space — simulate the
    // outcome rather than synthesising the Enter event (jsdom skips
    // the implicit click).
    fireEvent.click(firstButton);
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
  });

  // ── EOP-AUDIT 2026-05-06 / B1.13 — VOL/OI/LIQ + show-liquidity toggle ─
  describe("Show liquidity toggle (B1.13)", () => {
    const liquidLadder: LadderShape = {
      ...ladder,
      rows: ladder.rows.map((r, i) => ({
        ...r,
        liquidityScore: 0.2 + i * 0.25, // 0.2, 0.45, 0.70, 0.95
      })),
    };

    it("Show liquidity toggle is hidden by default and the new VOL/OI/LIQ columns aren't rendered", () => {
      const { container } = render(<StrikeLadder ladder={ladder} />);
      // Existing Show Greeks toggle still renders; Liquidity toggle
      // should also render because rows have finite volume / OI.
      const liqToggle = container.querySelector('[data-slot="ladder-liquidity-toggle"]');
      expect(liqToggle).not.toBeNull();
      // Columns themselves stay hidden until the toggle is clicked.
      expect(container.querySelector('[data-slot="ladder-cell-volume"]')).toBeNull();
      expect(container.querySelector('[data-slot="ladder-cell-oi"]')).toBeNull();
      expect(container.querySelector('[data-slot="ladder-cell-liquidity"]')).toBeNull();
    });

    it("toggling Show liquidity surfaces VOL / OI / LIQ cells with thousands separators", () => {
      const { container } = render(<StrikeLadder ladder={ladder} />);
      const toggle = container.querySelector(
        '[data-slot="ladder-liquidity-toggle"]',
      ) as HTMLButtonElement;
      fireEvent.click(toggle);
      const volCells = container.querySelectorAll('[data-slot="ladder-cell-volume"]');
      const oiCells = container.querySelectorAll('[data-slot="ladder-cell-oi"]');
      expect(volCells.length).toBe(ladder.rows.length);
      expect(oiCells.length).toBe(ladder.rows.length);
      // Thousands separator on a value like 2000 → "2,000".
      expect(Array.from(oiCells).map((td) => td.textContent)).toContain("2,000");
      expect(Array.from(volCells).map((td) => td.textContent)).toContain("900");
    });

    it("LIQ cell renders a coloured horizontal bar and the score (B1.13)", () => {
      const { container } = render(<StrikeLadder ladder={liquidLadder} />);
      const toggle = container.querySelector(
        '[data-slot="ladder-liquidity-toggle"]',
      ) as HTMLButtonElement;
      fireEvent.click(toggle);
      const liqCells = container.querySelectorAll('[data-slot="ladder-cell-liquidity"]');
      expect(liqCells.length).toBe(liquidLadder.rows.length);
      // First row (score 0.20) → red tone; last row (score 0.95) → green.
      const firstScore = liqCells[0].querySelector('[data-slot="liquidity-bar-fill"]') as HTMLElement;
      const lastScore = liqCells[liqCells.length - 1].querySelector('[data-slot="liquidity-bar-fill"]') as HTMLElement;
      expect(firstScore).not.toBeNull();
      expect(lastScore).not.toBeNull();
      // Width reflects clamped 0..1 → 0..100%.
      expect(firstScore.style.width).toBe("20%");
      expect(lastScore.style.width).toBe("95%");
    });
  });

  // ── EOP-AUDIT 2026-05-06 / B1.14 — column tooltips ───────────
  it("renders descriptive title attributes on STRIKE / Δ / MID / IV / YLD / POP / SIDE headers (B1.14)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    const headers = container.querySelectorAll("th");
    const titles = Array.from(headers).map((th) => th.getAttribute("title") ?? "");
    // Each abbreviation should be expanded somewhere in the matching tooltip.
    expect(titles.some((t) => /strike/i.test(t) && /bucket/i.test(t))).toBe(true);
    expect(titles.some((t) => /delta/i.test(t))).toBe(true);
    expect(titles.some((t) => /mid-?price/i.test(t))).toBe(true);
    expect(titles.some((t) => /implied volatility/i.test(t))).toBe(true);
    expect(titles.some((t) => /Premium yield/i.test(t))).toBe(true);
    expect(titles.some((t) => /Probability of Profit/i.test(t))).toBe(true);
    expect(titles.some((t) => /at-the-money|ATM/.test(t))).toBe(true);
  });
});
