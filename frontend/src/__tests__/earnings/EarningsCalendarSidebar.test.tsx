import "../setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EarningsCalendarSidebar, {
  buildEmptyStateMessage,
} from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar";
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

  it("shows explainable setup score chips when backend ranks candidates", () => {
    const rankedRows: CalendarRow[] = [
      {
        ...rows[0],
        edgeScore: 83.4,
        edgeScoreReasons: ["IV rank 78 keeps premium rich", "Implied move 6.4% vs 5.2% historical avg"],
      },
    ];
    const { container } = render(
      <EarningsCalendarSidebar rows={rankedRows} loading={false} error={null} selected="NVDA" onSelect={() => {}} />,
    );
    const chip = container.querySelector('[data-slot="edge-score-chip"]');
    const row = container.querySelector("button");
    expect(chip?.textContent).toMatch(/score\s+83/i);
    expect(chip?.getAttribute("title")).toMatch(/Implied move/i);
    expect(row?.getAttribute("aria-label")).toMatch(/setup score 83/i);
  });

  it("surfaces saved/discarded/order queue status on candidate rows", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        candidateDecisions={{
          "NVDA@2026-04-23": "saved",
          "TSLA@2026-04-23": "discarded",
          "META@2026-04-24": "order",
        }}
      />,
    );
    const pills = container.querySelectorAll('[data-slot="candidate-decision-pill"]');
    expect(pills.length).toBe(3);
    expect(container.querySelector('[data-decision="saved"]')?.textContent).toMatch(/saved/i);
    expect(container.querySelector('[data-decision="discarded"]')?.textContent).toMatch(/discarded/i);
    expect(container.querySelector('[data-decision="order"]')?.textContent).toMatch(/order/i);
    const discarded = container.querySelector('button[aria-label*="Discarded"]');
    expect(discarded?.className).toContain("opacity-45");
  });

  it("does not carry a prior symbol-only decision into a dated event", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        candidateDecisions={{ NVDA: "discarded" }}
      />,
    );
    expect(container.querySelector('[data-slot="candidate-decision-pill"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="Discarded"]')).toBeNull();
  });

  it("shows empty state when no rows and not loading", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={[]} loading={false} error={null} selected={null} onSelect={() => {}} />,
    );
    expect(container.textContent).toMatch(/no earnings|empty/i);
  });

  it("renders the calendar summary with window label + N reporting count (B-108)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        filters={{ window: "current", minIvRank: 50, sort: "date" }}
      />,
    );
    const summary = container.querySelector('[data-slot="calendar-summary"]');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("CALENDAR");
    expect(summary?.textContent).toMatch(/this week/i);
    // 3 rows in fixture → pluralized "reports"
    expect(summary?.textContent).toMatch(/3\s+reports/i);
  });

  it("names the restricting filter in the empty state and offers a reset link (B-107)", () => {
    const onResetFilters = vi.fn();
    const { container, getByRole } = render(
      <EarningsCalendarSidebar
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        filters={{ window: "current", minIvRank: 80, sort: "iv_rank" }}
        onResetFilters={onResetFilters}
      />,
    );
    expect(container.textContent).toMatch(/current week/i);
    expect(container.textContent).toMatch(/IV rank/i);
    expect(container.textContent).toContain("80");

    fireEvent.click(getByRole("button", { name: /loosen/i }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it("omits the reset button when onResetFilters is not provided (B-107)", () => {
    const { queryByRole } = render(
      <EarningsCalendarSidebar
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        filters={{ window: "current", minIvRank: 80 }}
      />,
    );
    expect(queryByRole("button", { name: /loosen/i })).toBeNull();
  });

  it("opens in a new tab on Cmd/Ctrl-click instead of onSelect (B-40)", () => {
    const onSelect = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const originalSearch = window.location.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/strategies/earnings-options-play", search: "?window=both&sort=ivRank" },
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
    expect(url).toContain("sort=ivRank");

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

  // ── Round-4 additions ──────────────────────────────────────

  it("renders the backend windowLabel in the calendar header (CLUSTER A/2)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        windowLabel="Apr 27 – May 1, 2026"
      />,
    );
    const summary = container.querySelector('[data-slot="calendar-summary"]');
    expect(summary?.textContent).toContain("Apr 27 – May 1, 2026");
    expect(summary?.textContent).toMatch(/3\s+reports/i);
  });

  it("renders weekend-aware empty state when meta.reason === weekend_no_reports (CLUSTER A/3 / NEW-Y2)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        metaReason="weekend_no_reports"
      />,
    );
    // Round-5 (NEW-Y2 / E-7): the message now includes the *actual*
    // weekday rather than hard-coding "Saturday". The day-aware variants
    // are exercised by the buildEmptyStateMessage describe block below.
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
    expect(container.textContent).toContain(today);
    expect(container.textContent).toMatch(/Markets reopen Monday/i);
  });

  it("dims and sets aria-busy when refetching=true (CLUSTER D/10)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        refetching
        error={null}
        selected="NVDA"
        onSelect={() => {}}
      />,
    );
    const aside = container.querySelector('[data-slot="earnings-calendar-sidebar"]');
    expect(aside?.getAttribute("aria-busy")).toBe("true");
    expect(aside?.getAttribute("data-refetching")).toBeTruthy();
    expect(aside?.className).toMatch(/opacity-70/);
  });

  it("forwards firstRowRef to the first symbol button (B-NEW-3)", () => {
    const ref: { current: HTMLButtonElement | null } = { current: null };
    render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        firstRowRef={ref}
      />,
    );
    expect(ref.current).not.toBeNull();
    // First row in our fixture is NVDA on 04-23 (sorted ASC).
    expect(ref.current?.textContent).toContain("NVDA");
  });

  // ── Round-5 (NEW-Y1): reportState rendering — E-2 / E-12 ────────
  it("test_today_done_rows_dimmed: dims today_done + past rows and labels them '(reported)'", () => {
    const reportedRows: CalendarRow[] = [
      { ...rows[0], symbol: "NVDA", reportState: "today_done" },
      { ...rows[1], symbol: "TSLA", reportState: "upcoming" },
      { ...rows[2], symbol: "META", reportState: "past" },
    ];
    const { container } = render(
      <EarningsCalendarSidebar
        rows={reportedRows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
      />,
    );
    const done = container.querySelector('button[data-report-state="today_done"]');
    const past = container.querySelector('button[data-report-state="past"]');
    const upcoming = container.querySelector('button[data-report-state="upcoming"]');
    expect(done).not.toBeNull();
    expect(past).not.toBeNull();
    expect(upcoming).not.toBeNull();
    expect(done?.className).toContain("opacity-60");
    expect(past?.className).toContain("opacity-60");
    expect(upcoming?.className).not.toContain("opacity-60");
    expect(done?.getAttribute("aria-label")).toContain("(reported)");
    expect(past?.getAttribute("aria-label")).toContain("(reported)");
    expect(upcoming?.getAttribute("aria-label")).not.toContain("(reported)");
  });

  it("renders a TODAY pill on today_pre rows but not today_done (NEW-Y1)", () => {
    const mixed: CalendarRow[] = [
      { ...rows[0], symbol: "NVDA", reportState: "today_pre" },
      { ...rows[1], symbol: "TSLA", reportState: "today_done" },
    ];
    const { container } = render(
      <EarningsCalendarSidebar
        rows={mixed}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
      />,
    );
    const pills = container.querySelectorAll('[data-slot="today-pill"]');
    expect(pills.length).toBe(1);
    const preBtn = container.querySelector('button[data-report-state="today_pre"]');
    expect(preBtn?.querySelector('[data-slot="today-pill"]')).not.toBeNull();
  });

  it("treats absent reportState as 'upcoming' — no dim, no pill (NEW-Y1)", () => {
    const noState: CalendarRow[] = [{ ...rows[0], reportState: undefined }];
    const { container } = render(
      <EarningsCalendarSidebar
        rows={noState}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
      />,
    );
    const btn = container.querySelector("button[data-report-state]");
    expect(btn?.getAttribute("data-report-state")).toBe("upcoming");
    expect(btn?.className).not.toContain("opacity-60");
    expect(btn?.querySelector('[data-slot="today-pill"]')).toBeNull();
  });

  it("adds timing tooltips for DMT rows", () => {
    const dmtRows: CalendarRow[] = [{ ...rows[0], reportTime: "DMT" }];
    const { container } = render(
      <EarningsCalendarSidebar
        rows={dmtRows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector('[title*="Timing unconfirmed"]')).not.toBeNull();
  });

  // ── Iteration 9: partial-data banner ─────────────────────────────
  // FMP returns zero rows but Alpaca cache still has earnings_meta (or
  // vice versa) → backend tags the response with ``partial=true`` and
  // any per-symbol Pydantic failures land in ``validation_errors``.
  // The sidebar must surface a small warning band so users don't trust
  // a degraded screener silently.

  it("hides the partial-data banner when partial=false (Iteration 9)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        partial={false}
      />,
    );
    expect(
      container.querySelector('[data-slot="calendar-partial-banner"]'),
    ).toBeNull();
  });

  it("shows banner with row count = 0 when partial=true and no validationErrors (Iteration 9)", () => {
    // All three fixture rows have ivRank populated, so the heuristic
    // fallback doesn't increment the degraded counter — rendering
    // "0 rows may be missing IV / yield". This is the "backend
    // flagged degraded providers but didn't enumerate the failures"
    // case (e.g. a meta-level FMP outage).
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        partial={true}
        validationErrors={[]}
      />,
    );
    const banner = container.querySelector(
      '[data-slot="calendar-partial-banner"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/Partial data/i);
    expect(banner?.textContent).toMatch(/0 rows? may be missing/i);
    // No disclosure when validationErrors is empty.
    expect(
      container.querySelector('[data-slot="calendar-partial-disclosure"]'),
    ).toBeNull();
  });

  it("shows banner count + expandable issues disclosure when validationErrors has entries (Iteration 9)", () => {
    const { container } = render(
      <EarningsCalendarSidebar
        rows={rows}
        loading={false}
        error={null}
        selected={null}
        onSelect={() => {}}
        partial={true}
        validationErrors={[
          { symbol: "AAPL", error: "IV unavailable" },
          { symbol: "NVDA", error: "premium yield missing" },
        ]}
      />,
    );
    const banner = container.querySelector(
      '[data-slot="calendar-partial-banner"]',
    );
    expect(banner?.textContent).toMatch(/2 rows may be missing/i);

    const disclosure = container.querySelector(
      '[data-slot="calendar-partial-disclosure"]',
    );
    expect(disclosure).not.toBeNull();
    // ``<details>`` + ``<summary>`` is native disclosure — the prompt
    // explicitly chose this so the sidebar has zero JS state. Check
    // the summary copy and the per-symbol entries.
    const summary = disclosure?.querySelector("summary");
    expect(summary?.textContent).toMatch(/View 2 issues/i);
    const items = disclosure?.querySelectorAll(
      '[data-slot="calendar-partial-disclosure-item"]',
    );
    expect(items?.length).toBe(2);
    expect(items?.[0].textContent).toContain("AAPL");
    expect(items?.[0].textContent).toContain("IV unavailable");
    expect(items?.[1].textContent).toContain("NVDA");
    expect(items?.[1].textContent).toContain("premium yield missing");
  });

  it("suppresses partial banner when error is set (full-error state takes precedence)", () => {
    // The error empty-state already tells the user the screener is
    // unavailable end-to-end; stacking a second yellow "partial data"
    // banner on top of a red "calendar unavailable" panel adds noise
    // without information. Sidebar early-returns before the calendar
    // summary, so the banner is naturally suppressed — this test pins
    // that contract.
    const { container } = render(
      <EarningsCalendarSidebar
        rows={[]}
        loading={false}
        error="provider down"
        selected={null}
        onSelect={() => {}}
        partial={true}
        validationErrors={[
          { symbol: "AAPL", error: "IV unavailable" },
        ]}
      />,
    );
    expect(
      container.querySelector('[data-slot="calendar-partial-banner"]'),
    ).toBeNull();
    // The destructive empty state still renders.
    expect(container.textContent).toMatch(/calendar unavailable|feed timed out/i);
  });
});

// ── Round-5 (NEW-Y2 / E-7): weekend-aware empty-state copy ─────────
describe("buildEmptyStateMessage — weekend day-aware", () => {
  const realDate = global.Date;
  afterEach(() => {
    global.Date = realDate;
  });

  it("test_weekend_empty_state_uses_actual_day: emits 'Sunday' on a Sunday, not 'Saturday'", () => {
    // 2026-04-26 is a Sunday in en-US locale.
    const sundayMs = new Date("2026-04-26T15:00:00Z").getTime();
    const SundayDate = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(sundayMs);
          return;
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — pass-through for parameterized constructions
        super(...args);
      }
      static now() {
        return sundayMs;
      }
    } as unknown as DateConstructor;
    global.Date = SundayDate;
    const msg = buildEmptyStateMessage({
      reason: "weekend_no_reports",
      windowLabel: null,
      filters: undefined,
    });
    expect(msg).toContain("Sunday");
    expect(msg).not.toContain("Saturday");
    expect(msg).toMatch(/markets reopen monday/i);
  });

  it("emits 'Saturday' on a Saturday (NEW-Y2)", () => {
    const saturdayMs = new Date("2026-04-25T15:00:00Z").getTime();
    const SaturdayDate = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(saturdayMs);
          return;
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        super(...args);
      }
      static now() {
        return saturdayMs;
      }
    } as unknown as DateConstructor;
    global.Date = SaturdayDate;
    const msg = buildEmptyStateMessage({
      reason: "weekend_no_reports",
      windowLabel: null,
      filters: undefined,
    });
    expect(msg).toContain("Saturday");
  });
});
