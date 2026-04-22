import { describe, it, expect } from "vitest";
import { STRATEGY_META, metaKind } from "@/lib/strategies";

describe("STRATEGY_META kind flag", () => {
  it("defaults autonomous strategies to 'autonomous'", () => {
    expect(metaKind("pead")).toBe("autonomous");
    expect(metaKind("momentum-quality")).toBe("autonomous");
  });

  it("registers earnings-options-play with kind='research'", () => {
    expect(STRATEGY_META["earnings-options-play"]).toBeDefined();
    expect(metaKind("earnings-options-play")).toBe("research");
  });

  it("surfaces research name + subtitle for the list card", () => {
    const entry = STRATEGY_META["earnings-options-play"];
    expect(entry.name).toMatch(/Earnings Options Play/i);
    expect(entry.regimeNote).toMatch(/research|screener|decision/i);
  });
});
