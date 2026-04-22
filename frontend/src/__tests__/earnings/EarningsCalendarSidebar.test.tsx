import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EarningsCalendarSidebar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar";
import type { CalendarRow } from "@/types";

const rows: CalendarRow[] = [
  { symbol: "NVDA", company: "Nvidia", sector: "Semis", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: 201.7, change: -1.4, change_pct: -0.007, iv_rank: 78, premium_yield_call_atm: 0.031, premium_yield_put_atm: 0.028, expected_move_pct: 0.064, hist_avg_abs_move_pct: 0.052, claude_verdict: "neutral-bull", claude_confidence: 0.62, top_setup: "short strangle" },
  { symbol: "TSLA", company: "Tesla", sector: "Auto", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: 392, change: -8.2, change_pct: -0.02, iv_rank: 84, premium_yield_call_atm: 0.042, premium_yield_put_atm: 0.039, expected_move_pct: 0.081, hist_avg_abs_move_pct: 0.078, claude_verdict: "neutral", claude_confidence: 0.55, top_setup: "iron condor" },
  { symbol: "META", company: "Meta", sector: "Tech", report_date: "2026-04-24", report_time: "AMC", days_until: 2, price: 672, change: -16, change_pct: -0.023, iv_rank: 71, premium_yield_call_atm: 0.026, premium_yield_put_atm: 0.024, expected_move_pct: 0.058, hist_avg_abs_move_pct: 0.049, claude_verdict: "bullish", claude_confidence: 0.71, top_setup: "cash-secured put" },
];

describe("EarningsCalendarSidebar", () => {
  it("groups rows by report_date with day headers", () => {
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
