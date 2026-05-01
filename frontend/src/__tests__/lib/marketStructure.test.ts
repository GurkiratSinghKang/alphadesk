import { describe, expect, it } from "vitest";

import {
  calculateVolumeProfile,
  deriveMarketStructure,
  deriveSupportResistanceZones,
  detectOrderBlocks,
} from "@/lib/marketStructure";
import type { OHLCVBar } from "@/types";

function bar(i: number, overrides: Partial<OHLCVBar> = {}): OHLCVBar {
  const base = 100 + Math.sin(i / 2) * 2;
  return {
    time: i + 1,
    open: base,
    high: base + 1.4,
    low: base - 1.4,
    close: base + 0.3,
    volume: 1000 + i * 20,
    ...overrides,
  };
}

describe("marketStructure", () => {
  it("calculates POC and value area for volume-at-price", () => {
    const bars = [
      bar(0, { low: 98, high: 100, volume: 1_000 }),
      bar(1, { low: 100, high: 102, volume: 7_000 }),
      bar(2, { low: 100.5, high: 102.5, volume: 6_000 }),
      bar(3, { low: 104, high: 106, volume: 1_000 }),
    ];

    const profile = calculateVolumeProfile(bars, 8);
    expect(profile.length).toBe(8);
    expect(profile.some((b) => b.isPoc)).toBe(true);
    expect(profile.some((b) => b.inValueArea)).toBe(true);
    expect(profile.reduce((sum, b) => sum + b.volumeShare, 0)).toBeCloseTo(1, 5);
  });

  it("returns support and resistance zones as ranges, not single prices", () => {
    const bars = Array.from({ length: 42 }, (_, i) => {
      if (i % 10 === 0) return bar(i, { low: 95, high: 101, close: 99, volume: 2_500 });
      if (i % 10 === 5) return bar(i, { low: 102, high: 110, close: 104, volume: 2_700 });
      return bar(i);
    });

    const zones = deriveSupportResistanceZones(bars, { maxZones: 6 });
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((z) => z.upper > z.lower)).toBe(true);
    expect(zones.some((z) => z.kind === "support")).toBe(true);
    expect(zones.some((z) => z.kind === "resistance")).toBe(true);
  });

  it("detects high-volume demand blocks without claiming true L2 depth", () => {
    const bars = Array.from({ length: 35 }, (_, i) => bar(i, { close: 100 + i * 0.05 }));
    bars[22] = bar(22, {
      open: 100,
      high: 101,
      low: 96,
      close: 97,
      volume: 8_000,
    });
    bars[23] = bar(23, { open: 98, high: 103, low: 97.8, close: 102.6, volume: 2_400 });
    bars[24] = bar(24, { open: 102.6, high: 105, low: 102, close: 104.8, volume: 2_100 });
    bars[25] = bar(25, { open: 104.8, high: 106, low: 104.1, close: 105.6, volume: 2_000 });

    const blocks = detectOrderBlocks(bars, { maxBlocks: 3, minRelativeVolume: 1.25 });
    expect(blocks.some((b) => b.kind === "demand")).toBe(true);
    expect(blocks.every((b) => b.status !== "invalidated")).toBe(true);
  });

  it("degrades cleanly when bars have no volume", () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, { volume: 0 }));
    const map = deriveMarketStructure(bars);
    expect(map.hasVolume).toBe(false);
    expect(map.profile).toEqual([]);
    expect(map.orderBlocks).toEqual([]);
  });
});
