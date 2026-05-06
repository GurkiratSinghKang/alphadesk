import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { EarningsNewsArticle } from "@/types";

vi.mock("@/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed", () => ({
  __esModule: true,
  default: ({ news }: { news: EarningsNewsArticle[] }) => (
    <div data-testid="mock-news-feed" data-count={news.length}>
      {news.map((a) => (
        <a key={a.url} data-testid="mock-article" href={a.url}>
          {a.title}
        </a>
      ))}
    </div>
  ),
}));

import { NewsBand } from "../_sections/NewsBand";

function makeArticle(overrides: Partial<EarningsNewsArticle> = {}): EarningsNewsArticle {
  return {
    title: "NVIDIA beats Q3 estimates",
    source: "Reuters",
    publishedAt: "2026-05-04T18:00:00Z",
    url: "https://example.com/nvda-q3",
    relevanceScore: 0.9,
    category: "earnings",
    tier: 1,
    sentiment: "positive",
    ...overrides,
  };
}

describe("NewsBand", () => {
  it("renders the section anchor id='news' with scroll-mt-24", () => {
    const { getByTestId } = render(<NewsBand news={[makeArticle()]} />);
    const band = getByTestId("news-band");
    expect(band.getAttribute("id")).toBe("news");
    expect(band.className).toContain("scroll-mt-24");
  });

  it("forwards articles to the recycled NewsFeed component", () => {
    const news = [
      makeArticle({ url: "https://a.example/1", title: "A" }),
      makeArticle({ url: "https://a.example/2", title: "B" }),
      makeArticle({ url: "https://a.example/3", title: "C" }),
    ];
    const { getByTestId, getAllByTestId } = render(<NewsBand news={news} />);
    expect(getByTestId("mock-news-feed").getAttribute("data-count")).toBe("3");
    expect(getAllByTestId("mock-article")).toHaveLength(3);
  });

  it("passes an empty array to NewsFeed when news is null (NewsFeed handles its own empty state)", () => {
    const { getByTestId } = render(<NewsBand news={null} />);
    expect(getByTestId("mock-news-feed").getAttribute("data-count")).toBe("0");
  });
});
