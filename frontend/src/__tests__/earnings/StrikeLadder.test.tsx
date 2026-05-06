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

  // ── PM-C row-expand additions ─────────────────────────────────

  it("does NOT make rows interactive when underlying prop is missing (graceful degrade)", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    const dataRows = container.querySelectorAll("tr.t-ladder-row.t-ladder-row--data");
    expect(dataRows.length).toBeGreaterThan(0);
    dataRows.forEach((row) => {
      expect(row.getAttribute("role")).not.toBe("button");
      expect(row.getAttribute("aria-expanded")).toBeNull();
    });
  });

  it("makes rows clickable + role=button when underlying prop is provided", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const dataRows = container.querySelectorAll('tr[role="button"]');
    expect(dataRows.length).toBe(ladder.rows.length);
    dataRows.forEach((row) => {
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(row.getAttribute("aria-controls")).toMatch(/^nbbo-NVDA/);
      expect(row.getAttribute("tabIndex")).toBe("0");
    });
  });

  it("toggles aria-expanded + mounts the NBBO row on click", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstRow = container.querySelector('tr[role="button"]') as HTMLElement;
    expect(firstRow.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).toBeNull();
    fireEvent.click(firstRow);
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).not.toBeNull();
  });

  it("collapses again when the same row is clicked twice", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstRow = container.querySelector('tr[role="button"]') as HTMLElement;
    fireEvent.click(firstRow);
    fireEvent.click(firstRow);
    expect(firstRow.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-slot="strike-ladder-nbbo-row"]')).toBeNull();
  });

  it("only one row can be expanded at a time", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const rows = container.querySelectorAll('tr[role="button"]');
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    expect(rows[0].getAttribute("aria-expanded")).toBe("false");
    expect(rows[1].getAttribute("aria-expanded")).toBe("true");
    // Single NBBO row mounted
    expect(container.querySelectorAll('[data-slot="strike-ladder-nbbo-row"]').length).toBe(1);
  });

  it("Enter and Space keys toggle expansion", () => {
    const { container } = render(<StrikeLadder ladder={ladder} underlying="NVDA" />);
    const firstRow = container.querySelector('tr[role="button"]') as HTMLElement;
    fireEvent.keyDown(firstRow, { key: "Enter" });
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(firstRow, { key: " " });
    expect(firstRow.getAttribute("aria-expanded")).toBe("false");
  });
});
