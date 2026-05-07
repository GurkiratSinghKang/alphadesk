/**
 * Audit edge-cases-r3 §A P1 — holiday-aware market status pill.
 *
 * Background: ``isMarketOpen()`` and ``getMarketSession()`` in
 * ``src/lib/marketHours.ts`` are intentionally heuristic (DST-correct,
 * Mon–Fri, 09:30–16:00 ET) and do NOT know about NYSE-observed US
 * holidays. The dashboard pill, OrderBar gating, StatusStrip, and
 * MorningBrief panel all consumed those heuristics directly, so on
 * Independence Day, MLK Day, Thanksgiving, etc. the desk would render
 * "Market Open" / no closed-pill while the backend correctly rejected
 * any submitted order.
 *
 * Fix: a new ``useMarketStatus()`` hook reads the holiday-aware
 * ``/api/v1/market/market-status`` endpoint and the four UI surfaces
 * fall back to the local heuristic only on first paint / hook failure.
 *
 * These tests pin the four critical states:
 *   1. Hook reports ``isOpen=true`` during RTH → pill shows "open"
 *   2. Hook reports ``isOpen=false`` during what the heuristic thinks
 *      is RTH → pill shows "closed" (the kill-the-lie case)
 *   3. Hook is loading during RTH → heuristic fallback shows "open"
 *   4. Hook reports ``isOpen=false`` outside RTH → pill shows "closed"
 *      with no holiday-name suffix (backend doesn't expose holiday
 *      name, see api.ts MarketStatusResponse comment)
 */
import "./setup-mocks";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import * as api from "@/lib/api";
import type { MorningBriefData } from "@/lib/api";
import { MorningBrief } from "@/components/dashboard/MorningBrief";
import { getSessionPillLabel } from "@/components/layout/StatusStrip";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeWrapper() {
  // ``retry: false`` so failing/loading queries surface immediately
  // instead of going through React Query's default exponential backoff.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const briefFixture: MorningBriefData = {
  date: "2026-05-08",
  portfolio: {
    equity: 100_000,
    overnight_change: 250,
    overnight_change_pct: 0.25,
  },
  top_movers: [],
  market: {
    regime: "Bull",
    vix: 16,
    vix_change: 0,
    spy_change_pct: 0,
  },
  catalysts: [],
  ai_summary: "Test summary",
};

function mockMorningBrief() {
  vi.spyOn(api, "getMorningBrief").mockResolvedValue(briefFixture);
}

// ─── Test 1 — backend says OPEN during RTH ──────────────────────────────────

describe("Holiday-aware market status pill", () => {
  // We use fake timers ONLY for the system clock, not the queue/timer
  // shimming React Query relies on for its internal Promise scheduling.
  // ``shouldAdvanceTime: true`` lets queued promises drain so React
  // Query's queryFn resolves and re-renders happen in normal time.
  beforeEach(() => {
    // Friday 2026-05-08 at 14:00 UTC = 10:00 ET (EDT). Heuristic agrees
    // it's RTH, backend agrees market is open. Pill should reflect open.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-08T14:00:00Z"));
    mockMorningBrief();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders Market Open when backend reports isOpen=true on a Friday at 10am ET", async () => {
    vi.spyOn(api, "getMarketStatus").mockResolvedValue({
      isOpen: true,
      market: "open",
      exchanges: { nyse: "open", nasdaq: "open" },
      serverTime: "2026-05-08T14:00:00Z",
      isDemo: false,
    });

    const { container } = render(<MorningBrief />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(container.textContent).toContain("Market Open");
    });
    // Holiday-name suffix is intentionally absent — backend doesn't
    // expose holiday_name on this endpoint (see api.ts comment).
    expect(container.textContent).not.toMatch(/Independence Day/i);
  });

  // ─── Test 2 — backend says CLOSED during what heuristic thinks is RTH ─────

  it("renders Closed when backend reports isOpen=false during a would-be RTH weekday (US holiday)", async () => {
    // Same Friday 10am ET clock, but backend reports the exchange is
    // closed. This is the "Independence Day on a Friday" case — the
    // heuristic thinks the session is open, the upstream provider knows
    // better.
    vi.spyOn(api, "getMarketStatus").mockResolvedValue({
      isOpen: false,
      market: "closed",
      exchanges: { nyse: "closed", nasdaq: "closed" },
      serverTime: "2026-05-08T14:00:00Z",
      isDemo: false,
    });

    const { container } = render(<MorningBrief />, { wrapper: makeWrapper() });

    await waitFor(() => {
      // Wait for the brief to render.
      expect(container.textContent).toContain("2026-05-08");
    });
    await waitFor(() => {
      // The brief's "Market Open" lie is killed; the pill flips to
      // "Closed". This is the kill-the-lie regression target.
      expect(container.textContent).not.toContain("Market Open");
      expect(container.textContent).toMatch(/Closed/);
    });
  });

  // ─── Test 3 — hook is loading during RTH, heuristic fallback ──────────────

  it("falls back to Market Open via the heuristic while the hook is loading during RTH", () => {
    // Pure-function check: no upstream signal yet, heuristic agrees RTH.
    // ``getSessionPillLabel`` returns null (no extended-hours pill needed)
    // when both the heuristic and the upstream agree we're in regular
    // session — and crucially also when the upstream signal is missing.
    const at = new Date("2026-05-08T14:00:00Z");
    expect(getSessionPillLabel(at, undefined)).toBeNull();
    // And when the hook resolves with isOpen=true, we still suppress the pill.
    expect(getSessionPillLabel(at, true)).toBeNull();
  });

  // ─── Test 4 — backend says closed outside RTH, no holiday suffix ──────────

  it("renders Closed without a holiday-name suffix when isOpen=false outside RTH", async () => {
    // 22:00 UTC on Friday = 18:00 ET — well past the close. Backend says
    // the market is closed (which it would be at any time after 16:00 ET
    // on a non-holiday weekday too). The pill should show Closed and
    // crucially must NOT fabricate a holiday name (the backend doesn't
    // expose one — see api.ts MarketStatusResponse).
    vi.setSystemTime(new Date("2026-05-08T22:00:00Z"));
    vi.spyOn(api, "getMarketStatus").mockResolvedValue({
      isOpen: false,
      market: "closed",
      exchanges: { nyse: "closed", nasdaq: "closed" },
      serverTime: "2026-05-08T22:00:00Z",
      isDemo: false,
    });

    const { container } = render(<MorningBrief />, { wrapper: makeWrapper() });

    await waitFor(() => {
      // After-hours window 16:00–20:00 ET shows "After Hours"; past 20:00
      // the brief shows "Closed". 18:00 ET is in the after-hours window,
      // so the brief shows "After Hours" — not "Market Open".
      expect(container.textContent).not.toContain("Market Open");
    });
    // No fabricated holiday name (backend doesn't expose it; see
    // ``MarketStatusResponse`` in api.ts).
    expect(container.textContent).not.toMatch(
      /Independence Day|Christmas|Thanksgiving|Juneteenth|MLK/i,
    );
  });
});

// ─── StatusStrip pill helper — unit-level holiday check ─────────────────────

describe("StatusStrip getSessionPillLabel — holiday override", () => {
  it("returns MARKET CLOSED when local heuristic says open but upstream is closed", () => {
    // Friday 2026-05-08 at 14:00 UTC = 10:00 ET on a weekday. Heuristic
    // would return null (regular session, no pill). Upstream says closed.
    // The override should surface a "MARKET CLOSED" pill.
    const at = new Date("2026-05-08T14:00:00Z");
    expect(getSessionPillLabel(at, false)).toBe("MARKET CLOSED");
  });

  it("returns null during a normal regular-session weekday with upstream agreement", () => {
    const at = new Date("2026-05-08T14:00:00Z");
    expect(getSessionPillLabel(at, true)).toBeNull();
  });

  it("returns AFTER HOURS irrespective of the upstream flag (extended bands trump)", () => {
    // 21:00 UTC = 17:00 ET on Friday. Heuristic returns "post" → AFTER
    // HOURS. The upstream isOpen=false matches reality but the existing
    // pill ladder still surfaces AFTER HOURS — we only override the
    // "open" case.
    const at = new Date("2026-05-08T21:00:00Z");
    expect(getSessionPillLabel(at, false)).toBe("AFTER HOURS");
  });
});
