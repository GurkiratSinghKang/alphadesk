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
    // Label format migrated to locale-aware Intl (fmtDate):
    // en-US → "Thu, 04/23". Accept 04-23/04/23/Apr 23 so the test doesn't
    // pin to one separator style.
    expect(container.textContent).toMatch(/04.23|Apr 23/i);
    expect(container.textContent).toMatch(/04.24|Apr 24/i);
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

  it("names the restricting filter in the empty state and offers a reset link (B-107)", () => {
    const { container, getByRole } = render(
      <EarningsCalendarSidebar
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        filters={{ window: "current", min_iv_rank: 80, sort: "iv_rank" }}
      />,
    );
    expect(container.textContent).toMatch(/current week/i);
    expect(container.textContent).toMatch(/IV rank/i);
    expect(container.textContent).toContain("80");

    const events: Event[] = [];
    const handler = (e: Event) => { events.push(e); };
    window.addEventListener("alphadesk:earnings-reset-filters", handler);
    fireEvent.click(getByRole("button", { name: /loosen/i }));
    window.removeEventListener("alphadesk:earnings-reset-filters", handler);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("alphadesk:earnings-reset-filters");
  });

  it("opens in a new tab on Cmd/Ctrl-click instead of onSelect (B-40)", () => {
    const onSelect = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const originalSearch = window.location.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/strategies/earnings-options-play", search: "?window=both&sort=iv_rank" },
    });

    const { getByText } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected={null} onSelect={onSelect} />,
    );
    fireEvent.click(getByText("TSLA"), { metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("symbol=TSLA"),
      "_blank",
      "noopener,noreferrer",
    );
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain("sort=iv_rank");

    openSpy.mockRestore();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: originalSearch },
    });
  });

  it("Ctrl-click also opens in a new tab (B-40)", () => {
    const onSelect = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByText } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected={null} onSelect={onSelect} />,
    );
    fireEvent.click(getByText("NVDA"), { ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
