import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { TickerFundamentals } from "@/types";

vi.mock("@/lib/api", () => ({
  getTickerFundamentals: vi.fn(),
}));

import { getTickerFundamentals } from "@/lib/api";
import { AboutSection } from "../_sections/AboutSection";

const mockedFetch = vi.mocked(getTickerFundamentals);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function makeFundamentals(overrides: Partial<TickerFundamentals> = {}): TickerFundamentals {
  return {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    marketCap: 2_480_000_000_000,
    sharesOutstanding: 24_500_000_000,
    peRatio: 65.4,
    epsTtm: 12.5,
    dividendYield: 0.0003,
    beta: 1.85,
    fiftyTwoWeekHigh: 237.68,
    fiftyTwoWeekLow: 100.02,
    avgVolume30d: 7_060_268,
    description: "NVIDIA designs graphics processing units and AI accelerators.",
    fetchedAt: "2026-05-07T13:00:00Z",
    isDemo: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("AboutSection", () => {
  it("shows a loading shell with em-dash sector chip on first paint", () => {
    mockedFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const Wrapper = makeWrapper();
    const { getByTestId, container } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    const section = getByTestId("about-section");
    expect(section.getAttribute("data-slot")).toBe("about-section-loading");
    expect(section.getAttribute("id")).toBe("about");
    const chip = container.querySelector('[data-slot="about-sector-industry"]');
    expect(chip?.textContent).toBe("—");
    const body = container.querySelector('[data-slot="about-description"]');
    expect(body?.textContent).toBe("Loading…");
  });

  it("renders description, sector, and industry separated by '·' when ready", async () => {
    mockedFetch.mockResolvedValue(makeFundamentals());
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("about-section").getAttribute("data-slot")).toBe("about-section-ready");
    });
    const description = container.querySelector('[data-slot="about-description"]');
    expect(description?.textContent).toBe(
      "NVIDIA designs graphics processing units and AI accelerators.",
    );
    const chip = container.querySelector('[data-slot="about-sector-industry"]');
    expect(chip?.textContent).toBe("Technology · Semiconductors");
  });

  it("falls back to a friendly message and hides the toggle when description is null", async () => {
    mockedFetch.mockResolvedValue(makeFundamentals({ description: null }));
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("about-section").getAttribute("data-slot")).toBe("about-section-ready");
    });
    const description = container.querySelector('[data-slot="about-description"]');
    expect(description?.textContent).toBe("Company description not available.");
    expect(container.querySelector('[data-slot="about-toggle"]')).toBeNull();
  });

  it("toggles a long description between clamped and expanded on button click", async () => {
    const longDescription = "A".repeat(600);
    mockedFetch.mockResolvedValue(makeFundamentals({ description: longDescription }));
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("about-section").getAttribute("data-slot")).toBe("about-section-ready");
    });
    const toggle = container.querySelector('[data-slot="about-toggle"]') as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toBe("Show more");

    const description = container.querySelector('[data-slot="about-description"]')!;
    expect(description.className).toContain("line-clamp-6");

    fireEvent.click(toggle!);
    expect(toggle?.textContent).toBe("Show less");
    expect(description.className).not.toContain("line-clamp-6");

    fireEvent.click(toggle!);
    expect(toggle?.textContent).toBe("Show more");
    expect(description.className).toContain("line-clamp-6");
  });

  it("renders an error shell with em-dash sector when the fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("boom"));
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("about-section").getAttribute("data-slot")).toBe("about-section-error");
    });
    const chip = container.querySelector('[data-slot="about-sector-industry"]');
    expect(chip?.textContent).toBe("—");
    const description = container.querySelector('[data-slot="about-description"]');
    expect(description?.textContent).toBe("Description unavailable");
    expect(container.querySelector('[data-slot="about-toggle"]')).toBeNull();
  });

  it("anchors at id='about' with scroll-mt-24 (sticky-band offset)", async () => {
    mockedFetch.mockResolvedValue(makeFundamentals());
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <AboutSection symbol="NVDA" />),
    );
    const section = getByTestId("about-section");
    expect(section.getAttribute("id")).toBe("about");
    expect(section.className).toContain("scroll-mt-24");
  });
});
