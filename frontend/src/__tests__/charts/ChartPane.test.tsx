import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartPane from "@/components/charts/ChartPane";

/**
 * v1 interaction coverage for the drawing-tools rail. We don't try to
 * exercise the canvas click-to-draw path here because lightweight-charts
 * renders into a <canvas> that jsdom can't measure — that path gets
 * covered by the e2e suite. What we CAN assert: picking a tool flips the
 * button's aria-pressed, and text (v2) surfaces as disabled so the user
 * never enters a dead-end draw mode.
 */
describe("ChartPane — drawing tools rail", () => {
  const bars = [
    { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    { time: 2, open: 100.5, high: 102, low: 100, close: 101.8, volume: 1200 },
  ];

  it("flips aria-pressed on the trend tool when clicked", () => {
    render(<ChartPane data={bars} />);
    const trend = screen.getByRole("button", { name: /trend line/i });
    expect(trend.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(trend);
    expect(trend.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the text tool disabled until v2 ships", () => {
    render(<ChartPane data={bars} />);
    const textBtn = screen.getByRole("button", { name: /text/i });
    expect((textBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
