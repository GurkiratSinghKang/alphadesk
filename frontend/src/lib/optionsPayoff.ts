import type { LadderRow, OptionsContract } from "@/types";
import { formatOccSymbol } from "@/lib/occ";

export type OptionKind = "call" | "put";
export type OptionOrderSide = "buy" | "sell";

export interface OptionStrategyLeg {
  id: string;
  occSymbol: string;
  underlying: string;
  expiry: string;
  kind: OptionKind;
  strike: number;
  side: OptionOrderSide;
  qty: number;
  entryPrice: number | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  last?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  oi?: number | null;
  volume?: number | null;
}

export interface OptionStrategyDraft {
  underlying: string;
  spotPrice: number | null;
  label: string;
  source: "trade" | "earnings-options-play" | "builder";
  quoteTimestamp?: string | number | null;
  comboType?: string | null;
  legs: OptionStrategyLeg[];
}

export type PayoffValue =
  | { kind: "finite"; value: number }
  | { kind: "unlimited" }
  | { kind: "unknown"; reason: string };

export interface PayoffPoint {
  underlyingPrice: number;
  pnl: number;
}

export interface PayoffSummary {
  status: "ready" | "empty" | "unpriced" | "mixed_expiry" | "invalid";
  reason: string | null;
  netPremium: number;
  maxProfit: PayoffValue;
  maxLoss: PayoffValue;
  breakevens: number[];
  payoffPoints: PayoffPoint[];
  spotPrice: number | null;
  expiries: string[];
  priceRange: { min: number; max: number };
}

const CONTRACT_MULTIPLIER = 100;
const EPSILON = 1e-7;

export function calculatePayoffSummary(draft: OptionStrategyDraft | null | undefined): PayoffSummary {
  if (!draft || draft.legs.length === 0) {
    return emptySummary("empty", "Add up to four option legs to model the payoff.");
  }

  if (draft.legs.length > 4) {
    return emptySummary("invalid", "Alpaca multi-leg option orders support at most four legs.");
  }

  const expiries = [...new Set(draft.legs.map((leg) => leg.expiry).filter(Boolean))];
  if (expiries.length > 1) {
    return {
      ...emptySummary("mixed_expiry", "Mixed-expiry strategies need a model-dependent calendar view."),
      expiries,
    };
  }

  const invalidLeg = draft.legs.find((leg) => {
    return (
      !Number.isFinite(leg.strike) ||
      leg.strike <= 0 ||
      !Number.isInteger(leg.qty) ||
      leg.qty <= 0 ||
      (leg.entryPrice != null && (!Number.isFinite(leg.entryPrice) || leg.entryPrice < 0))
    );
  });
  if (invalidLeg) {
    return emptySummary("invalid", `Invalid leg: ${invalidLeg.occSymbol || invalidLeg.id}.`);
  }

  const unpriced = draft.legs.find((leg) => leg.entryPrice == null);
  if (unpriced) {
    return {
      ...emptySummary("unpriced", "Every leg needs an entry price before max profit/loss can be trusted."),
      spotPrice: finitePositive(draft.spotPrice) ? draft.spotPrice : null,
      expiries,
    };
  }

  const netPremium = draft.legs.reduce((sum, leg) => {
    const price = leg.entryPrice ?? 0;
    return sum + (leg.side === "sell" ? price : -price) * leg.qty * CONTRACT_MULTIPLIER;
  }, 0);
  const strikes = draft.legs.map((leg) => leg.strike).sort((a, b) => a - b);
  const spot = finitePositive(draft.spotPrice) ? draft.spotPrice : null;
  const maxStrike = Math.max(...strikes);
  const minStrike = Math.min(...strikes);
  const lowChart = Math.max(0, Math.min(spot != null ? spot * 0.65 : minStrike * 0.75, minStrike * 0.75));
  const highChart = Math.max(
    spot != null ? spot * 1.35 : maxStrike * 1.35,
    maxStrike * 1.25,
    maxStrike + Math.max(5, maxStrike * 0.08),
  );
  const finiteCheckpoints = uniqueNumbers([0, ...strikes, highChart]).sort((a, b) => a - b);
  const checkpointPnls = finiteCheckpoints.map((price) => payoffAtPrice(draft.legs, price));
  const highSlope = highSideSlope(draft.legs);
  const finiteMax = Math.max(...checkpointPnls);
  const finiteMin = Math.min(...checkpointPnls);
  const maxProfit: PayoffValue = highSlope > EPSILON ? { kind: "unlimited" } : { kind: "finite", value: finiteMax };
  const maxLoss: PayoffValue = highSlope < -EPSILON ? { kind: "unlimited" } : { kind: "finite", value: Math.abs(finiteMin) };
  const rootPrices = uniqueNumbers([0, ...strikes, highChart]).sort((a, b) => a - b);
  const breakevens = findBreakevens(draft.legs, rootPrices);
  const chartMax = Math.max(highChart, ...breakevens.map((price) => price * 1.05));
  const payoffPoints = buildCurvePoints(draft.legs, lowChart, chartMax, strikes);

  return {
    status: "ready",
    reason: null,
    netPremium,
    maxProfit,
    maxLoss,
    breakevens,
    payoffPoints,
    spotPrice: spot,
    expiries,
    priceRange: { min: lowChart, max: chartMax },
  };
}

export function payoffAtPrice(legs: OptionStrategyLeg[], underlyingPrice: number): number {
  return legs.reduce((sum, leg) => {
    const entry = leg.entryPrice ?? 0;
    const intrinsic =
      leg.kind === "call"
        ? Math.max(underlyingPrice - leg.strike, 0)
        : Math.max(leg.strike - underlyingPrice, 0);
    const signed = leg.side === "buy" ? intrinsic - entry : entry - intrinsic;
    return sum + signed * leg.qty * CONTRACT_MULTIPLIER;
  }, 0);
}

export function optionLegFromContract({
  contract,
  underlying,
  side,
  qty = 1,
}: {
  contract: OptionsContract;
  underlying: string;
  side: OptionOrderSide;
  qty?: number;
}): OptionStrategyLeg | null {
  const occSymbol = contract.symbol || formatOccSymbol({
    symbol: underlying,
    expiry: contract.expiry,
    side: contract.type,
    strike: contract.strike,
  });
  if (!occSymbol) return null;
  const mid = pickEntryPrice(contract.bid, contract.ask, contract.last);
  return {
    id: `${occSymbol}:${side}`,
    occSymbol,
    underlying,
    expiry: contract.expiry,
    kind: contract.type,
    strike: contract.strike,
    side,
    qty,
    entryPrice: mid,
    bid: contract.bid,
    ask: contract.ask,
    mid,
    last: contract.last,
    iv: contract.iv,
    delta: contract.delta,
    gamma: contract.gamma,
    theta: contract.theta,
    vega: contract.vega,
    oi: contract.oi,
    volume: contract.volume,
  };
}

export function optionLegFromLadderRow({
  row,
  underlying,
  expiry,
  side,
  qty = 1,
}: {
  row: LadderRow;
  underlying: string;
  expiry: string;
  side: OptionOrderSide;
  qty?: number;
}): OptionStrategyLeg | null {
  const occSymbol = formatOccSymbol({
    symbol: underlying,
    expiry,
    side: row.side,
    strike: row.strike,
  });
  if (!occSymbol) return null;
  const mid = pickEntryPrice(row.bid, row.ask, row.mid);
  return {
    id: `${occSymbol}:${side}`,
    occSymbol,
    underlying,
    expiry,
    kind: row.side,
    strike: row.strike,
    side,
    qty,
    entryPrice: mid,
    bid: row.bid,
    ask: row.ask,
    mid,
    last: row.mid,
    iv: row.iv,
    delta: row.delta,
    gamma: row.gamma,
    theta: row.theta,
    vega: row.vega,
    oi: row.oi,
    volume: row.volume,
  };
}

export function pickEntryPrice(bid: number | null | undefined, ask: number | null | undefined, fallback?: number | null): number | null {
  const b = finitePositive(bid) ? bid : null;
  const a = finitePositive(ask) ? ask : null;
  if (b != null && a != null && a >= b) return roundPrice((a + b) / 2);
  if (finitePositive(fallback)) return roundPrice(fallback);
  return null;
}

function emptySummary(status: PayoffSummary["status"], reason: string): PayoffSummary {
  return {
    status,
    reason,
    netPremium: 0,
    maxProfit: { kind: "unknown", reason },
    maxLoss: { kind: "unknown", reason },
    breakevens: [],
    payoffPoints: [],
    spotPrice: null,
    expiries: [],
    priceRange: { min: 0, max: 0 },
  };
}

function highSideSlope(legs: OptionStrategyLeg[]): number {
  return legs.reduce((sum, leg) => {
    if (leg.kind !== "call") return sum;
    return sum + (leg.side === "buy" ? 1 : -1) * leg.qty * CONTRACT_MULTIPLIER;
  }, 0);
}

function findBreakevens(legs: OptionStrategyLeg[], breakpoints: number[]): number[] {
  const roots: number[] = [];
  for (let i = 0; i < breakpoints.length - 1; i += 1) {
    const x1 = breakpoints[i];
    const x2 = breakpoints[i + 1];
    const y1 = payoffAtPrice(legs, x1);
    const y2 = payoffAtPrice(legs, x2);
    if (Math.abs(y1) < EPSILON) roots.push(x1);
    if (Math.abs(y2) < EPSILON) roots.push(x2);
    if ((y1 < 0 && y2 > 0) || (y1 > 0 && y2 < 0)) {
      const t = Math.abs(y1) / (Math.abs(y1) + Math.abs(y2));
      roots.push(x1 + (x2 - x1) * t);
    }
  }
  return uniqueNumbers(roots).sort((a, b) => a - b).map((n) => roundPrice(n));
}

function buildCurvePoints(legs: OptionStrategyLeg[], min: number, max: number, strikes: number[]): PayoffPoint[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const evenPoints = Array.from({ length: 81 }, (_, i) => min + ((max - min) * i) / 80);
  return uniqueNumbers([...evenPoints, ...strikes]).sort((a, b) => a - b).map((underlyingPrice) => ({
    underlyingPrice,
    pnl: payoffAtPrice(legs, underlyingPrice),
  }));
}

function uniqueNumbers(values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (!out.some((existing) => Math.abs(existing - value) < 0.005)) {
      out.push(value);
    }
  }
  return out;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}
