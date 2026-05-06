import { describe, expect, it } from "vitest";

import { normalizeSymbol } from "../_lib/normalizeSymbol";

describe("normalizeSymbol", () => {
  it("upper-cases lowercase input", () => {
    expect(normalizeSymbol("nvda")).toBe("NVDA");
  });

  it("trims whitespace and strips non-allowed chars", () => {
    expect(normalizeSymbol("  TSLA!")).toBe("TSLA");
  });

  it("returns null for input longer than 12 chars after cleaning", () => {
    expect(normalizeSymbol("AAAAAAAAAAAAA")).toBeNull(); // 13 As
  });

  it("returns null for empty string", () => {
    expect(normalizeSymbol("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeSymbol(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeSymbol(undefined)).toBeNull();
  });

  it("preserves dots in tickers like BRK.B", () => {
    expect(normalizeSymbol("brk.b")).toBe("BRK.B");
  });

  it("preserves hyphens (e.g. crypto pairs btc-usd)", () => {
    expect(normalizeSymbol("btc-usd")).toBe("BTC-USD");
  });

  it("returns null when only disallowed chars are passed", () => {
    expect(normalizeSymbol("!!!@@@")).toBeNull();
  });

  it("accepts the 12-char boundary", () => {
    expect(normalizeSymbol("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL"); // exactly 12
  });
});
