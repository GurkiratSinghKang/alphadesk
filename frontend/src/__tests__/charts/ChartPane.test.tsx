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
});
