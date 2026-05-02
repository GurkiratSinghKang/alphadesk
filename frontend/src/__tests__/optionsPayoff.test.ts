import { describe, expect, it } from "vitest";
import {
  calculatePayoffSummary,
  type OptionStrategyDraft,
  type OptionStrategyLeg,
} from "@/lib/optionsPayoff";

function leg(
  kind: "call" | "put",
  strike: number,
  side: "buy" | "sell",
  entryPrice: number | null,
): OptionStrategyLeg {
  const cp = kind === "call" ? "C" : "P";
  return {
    id: `${kind}-${strike}-${side}`,
    occSymbol: `AAPL260501${cp}${String(strike * 1000).padStart(8, "0")}`,
    underlying: "AAPL",
    expiry: "2026-05-01",
    kind,
    strike,
    side,
    qty: 1,
    entryPrice,
  };
}

function draft(legs: OptionStrategyLeg[]): OptionStrategyDraft {
  return {
    underlying: "AAPL",
    spotPrice: 100,
    label: "test",
    source: "trade",
    legs,
  };
}

function finite(value: ReturnType<typeof calculatePayoffSummary>["maxProfit"]) {
  expect(value.kind).toBe("finite");
  return value.kind === "finite" ? value.value : NaN;
}

describe("calculatePayoffSummary", () => {
  it("models a long call", () => {
    const summary = calculatePayoffSummary(draft([leg("call", 100, "buy", 5)]));
    expect(summary.maxProfit.kind).toBe("unlimited");
    expect(finite(summary.maxLoss)).toBeCloseTo(500);
    expect(summary.breakevens).toEqual([105]);
  });

  it("models a long put", () => {
    const summary = calculatePayoffSummary(draft([leg("put", 100, "buy", 4)]));
    expect(finite(summary.maxProfit)).toBeCloseTo(9600);
    expect(finite(summary.maxLoss)).toBeCloseTo(400);
    expect(summary.breakevens).toEqual([96]);
  });

  it("models naked short options as unlimited when appropriate", () => {
    const shortCall = calculatePayoffSummary(draft([leg("call", 100, "sell", 5)]));
    const shortPut = calculatePayoffSummary(draft([leg("put", 100, "sell", 4)]));
    expect(finite(shortCall.maxProfit)).toBeCloseTo(500);
    expect(shortCall.maxLoss.kind).toBe("unlimited");
    expect(shortCall.breakevens).toEqual([105]);
    expect(finite(shortPut.maxProfit)).toBeCloseTo(400);
    expect(finite(shortPut.maxLoss)).toBeCloseTo(9600);
    expect(shortPut.breakevens).toEqual([96]);
  });

  it("models vertical spreads", () => {
    const debit = calculatePayoffSummary(draft([
      leg("call", 100, "buy", 6),
      leg("call", 110, "sell", 2),
    ]));
    const credit = calculatePayoffSummary(draft([
      leg("put", 100, "sell", 5),
      leg("put", 90, "buy", 2),
    ]));
    expect(finite(debit.maxProfit)).toBeCloseTo(600);
    expect(finite(debit.maxLoss)).toBeCloseTo(400);
    expect(debit.breakevens).toEqual([104]);
    expect(finite(credit.maxProfit)).toBeCloseTo(300);
    expect(finite(credit.maxLoss)).toBeCloseTo(700);
    expect(credit.breakevens).toEqual([97]);
  });

  it("models long straddles and short strangles", () => {
    const straddle = calculatePayoffSummary(draft([
      leg("call", 100, "buy", 5),
      leg("put", 100, "buy", 4),
    ]));
    const strangle = calculatePayoffSummary(draft([
      leg("call", 110, "sell", 2),
      leg("put", 90, "sell", 2),
    ]));
    expect(straddle.maxProfit.kind).toBe("unlimited");
    expect(finite(straddle.maxLoss)).toBeCloseTo(900);
    expect(straddle.breakevens).toEqual([91, 109]);
    expect(finite(strangle.maxProfit)).toBeCloseTo(400);
    expect(strangle.maxLoss.kind).toBe("unlimited");
    expect(strangle.breakevens).toEqual([86, 114]);
  });

  it("models iron condors and iron butterflies", () => {
    const condor = calculatePayoffSummary(draft([
      leg("put", 95, "sell", 2),
      leg("put", 90, "buy", 1),
      leg("call", 105, "sell", 2),
      leg("call", 110, "buy", 1),
    ]));
    const fly = calculatePayoffSummary(draft([
      leg("put", 100, "sell", 4),
      leg("put", 90, "buy", 1),
      leg("call", 100, "sell", 4),
      leg("call", 110, "buy", 1),
    ]));
    expect(finite(condor.maxProfit)).toBeCloseTo(200);
    expect(finite(condor.maxLoss)).toBeCloseTo(300);
    expect(condor.breakevens).toEqual([93, 107]);
    expect(finite(fly.maxProfit)).toBeCloseTo(600);
    expect(finite(fly.maxLoss)).toBeCloseTo(400);
    expect(fly.breakevens).toEqual([94, 106]);
  });

  it("marks unpriced legs as unpriced", () => {
    const summary = calculatePayoffSummary(draft([leg("call", 100, "buy", null)]));
    expect(summary.status).toBe("unpriced");
    expect(summary.maxLoss.kind).toBe("unknown");
  });
});
