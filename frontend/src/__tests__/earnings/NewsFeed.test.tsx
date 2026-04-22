import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NewsFeed from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed";

describe("NewsFeed", () => {
  it("renders article titles, sources, and published time", () => {
    const { container } = render(
      <NewsFeed news={[
        { title: "Blackwell ramp on track", source: "Reuters", published_at: new Date().toISOString(), url: "https://example.com/a" },
        { title: "China export pivot", source: "Bloomberg", published_at: new Date(Date.now() - 5 * 3600_000).toISOString(), url: "https://example.com/b" },
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
});
