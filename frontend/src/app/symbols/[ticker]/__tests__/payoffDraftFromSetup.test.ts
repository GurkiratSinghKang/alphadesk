import { describe, expect, it } from "vitest";

import type { EarningsSetup, EarningsSetupLeg } from "@/types";
import { SETUP_ID_TO_LABEL } from "@/lib/api";

import { payoffDraftFromSetup } from "../_lib/payoffDraftFromSetup";

const EXPIRY = "2026-05-16";

function makeLeg(overrides: Partial<EarningsSetupLeg> = {}): EarningsSetupLeg {
  return {
    side: "buy",
    contractType: "call",
    strike: 200,
    expiry: EXPIRY,
    qty: 1,
    mid: 1.25,
    ...overrides,
  };
}

function makeSetup(
  setupId: string,
  legs: EarningsSetupLeg[],
  overrides: Partial<EarningsSetup> = {},
): EarningsSetup {
  return {
    setupId: setupId as EarningsSetup["setupId"],
    setupLabel: SETUP_ID_TO_LABEL[setupId] ?? null,
    legs,
    netCreditOrDebit: -2.5,
    maxProfit: null,
    maxLoss: -250,
    breakevens: [201.25],
    popEstimate: 0.45,
    expectedValue: 12,
    riskReward: null,
    rationale: "test rationale",
    sizingKellyPct: 0.01,
    isDefinedRisk: true,
    confidence: null,
    ...overrides,
  };
}

describe("payoffDraftFromSetup", () => {
  it("converts a bull put spread (vertical, 2 legs) to a draft with sell+buy puts", () => {
    const setup = makeSetup("bull_put_spread", [
      makeLeg({ side: "sell", contractType: "put", strike: 195, mid: 2.4 }),
      makeLeg({ side: "buy", contractType: "put", strike: 190, mid: 1.1 }),
    ]);

    const draft = payoffDraftFromSetup(setup, "NVDA", 200);

    expect(draft).not.toBeNull();
    expect(draft!.underlying).toBe("NVDA");
    expect(draft!.spotPrice).toBe(200);
    expect(draft!.comboType).toBe("bull_put_spread");
    expect(draft!.legs).toHaveLength(2);
    expect(draft!.legs[0]).toMatchObject({
      side: "sell",
      kind: "put",
      strike: 195,
      entryPrice: 2.4,
      qty: 1,
      expiry: EXPIRY,
    });
    expect(draft!.legs[1]).toMatchObject({
      side: "buy",
      kind: "put",
      strike: 190,
      entryPrice: 1.1,
    });
    expect(draft!.legs[0].occSymbol).toMatch(/^NVDA260516P00195000$/);
    expect(draft!.legs[1].occSymbol).toMatch(/^NVDA260516P00190000$/);
  });

  it("converts an iron condor (4 legs) preserving each leg's side + strike + kind", () => {
    const setup = makeSetup("iron_condor", [
      makeLeg({ side: "sell", contractType: "put", strike: 195, mid: 2.4 }),
      makeLeg({ side: "buy", contractType: "put", strike: 190, mid: 1.1 }),
      makeLeg({ side: "sell", contractType: "call", strike: 210, mid: 2.0 }),
      makeLeg({ side: "buy", contractType: "call", strike: 215, mid: 0.9 }),
    ]);

    const draft = payoffDraftFromSetup(setup, "NVDA", 200);

    expect(draft).not.toBeNull();
    expect(draft!.comboType).toBe("iron_condor");
    expect(draft!.legs).toHaveLength(4);
    expect(draft!.legs.map((l) => `${l.side}-${l.kind}-${l.strike}`)).toEqual([
      "sell-put-195",
      "buy-put-190",
      "sell-call-210",
      "buy-call-215",
    ]);
  });

  it("converts a long straddle (2 legs, buy call + buy put at same strike)", () => {
    const setup = makeSetup("long_straddle", [
      makeLeg({ side: "buy", contractType: "call", strike: 200, mid: 4.5 }),
      makeLeg({ side: "buy", contractType: "put", strike: 200, mid: 3.7 }),
    ]);

    const draft = payoffDraftFromSetup(setup, "NVDA", 200);

    expect(draft).not.toBeNull();
    expect(draft!.comboType).toBe("long_straddle");
    expect(draft!.legs).toHaveLength(2);
    expect(draft!.legs.every((l) => l.side === "buy")).toBe(true);
    expect(draft!.legs.every((l) => l.strike === 200)).toBe(true);
    expect(draft!.legs.map((l) => l.kind).sort()).toEqual(["call", "put"]);
  });

  it("returns null for unsupported setup_id (skip / unknown kind)", () => {
    const skip = makeSetup("skip", [
      makeLeg({ side: "buy", contractType: "call", strike: 200 }),
    ]);
    expect(payoffDraftFromSetup(skip, "NVDA", 200)).toBeNull();

    const unknown = makeSetup("future_unicorn_spread", [
      makeLeg({ side: "buy", contractType: "call", strike: 200 }),
    ]);
    expect(payoffDraftFromSetup(unknown, "NVDA", 200)).toBeNull();
  });

  it("returns null when legs is empty or omitted", () => {
    const empty = makeSetup("long_call", []);
    expect(payoffDraftFromSetup(empty, "NVDA", 200)).toBeNull();
  });

  it("returns null when any leg has an invalid strike or expiry (occSymbol fails)", () => {
    const badStrike = makeSetup("long_call", [
      makeLeg({ side: "buy", contractType: "call", strike: -5 }),
    ]);
    expect(payoffDraftFromSetup(badStrike, "NVDA", 200)).toBeNull();

    const badExpiry = makeSetup("long_call", [
      makeLeg({ side: "buy", contractType: "call", expiry: "not-a-date" }),
    ]);
    expect(payoffDraftFromSetup(badExpiry, "NVDA", 200)).toBeNull();
  });

  it("builds a single-leg long_call draft with the leg's mid as entryPrice", () => {
    const setup = makeSetup("long_call", [
      makeLeg({ side: "buy", contractType: "call", strike: 205, mid: 3.2 }),
    ]);

    const draft = payoffDraftFromSetup(setup, "NVDA", 200);

    expect(draft).not.toBeNull();
    expect(draft!.legs).toHaveLength(1);
    expect(draft!.legs[0].entryPrice).toBe(3.2);
    expect(draft!.legs[0].mid).toBe(3.2);
    expect(draft!.label).toBe("long call");
  });
});
