import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChartPane from "@/components/charts/ChartPane";

/**
 * Slice-9 / CH-3C: ChartPane now uses ``useSparklineBars`` (react-query)
 * for the compare-symbol overlay. Tests must wrap in a QueryClientProvider
 * even though the test fixtures don't add any compare symbols — the hook
 * runs unconditionally with an empty list. Helper makes the wrapping
 * intent explicit.
 */
function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("ChartPane — drawing tools rail", () => {
  const bars = [
    { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    { time: 2, open: 100.5, high: 102, low: 100, close: 101.8, volume: 1200 },
  ];

  it("flips aria-pressed on the trend tool when clicked", () => {
    renderWithQuery(<ChartPane data={bars} />);
    const trend = screen.getByRole("button", { name: /trend line/i });
    expect(trend.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(trend);
    expect(trend.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the text tool disabled until v2 ships", () => {
    renderWithQuery(<ChartPane data={bars} />);
    const textBtn = screen.getByRole("button", { name: /text/i });
    expect((textBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes truthful market-structure layer toggles", () => {
    renderWithQuery(<ChartPane data={bars} />);
    const profile = screen.getByRole("button", { name: /profile/i });
    const zones = screen.getByRole("button", { name: /s\/r/i });
    const blocks = screen.getByRole("button", { name: /blocks/i });

    expect(profile.getAttribute("aria-pressed")).toBe("false");
    expect(zones.getAttribute("aria-pressed")).toBe("false");
    expect(blocks.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(zones);
    expect(zones.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders a top-of-book layer without presenting it as full depth", () => {
    renderWithQuery(
      <ChartPane
        data={bars}
        topOfBook={{
          bid: 100.1,
          ask: 100.25,
          bidSize: 800,
          askSize: 1200,
          bidExchange: "V",
          askExchange: "Q",
        }}
      />,
    );

    const book = screen.getByRole("button", { name: /book/i });
    expect(book.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryAllByText(/top book/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NBBO quote only/i)).not.toBeNull();

    fireEvent.click(book);
    expect(book.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/NBBO quote only/i)).toBeNull();
  });

  it("can consume the market-depth contract when a provider supplies it", () => {
    renderWithQuery(
      <ChartPane
        data={bars}
        marketDepth={{
          symbol: "AAPL",
          kind: "level_2",
          provider: "databento",
          bids: [
            { price: 100.1, size: 800, venue: "XNAS" },
            { price: 100.05, size: 400, venue: "EDGX" },
          ],
          asks: [
            { price: 100.25, size: 1200, venue: "XNAS" },
            { price: 100.3, size: 300, venue: "EDGX" },
          ],
          timestamp: Date.now(),
          isL2: true,
          notes: [],
        }}
      />,
    );

    expect(screen.queryByText(/Depth 2/i)).not.toBeNull();
    expect(screen.queryByText(/databento/i)).not.toBeNull();
    expect(screen.queryByText(/NBBO quote only/i)).toBeNull();
  });
});
