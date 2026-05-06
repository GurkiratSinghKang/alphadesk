import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import TickerFreshnessStrip, {
  formatChipTimestamp,
  formatEarningsDate,
} from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/TickerFreshnessStrip";
import type { TickerContext, TickerFactEnvelope, TickerFreshnessMeta } from "@/types";

function meta(overrides: Partial<TickerFreshnessMeta> = {}): TickerFreshnessMeta {
  return {
    observedAt: "2026-05-06T18:30:00Z",
    asOf: "2026-05-06T18:30:00Z",
    sourceUpdatedAt: null,
    expiresAt: null,
    staleAfterSeconds: null,
    quality: "fresh",
    source: "test",
    schemaVersion: 1,
    isDemo: false,
    ...overrides,
  };
}

function envelope<T extends Record<string, unknown>>(
  value: T | null,
  metaOverrides: Partial<TickerFreshnessMeta> = {},
): TickerFactEnvelope<T> {
  return { value, freshness: meta(metaOverrides) };
}

function ctx(overrides: Partial<TickerContext> = {}): TickerContext {
  return {
    symbol: "UBER",
    quote: undefined,
    optionsSummary: undefined,
    earnings: undefined,
    research: undefined,
    news: undefined,
    marketRegime: undefined,
    warnings: [],
    ...overrides,
  };
}

describe("TickerFreshnessStrip", () => {
  it("renders nothing when context is null", () => {
    const { container } = render(<TickerFreshnessStrip context={null} />);
    expect(container.querySelector('[data-slot="ticker-freshness-strip"]')).toBeNull();
  });

  it("renders all four domain chips even when individual envelopes are missing", () => {
    const { container } = render(<TickerFreshnessStrip context={ctx()} />);
    // Strip itself renders, with a chip per domain showing 'warming up'
    // for the missing ones (better than collapsing the layout).
    expect(container.querySelector('[data-slot="ticker-freshness-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="freshness-chip-quote"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="freshness-chip-options"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="freshness-chip-earnings"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="freshness-chip-research"]')).not.toBeNull();
  });

  it("uses domain-specific freshness windows — earnings asOf 2 days old still bucketed as fresh", () => {
    // B1.5 / B2.14 fix: at the global 5-minute threshold the EARNINGS
    // chip would have flipped to stale. With the 7-day window, an
    // asOf two days old still reads as fresh (bucketing) — but the
    // chip surfaces calendar dates, not the freshness adjective, so
    // the user actually sees concrete last/next dates.
    const c = ctx({
      earnings: envelope(
        {
          last_report_date: "2026-05-04",
          next_report_date: "2026-08-02",
        },
        { asOf: "2026-05-04T20:00:00Z", quality: "fresh" },
      ),
    });
    const nowMs = new Date("2026-05-06T18:00:00Z").getTime();
    const { container } = render(<TickerFreshnessStrip context={c} nowMs={nowMs} />);
    const chip = container.querySelector('[data-slot="freshness-chip-earnings"]');
    expect(chip).not.toBeNull();
    // Surface last + next dates inline.
    expect(chip?.textContent).toMatch(/last/i);
    expect(chip?.textContent).toMatch(/next/i);
    // Should bucket as fresh (within 7-day window) — data-tone attribute
    // is the test seam.
    expect(chip?.getAttribute("data-tone")).toBe("fresh");
  });

  it("buckets a stale (>30 day) earnings asOf as amber", () => {
    const c = ctx({
      earnings: envelope({}, { asOf: "2026-03-01T12:00:00Z", quality: "fresh" }),
    });
    const nowMs = new Date("2026-05-06T18:00:00Z").getTime();
    const { container } = render(<TickerFreshnessStrip context={c} nowMs={nowMs} />);
    const chip = container.querySelector('[data-slot="freshness-chip-earnings"]');
    expect(chip?.getAttribute("data-tone")).toBe("amber");
  });

  it("RESEARCH unavailable swaps red 'unavailable' for grey 'warming up' with Why? expander (B1.23 / B2.15)", () => {
    const c = ctx({
      research: envelope(null, { quality: "unavailable" }),
    });
    const { container, getByRole } = render(<TickerFreshnessStrip context={c} />);
    const chip = container.querySelector('[data-slot="freshness-chip-research"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-tone")).toBe("warming");
    expect(chip?.textContent).toMatch(/warming up/i);
    expect(chip?.textContent).not.toMatch(/unavailable/i);
    // Clicking Why? expands the inline help.
    const button = getByRole("button", { name: /why is research warming up/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-slot="freshness-chip-research-help"]')?.textContent).toMatch(
      /pre-warmed only for top-50 reporters/i,
    );
  });

  it("quote chip past 30s but inside 5min reads as amber (domain-specific bucket)", () => {
    const c = ctx({
      quote: envelope({}, { asOf: "2026-05-06T18:25:00Z", quality: "fresh" }),
    });
    // 5 min after the asOf — past the quote 30s fresh window but
    // inside the 5min stale window: amber.
    const nowMs = new Date("2026-05-06T18:30:00Z").getTime();
    const { container } = render(<TickerFreshnessStrip context={c} nowMs={nowMs} />);
    const chip = container.querySelector('[data-slot="freshness-chip-quote"]');
    expect(chip?.getAttribute("data-tone")).toBe("amber");
  });

  it("demo quality buckets as amber for a non-research chip", () => {
    const c = ctx({
      optionsSummary: envelope({}, { quality: "demo" }),
    });
    const { container } = render(<TickerFreshnessStrip context={c} />);
    const chip = container.querySelector('[data-slot="freshness-chip-options"]');
    expect(chip?.getAttribute("data-tone")).toBe("amber");
  });

  it("includes the chip help text in the title attribute (B2.15 — explain what each chip means)", () => {
    const c = ctx({
      quote: envelope({}, { asOf: "2026-05-06T18:30:00Z" }),
    });
    const { container } = render(<TickerFreshnessStrip context={c} />);
    const chip = container.querySelector('[data-slot="freshness-chip-quote"]');
    const title = chip?.getAttribute("title") ?? "";
    expect(title).toMatch(/last regular-session price/i);
    expect(title).toMatch(/last updated/i);
  });
});

describe("formatChipTimestamp", () => {
  it("uses 'Today HH:MM AM/PM' for same-day timestamps (B2.16)", () => {
    const nowMs = new Date("2026-05-06T18:30:00Z").getTime();
    const out = formatChipTimestamp("2026-05-06T17:50:00Z", nowMs);
    // Locale-formatted time will vary but should start with 'Today'.
    expect(out).toMatch(/^Today /);
  });

  it("uses 'May 4, 8:00 PM' style for prior-day timestamps", () => {
    const nowMs = new Date("2026-05-06T18:30:00Z").getTime();
    const out = formatChipTimestamp("2026-05-04T20:00:00Z", nowMs);
    // Includes a comma separating date and time, no 'Today'.
    expect(out).not.toMatch(/^Today /);
    expect(out).toMatch(/,/);
  });

  it("returns empty string for null input", () => {
    expect(formatChipTimestamp(null)).toBe("");
  });
});

describe("formatEarningsDate", () => {
  it("formats bare ISO dates as 'Mon Day' without TZ shift", () => {
    expect(formatEarningsDate("2026-05-06")).toMatch(/May 6/);
  });

  it("returns null for unparseable input", () => {
    expect(formatEarningsDate(null)).toBeNull();
    expect(formatEarningsDate("")).toBeNull();
    expect(formatEarningsDate("not-a-date")).toBeNull();
  });
});
