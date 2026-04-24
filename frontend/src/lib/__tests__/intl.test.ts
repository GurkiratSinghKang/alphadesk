import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtPct,
  fmtPlural,
  fmtRelative,
  getUserLocale,
  getUserTimezone,
} from "../intl";

/**
 * The tests below assert that helpers delegate to `Intl.*` under the
 * user's locale — they compare against the output of a fresh `Intl`
 * instance with the same options, rather than hardcoding e.g. "$100.50"
 * which would pin the suite to en-US. That way the suite validates the
 * *plumbing* rather than a specific locale's output.
 */

// Force a known locale + timezone for tests that need determinism.
// We wrap the real `Intl.DateTimeFormat` constructor so that calls with no
// options (the `getUserTimezone()` probe) get the stubbed timezone in their
// resolvedOptions — but calls that *explicitly* pass a timezone still honor
// the caller's intent (that's how fmtDate/fmtDateTime actually work).
const RealDTF = Intl.DateTimeFormat;
function stubLocale(locale: string, timeZone = "UTC") {
  vi.stubGlobal("navigator", { language: locale } as Partial<Navigator>);
  const Wrapped = function (loc?: string | string[], opts?: Intl.DateTimeFormatOptions) {
    const effOpts: Intl.DateTimeFormatOptions = { timeZone, ...(opts ?? {}) };
    // If caller passed an explicit timeZone, keep theirs.
    if (opts && opts.timeZone) effOpts.timeZone = opts.timeZone;
    const inst = new RealDTF(loc ?? locale, effOpts);
    const origResolved = inst.resolvedOptions.bind(inst);
    inst.resolvedOptions = () => ({ ...origResolved(), timeZone: effOpts.timeZone ?? timeZone });
    return inst;
  } as unknown as typeof Intl.DateTimeFormat;
  // Copy statics so `Intl.DateTimeFormat.supportedLocalesOf` etc. still work.
  Object.setPrototypeOf(Wrapped, RealDTF);
  (Intl as unknown as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = Wrapped;
}

afterEach(() => {
  (Intl as unknown as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = RealDTF;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("intl — locale + timezone detection", () => {
  it("getUserLocale falls back to en-US when navigator missing", () => {
    vi.stubGlobal("navigator", undefined);
    expect(getUserLocale()).toBe("en-US");
  });

  it("getUserLocale reads navigator.language", () => {
    vi.stubGlobal("navigator", { language: "de-DE" } as Partial<Navigator>);
    expect(getUserLocale()).toBe("de-DE");
  });

  it("getUserTimezone returns a non-empty IANA-ish string", () => {
    const tz = getUserTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});

describe("intl — fmtCurrency", () => {
  it("uses Intl.NumberFormat under en-US (compare-with-Intl, not hardcoded)", () => {
    stubLocale("en-US");
    const expected = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(100.5);
    expect(fmtCurrency(100.5, "USD")).toBe(expected);
  });

  it("uses Intl.NumberFormat under de-DE (locale actually affects output)", () => {
    stubLocale("de-DE");
    const expected = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(100.5);
    expect(fmtCurrency(100.5, "USD")).toBe(expected);
    // Sanity: de-DE output really does differ from en-US output.
    const enUS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(100.5);
    expect(expected).not.toBe(enUS);
  });

  it("accepts an override currency code", () => {
    stubLocale("en-US");
    const eur = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(100);
    expect(fmtCurrency(100, "EUR")).toBe(eur);
  });

  it("accepts signDisplay extra options for always-signed deltas", () => {
    stubLocale("en-US");
    const expected = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      signDisplay: "always",
    }).format(1.25);
    expect(fmtCurrency(1.25, "USD", { signDisplay: "always" })).toBe(expected);
  });
});

describe("intl — fmtNumber / fmtPct", () => {
  it("fmtNumber defers to Intl.NumberFormat per locale", () => {
    stubLocale("de-DE");
    const expected = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(1234.5);
    expect(fmtNumber(1234.5)).toBe(expected);
  });

  it("fmtPct formats a ratio with fixed fraction digits", () => {
    stubLocale("en-US");
    const expected = new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0.055);
    expect(fmtPct(0.055)).toBe(expected);
  });

  it("fmtPct honors digits override", () => {
    stubLocale("en-US");
    const expected = new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(0.5);
    expect(fmtPct(0.5, 0)).toBe(expected);
  });
});

describe("intl — fmtPlural", () => {
  beforeEach(() => stubLocale("en-US"));

  it("singular for count=1", () => {
    expect(fmtPlural(1, "report", "reports")).toBe("1 report");
  });

  it("plural for count=5", () => {
    expect(fmtPlural(5, "report", "reports")).toBe("5 reports");
  });

  it("plural for count=0 (English treats 0 as 'other')", () => {
    expect(fmtPlural(0, "report", "reports")).toBe("0 reports");
  });

  it("auto-suffixes with 's' when plural omitted", () => {
    expect(fmtPlural(3, "match")).toBe("3 matchs");
    expect(fmtPlural(1, "match")).toBe("1 match");
  });
});

describe("intl — fmtDate honors timezone across midnight", () => {
  it("shows correct day for 23:30 UTC → UTC viewer", () => {
    stubLocale("en-US", "UTC");
    // 2026-04-24 at 23:30 UTC is still the 24th in UTC.
    const out = fmtDate("2026-04-24T23:30:00Z", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(out).toContain("24");
    expect(out).toContain("2026");
  });

  it("shifts across midnight for Tokyo viewer", () => {
    stubLocale("en-US", "Asia/Tokyo");
    // 2026-04-24 23:30 UTC is 2026-04-25 08:30 Asia/Tokyo.
    const out = fmtDate("2026-04-24T23:30:00Z", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(out).toContain("25");
  });

  it("anchors YYYY-MM-DD to UTC midnight so UTC viewers see the same day", () => {
    stubLocale("en-US", "UTC");
    const out = fmtDate("2026-04-24", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(out).toContain("24");
    expect(out).toContain("04");
  });

  it("bare YYYY-MM-DD stays on the same calendar day regardless of viewer timezone", () => {
    // Pure dates (earnings report_date etc.) are business days, not a
    // wall-clock time. They should not shift to the previous day for a
    // US/Pacific viewer or to the next day for a Tokyo viewer.
    stubLocale("en-US", "America/Los_Angeles");
    const la = fmtDate("2026-04-23", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(la).toContain("23");

    stubLocale("en-US", "Asia/Tokyo");
    const tk = fmtDate("2026-04-23", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(tk).toContain("23");
  });
});

describe("intl — fmtDateTime", () => {
  it("includes a timezone label", () => {
    stubLocale("en-US", "America/New_York");
    const out = fmtDateTime("2026-04-24T16:30:00Z");
    // timeZoneName: "short" yields something like "EDT" / "EST".
    expect(out).toMatch(/[A-Z]{2,}/);
  });
});

describe("intl — fmtRelative", () => {
  it("renders a past timestamp in a localized relative form", () => {
    stubLocale("en-US");
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const out = fmtRelative(fiveMinAgo);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("renders a future timestamp distinctly from a past one", () => {
    stubLocale("en-US");
    const past = fmtRelative(new Date(Date.now() - 2 * 3600 * 1000).toISOString());
    const future = fmtRelative(new Date(Date.now() + 2 * 3600 * 1000).toISOString());
    expect(past).not.toBe(future);
  });
});
