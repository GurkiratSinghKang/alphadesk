import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EarningsCalendarSidebar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar";
import type { CalendarRow } from "@/types";

const rows: CalendarRow[] = [
  { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: 201.7, change: -1.4, changePct: -0.007, ivRank: 78, premiumYieldCallAtm: 0.031, premiumYieldPutAtm: 0.028, expectedMovePct: 0.064, histAvgAbsMovePct: 0.052, claudeVerdict: "neutral-bull", claudeConfidence: 0.62, topSetup: "short strangle" },
  { symbol: "TSLA", company: "Tesla", sector: "Auto", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: 392, change: -8.2, changePct: -0.02, ivRank: 84, premiumYieldCallAtm: 0.042, premiumYieldPutAtm: 0.039, expectedMovePct: 0.081, histAvgAbsMovePct: 0.078, claudeVerdict: "neutral", claudeConfidence: 0.55, topSetup: "iron condor" },
  { symbol: "META", company: "Meta", sector: "Tech", reportDate: "2026-04-24", reportTime: "AMC", daysUntil: 2, price: 672, change: -16, changePct: -0.023, ivRank: 71, premiumYieldCallAtm: 0.026, premiumYieldPutAtm: 0.024, expectedMovePct: 0.058, histAvgAbsMovePct: 0.049, claudeVerdict: "bullish", claudeConfidence: 0.71, topSetup: "cash-secured put" },
];

describe("EarningsCalendarSidebar", () => {
  it("groups rows by reportDate with day headers", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="NVDA" onSelect={() => {}} />,
    );
    const groups = container.querySelectorAll('[data-slot="day-group"]');
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toMatch(/04-23|Apr 23/i);
    expect(container.textContent).toMatch(/04-24|Apr 24/i);
  });

  it("calls onSelect when a symbol row is clicked", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected={null} onSelect={onSelect} />,
    );
    fireEvent.click(getByText("TSLA"));
    expect(onSelect).toHaveBeenCalledWith("TSLA");
  });

  it("marks the selected symbol as active", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="META" onSelect={() => {}} />,
    );
    const active = container.querySelector('[data-selected="true"]');
    expect(active?.textContent).toContain("META");
  });

  it("shows IV rank chip on each row", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="NVDA" onSelect={() => {}} />,
    );
    expect(container.textContent).toContain("78");
    expect(container.textContent).toContain("84");
  });

  it("shows empty state when no rows and not loading", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={[]} loading={false} error={null} selected={null} onSelect={() => {}} />,
    );
    expect(container.textContent).toMatch(/no earnings|empty/i);
  });
});
