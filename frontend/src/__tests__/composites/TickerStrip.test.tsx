import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TickerStrip from "@/components/composites/TickerStrip";

describe("TickerStrip", () => {
  it("renders marquee track, paused by default (WCAG)", () => {
    const { container } = render(
      <TickerStrip
        tickers={[
          { symbol: "NVDA", price: "134.82", deltaPct: 1.31 },
          { symbol: "SPY", price: "482.91", deltaPct: 0.44 },
          { symbol: "UNH", price: "581.76", deltaPct: -1.04 },
        ]}
      />,
    );
    const strip = container.querySelector('[data-slot="ticker-strip"]') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip.getAttribute("data-paused")).toBe("true");
    // Content is doubled for seamless infinite loop
    const count = (container.textContent?.match(/NVDA/g) ?? []).length;
    expect(count).toBe(2);
  });

  it("drops data-paused when paused=false", () => {
    const { container } = render(
      <TickerStrip
        paused={false}
        tickers={[{ symbol: "X", price: "1.00", deltaPct: 0.1 }]}
      />,
    );
    const strip = container.querySelector('[data-slot="ticker-strip"]');
    expect(strip?.getAttribute("data-paused")).toBeNull();
  });
});
