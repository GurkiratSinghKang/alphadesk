import "./setup-mocks";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import PositionsList from "@/components/composites/PositionsList";
import { ExtendedHoursBadge } from "@/components/primitives/ExtendedHoursBadge";
import { getSessionPillLabel } from "@/components/layout/StatusStrip";

// EH-3f: cover the three display surfaces touched by the EH-UI work.
// We exercise the primitive (ExtendedHoursBadge) directly, the
// PositionsList composite with an `extended` row, and the
// StatusStrip session-label helper at a fixed instant — the helper is
// pure so we don't need to mount the full strip (which depends on
// auth/portfolio/regime queries in setup-mocks).

describe("ExtendedHoursBadge primitive", () => {
  it("renders AH for post session", () => {
    const { container } = render(<ExtendedHoursBadge tone="post" />);
    expect(container.textContent).toContain("AH");
    const node = container.querySelector("[data-slot='extended-hours-badge']");
    expect(node?.getAttribute("data-tone")).toBe("post");
  });

  it("renders PM for pre session", () => {
    const { container } = render(<ExtendedHoursBadge tone="pre" />);
    expect(container.textContent).toContain("PM");
  });

  it("renders STALE with the warning data-tone", () => {
    const { container } = render(<ExtendedHoursBadge tone="stale" />);
    expect(container.textContent).toContain("STALE");
    const node = container.querySelector("[data-slot='extended-hours-badge']");
    expect(node?.getAttribute("data-tone")).toBe("stale");
  });

  it("renders nothing when tone is null (regular session)", () => {
    const { container } = render(<ExtendedHoursBadge tone={null} />);
    expect(container.querySelector("[data-slot='extended-hours-badge']")).toBeNull();
  });

  it("renders nothing for an unrecognised tone (defensive)", () => {
    // Cast through unknown to bypass the literal-union check — this
    // simulates a backend that emits a value the FE doesn't know.
    const { container } = render(
      <ExtendedHoursBadge tone={"weekend" as unknown as "post"} />,
    );
    expect(container.querySelector("[data-slot='extended-hours-badge']")).toBeNull();
  });
});

describe("PositionsList — extended-hours value display", () => {
  const baseRow = {
    id: "1",
    symbol: "AAPL",
    quantity: 100,
    entryPrice: 175.0,
    strategyName: "Manual",
    progress: 0.5,
    pnl: 250,
    pnlPct: 1.4,
  };

  it("renders an AH badge and live value when value_session === extended", () => {
    const row = {
      ...baseRow,
      liveValue: 18_350,
      liveValueChange: 612.5,
      liveValueChangePct: 3.45,
      valueSession: "extended" as const,
      extendedSession: "post" as const,
      lastTradeTime: "2026-05-05T22:35:00Z",
    };
    const { container } = render(
      <PositionsList positions={[row]} activeTab="positions" />,
    );
    // AH badge present on the row
    const badge = container.querySelector("[data-slot='extended-hours-badge']");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-tone")).toBe("post");
    // Row carries the data-value-session marker so QA can target the
    // extended-hours rows in DOM snapshots.
    const tr = container.querySelector("tr[data-value-session='extended']");
    expect(tr).not.toBeNull();
    // The live-value cell renders the live-value-change figure (~$613)
    // rather than the regular pnl (250). PnLNumber rounds to a whole
    // dollar via formatCurrency at this scale; the assertion is on the
    // dominant magnitude not the cents to stay resilient to formatter
    // changes.
    const pnlCell = container.querySelector("[data-slot='position-live-value']");
    expect(pnlCell).not.toBeNull();
    expect(pnlCell?.textContent ?? "").toMatch(/61[23]/);
    // The regular pnl ($250) must NOT appear since we swapped the
    // displayed figure to the extended live-value-change.
    expect(pnlCell?.textContent ?? "").not.toContain("$250");
  });

  it("renders a STALE badge when value_session === stale", () => {
    const row = {
      ...baseRow,
      liveValue: 18_300,
      liveValueChange: 562.5,
      liveValueChangePct: 3.17,
      valueSession: "stale" as const,
      lastTradeTime: "2026-05-05T20:00:00Z",
    };
    const { container } = render(
      <PositionsList positions={[row]} activeTab="positions" />,
    );
    const badge = container.querySelector("[data-slot='extended-hours-badge']");
    expect(badge?.getAttribute("data-tone")).toBe("stale");
    const tr = container.querySelector("tr[data-value-session='stale']");
    expect(tr).not.toBeNull();
  });

  it("falls back to the regular pnl render when valueSession is null", () => {
    // Regular-session row — pre-EH behaviour. No badges rendered, the
    // pnl cell shows the regular pnl figure unchanged.
    const { container } = render(
      <PositionsList positions={[baseRow]} activeTab="positions" />,
    );
    expect(container.querySelector("[data-slot='extended-hours-badge']")).toBeNull();
    expect(container.querySelector("[data-slot='position-live-value']")).toBeNull();
    expect(container.querySelector("[data-slot='position-live-stale']")).toBeNull();
  });
});

describe("Status strip — session pill label helper", () => {
  // The pill helper is pure and reads from the host clock via the
  // marketHours utility (which uses Intl). We can call it with an
  // explicit Date and assert the returned label.
  beforeEach(() => {
    // Pin a deterministic clock so the Intl format is stable.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns AFTER HOURS at 17:00 ET on a weekday", () => {
    // 2026-05-05 is a Tuesday. 17:00 ET ≈ 21:00 UTC during EDT.
    const at = new Date("2026-05-05T21:00:00Z");
    expect(getSessionPillLabel(at)).toBe("AFTER HOURS");
  });

  it("returns PRE-MARKET at 07:00 ET on a weekday", () => {
    // 07:00 EDT = 11:00 UTC.
    const at = new Date("2026-05-05T11:00:00Z");
    expect(getSessionPillLabel(at)).toBe("PRE-MARKET");
  });

  it("returns OVERNIGHT at 02:00 ET on a weekday", () => {
    // 02:00 EDT = 06:00 UTC.
    const at = new Date("2026-05-05T06:00:00Z");
    expect(getSessionPillLabel(at)).toBe("OVERNIGHT");
  });

  it("returns null during the regular session (12:00 ET weekday)", () => {
    // 12:00 EDT = 16:00 UTC.
    const at = new Date("2026-05-05T16:00:00Z");
    expect(getSessionPillLabel(at)).toBeNull();
  });

  it("returns null on a Saturday (closed)", () => {
    // 2026-05-09 is a Saturday.
    const at = new Date("2026-05-09T16:00:00Z");
    expect(getSessionPillLabel(at)).toBeNull();
  });
});
