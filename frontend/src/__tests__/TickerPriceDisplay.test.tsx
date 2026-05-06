import "./setup-mocks";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

import TickerPriceDisplay from "@/components/primitives/TickerPriceDisplay";

// Pin Date.now / new Date() so freshness + stale checks are deterministic.
// 2026-05-05T20:30:00Z gives us a clean reference for the LIVE/DELAYED
// pill (within 30s) and the 15-min stale window for the AH/PM secondary.
const NOW = new Date("2026-05-05T20:30:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TickerPriceDisplay — primary price + delta", () => {
  it("renders the regular-session price + delta when only primary fields are provided", () => {
    const { container } = render(
      <TickerPriceDisplay last={356.28} change={4.32} changePct={1.23} />,
    );
    const wrapper = container.querySelector("[data-slot='ticker-price-display']");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.textContent).toContain("$356.28");
    // Delta rendered with sign-always; tolerate "+1.23%", "1.23%", "+$4.32"
    const delta = container.querySelector("[data-slot='ticker-price-display-delta']");
    expect(delta?.textContent).toMatch(/\+?\$?4\.32/);
    expect(delta?.textContent).toMatch(/\+?1\.23%/);
  });

  it("does NOT render the extended-hours secondary when extendedSession is null", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession={null}
        extendedPrice={null}
      />,
    );
    expect(
      container.querySelector("[data-slot='extended-hours-secondary']"),
    ).toBeNull();
  });
});

describe("TickerPriceDisplay — extended-hours secondary", () => {
  const recentExtendedTimestamp = "2026-05-05T20:25:00.000Z"; // 5 min before NOW

  it("renders 'After Hours' label when extendedSession === 'post' with valid price/change", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={414.0}
        extendedChange={57.72}
        extendedChangePct={13.34}
        extendedTimestamp={recentExtendedTimestamp}
      />,
    );
    const sec = container.querySelector("[data-slot='extended-hours-secondary']");
    expect(sec).not.toBeNull();
    expect(sec?.getAttribute("data-session")).toBe("post");
    expect(sec?.textContent).toContain("After Hours");
    expect(sec?.textContent).toContain("$414.00");
    expect(sec?.textContent).toMatch(/\+?13\.34%/);
  });

  it("renders 'Pre-market' label when extendedSession === 'pre'", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={null}
        changePct={null}
        extendedSession="pre"
        extendedPrice={350.0}
        extendedChange={-6.28}
        extendedChangePct={-1.76}
        extendedTimestamp={recentExtendedTimestamp}
      />,
    );
    const sec = container.querySelector("[data-slot='extended-hours-secondary']");
    expect(sec).not.toBeNull();
    expect(sec?.getAttribute("data-session")).toBe("pre");
    expect(sec?.textContent).toContain("Pre-market");
  });

  it("suppresses the secondary when hasExtendedHours === false", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={414.0}
        extendedChangePct={13.34}
        extendedTimestamp={recentExtendedTimestamp}
        hasExtendedHours={false}
      />,
    );
    expect(
      container.querySelector("[data-slot='extended-hours-secondary']"),
    ).toBeNull();
  });

  it("suppresses the secondary when extended timestamp is older than 15 min", () => {
    // 16 min before NOW — outside the 15-min stale window.
    const staleTs = "2026-05-05T20:14:00.000Z";
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={414.0}
        extendedChangePct={13.34}
        extendedTimestamp={staleTs}
      />,
    );
    expect(
      container.querySelector("[data-slot='extended-hours-secondary']"),
    ).toBeNull();
  });
});

describe("TickerPriceDisplay — secondary delta sign coloring", () => {
  const recentExtendedTimestamp = "2026-05-05T20:28:00.000Z"; // 2 min before NOW

  it("uses profit-class when extendedChangePct >= 0", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={414.0}
        extendedChange={57.72}
        extendedChangePct={13.34}
        extendedTimestamp={recentExtendedTimestamp}
      />,
    );
    const sec = container.querySelector("[data-slot='extended-hours-secondary']");
    const deltaSpan = sec?.querySelector(".u-profit");
    expect(deltaSpan).not.toBeNull();
    expect(sec?.querySelector(".u-loss")).toBeNull();
  });

  it("uses loss-class when extendedChangePct < 0", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={350.0}
        extendedChange={-6.28}
        extendedChangePct={-1.76}
        extendedTimestamp={recentExtendedTimestamp}
      />,
    );
    const sec = container.querySelector("[data-slot='extended-hours-secondary']");
    expect(sec?.querySelector(".u-loss")).not.toBeNull();
    expect(sec?.querySelector(".u-profit")).toBeNull();
  });
});

describe("TickerPriceDisplay — inline layout", () => {
  it("renders single-row form with the inline data-slot", () => {
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        extendedSession="post"
        extendedPrice={414.0}
        extendedChangePct={13.34}
        extendedTimestamp="2026-05-05T20:25:00.000Z"
        layout="inline"
      />,
    );
    const inline = container.querySelector("[data-slot='ticker-price-display-inline']");
    expect(inline).not.toBeNull();
    // The stacked wrapper must NOT be present when in inline mode.
    expect(container.querySelector("[data-slot='ticker-price-display']")).toBeNull();
    expect(inline?.textContent).toContain("$356.28");
    expect(inline?.textContent).toContain("After Hours");
    expect(inline?.textContent).toContain("$414.00");
  });
});

describe("TickerPriceDisplay — FreshnessPill", () => {
  it("renders LIVE when timestamp within 30s of mocked Date.now()", () => {
    const recent = "2026-05-05T20:29:50.000Z"; // 10s before NOW
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        timestamp={recent}
      />,
    );
    const pill = container.querySelector("[data-slot='freshness-pill']");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-kind")).toBe("live");
    expect(pill?.textContent).toContain("LIVE");
  });

  it("renders DELAYED with the relative age otherwise", () => {
    const old = "2026-05-05T20:25:00.000Z"; // 5 min before NOW
    const { container } = render(
      <TickerPriceDisplay
        last={356.28}
        change={4.32}
        changePct={1.23}
        timestamp={old}
      />,
    );
    const pill = container.querySelector("[data-slot='freshness-pill']");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-kind")).toBe("delayed");
    expect(pill?.textContent).toContain("DELAYED");
  });
});
