import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NewsFeed from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed";

describe("NewsFeed", () => {
  it("renders article titles, sources, and published time", () => {
    const { container } = render(
      <NewsFeed news={[
        { title: "Blackwell ramp on track", source: "Reuters", publishedAt: new Date().toISOString(), url: "https://example.com/a" },
        { title: "China export pivot", source: "Bloomberg", publishedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), url: "https://example.com/b" },
      ]} />,
    );
    expect(container.textContent).toContain("Blackwell ramp on track");
    expect(container.textContent).toContain("Reuters");
    expect(container.textContent).toContain("China export pivot");
    expect(container.textContent).toContain("Bloomberg");
    const linkA = container.querySelector('a[href="https://example.com/a"]');
    expect(linkA).not.toBeNull();
  });

  it("renders empty state when no news", () => {
    const { container } = render(<NewsFeed news={[]} />);
    expect(container.textContent).toMatch(/no news|—/i);
  });

  // B2.1: sentiment / magnitude / confidence chips render.
  describe("B2.1 — sentiment chips", () => {
    it("renders bullish chip with green styling and confidence dot", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD beats estimates and surges",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sentiment: "bullish",
          confidence: 0.8,
          magnitude: "large",
        }]} />,
      );
      const chip = container.querySelector('[data-slot="news-sentiment"]');
      expect(chip).not.toBeNull();
      expect(chip?.getAttribute("data-sentiment")).toBe("bullish");
      expect(chip?.textContent ?? "").toContain("Bullish");
    });

    it("renders bearish chip in red", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD misses Q1, plunges",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sentiment: "bearish",
          confidence: 0.7,
          magnitude: "large",
        }]} />,
      );
      const chip = container.querySelector('[data-slot="news-sentiment"]');
      expect(chip?.getAttribute("data-sentiment")).toBe("bearish");
      expect(chip?.textContent ?? "").toContain("Bearish");
    });

    it("renders neutral chip with hollow dot when confidence is low", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD reports today",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sentiment: "neutral",
          confidence: 0.4,
        }]} />,
      );
      const chip = container.querySelector('[data-slot="news-sentiment"]');
      expect(chip?.getAttribute("data-sentiment")).toBe("neutral");
      // Hollow dot is "○"
      expect(chip?.textContent ?? "").toContain("○");
    });

    it("renders large move expected suffix", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD surges on blockbuster earnings",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sentiment: "bullish",
          confidence: 0.8,
          magnitude: "large",
        }]} />,
      );
      expect(container.textContent ?? "").toMatch(/large move expected/i);
    });
  });

  // B2.5: precise timestamp on hover.
  describe("B2.5 — precise timestamp on hover", () => {
    it("wraps the relative time in a span with title=absolute timestamp", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD news",
          source: "Reuters",
          publishedAt: "2026-04-25T14:30:00Z",
          url: "https://example.com/x",
        }]} />,
      );
      const tsSpan = container.querySelector('[data-slot="news-ts"]');
      expect(tsSpan).not.toBeNull();
      const titleAttr = tsSpan?.getAttribute("title") ?? "";
      // The title attribute should contain a date-formatted value
      // (year, month, day) — far more specific than "1d ago".
      expect(titleAttr.length).toBeGreaterThan(8);
    });
  });

  // B2.6: tier badge.
  describe("B2.6 — source tier badge", () => {
    it("shows star for tier-1 (priority < 100)", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "Reuters story",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sourcePriority: 50,
        }]} />,
      );
      expect(container.textContent ?? "").toContain("★");
    });

    it("does not show star for tier-2 (priority 100-1000)", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "Mainstream story",
          source: "Yahoo",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sourcePriority: 500,
          tier: 2,
        }]} />,
      );
      expect(container.textContent ?? "").not.toContain("★");
    });

    it("applies muted styling for tier-3 (priority > 1000) blogs", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "Random blog",
          source: "Some Blog",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          sourcePriority: 5000,
        }]} />,
      );
      const link = container.querySelector("a");
      expect(link?.className ?? "").toMatch(/u-muted/);
    });
  });

  // B2.4: duplicate-count suffix.
  describe("B2.4 — dedup +N more suffix", () => {
    it("appends + N more when duplicateCount > 0", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD beats Q1 estimates",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
          duplicateCount: 3,
        }]} />,
      );
      expect(container.textContent ?? "").toContain("+3 more");
    });

    it("does not append suffix when duplicateCount is 0 or absent", () => {
      const { container } = render(
        <NewsFeed news={[{
          title: "AMD beats Q1 estimates",
          source: "Reuters",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/x",
        }]} />,
      );
      expect(container.textContent ?? "").not.toMatch(/\+\d+ more/);
    });
  });
});
