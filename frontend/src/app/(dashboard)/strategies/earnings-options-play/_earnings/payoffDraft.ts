import type { EarningsTopSetup, LadderRow, StrikeLadder } from "@/types";
import {
  optionLegFromLadderRow,
  type OptionStrategyDraft,
  type OptionStrategyLeg,
} from "@/lib/optionsPayoff";

export function buildEarningsStrategyDraft(
  symbol: string,
  ladder: StrikeLadder | null,
  setup: EarningsTopSetup | null | undefined,
): OptionStrategyDraft | null {
  if (!ladder || ladder.rows.length === 0) return null;
  const selected = setup ?? "long straddle";
  const rows = {
    atmCall: pickRow(ladder.rows, "call", "ATM"),
    atmPut: pickRow(ladder.rows, "put", "ATM"),
    farCall: pickRow(ladder.rows, "call", "30Δ"),
    farPut: pickRow(ladder.rows, "put", "30Δ"),
    wideCall: pickRow(ladder.rows, "call", "15Δ"),
    widePut: pickRow(ladder.rows, "put", "15Δ"),
  };
  const legs: Array<OptionStrategyLeg | null> = [];
  let comboType: string | null = null;

  switch (selected) {
    case "long call":
      legs.push(toLeg(rows.atmCall, symbol, ladder.expiry, "buy"));
      break;
    case "long put":
      legs.push(toLeg(rows.atmPut, symbol, ladder.expiry, "buy"));
      break;
    case "short call":
      legs.push(toLeg(rows.atmCall, symbol, ladder.expiry, "sell"));
      break;
    case "bull put spread":
      comboType = "bull_put_spread";
      legs.push(
        toLeg(rows.atmPut, symbol, ladder.expiry, "sell"),
        toLeg(rows.farPut, symbol, ladder.expiry, "buy"),
      );
      break;
    case "bear call spread":
      comboType = "bear_call_spread";
      legs.push(
        toLeg(rows.atmCall, symbol, ladder.expiry, "sell"),
        toLeg(rows.farCall, symbol, ladder.expiry, "buy"),
      );
      break;
    case "bull call spread":
      comboType = "bull_call_spread";
      legs.push(
        toLeg(rows.atmCall, symbol, ladder.expiry, "buy"),
        toLeg(rows.farCall, symbol, ladder.expiry, "sell"),
      );
      break;
    case "bear put spread":
      comboType = "bear_put_spread";
      legs.push(
        toLeg(rows.atmPut, symbol, ladder.expiry, "buy"),
        toLeg(rows.farPut, symbol, ladder.expiry, "sell"),
      );
      break;
    case "iron condor":
      comboType = "iron_condor";
      legs.push(
        toLeg(rows.farPut, symbol, ladder.expiry, "sell"),
        toLeg(rows.widePut, symbol, ladder.expiry, "buy"),
        toLeg(rows.farCall, symbol, ladder.expiry, "sell"),
        toLeg(rows.wideCall, symbol, ladder.expiry, "buy"),
      );
      break;
    case "iron butterfly":
      comboType = "iron_butterfly";
      legs.push(
        toLeg(rows.atmPut, symbol, ladder.expiry, "sell"),
        toLeg(rows.widePut, symbol, ladder.expiry, "buy"),
        toLeg(rows.atmCall, symbol, ladder.expiry, "sell"),
        toLeg(rows.wideCall, symbol, ladder.expiry, "buy"),
      );
      break;
    case "long straddle":
      comboType = "long_straddle";
      legs.push(
        toLeg(rows.atmCall, symbol, ladder.expiry, "buy"),
        toLeg(rows.atmPut, symbol, ladder.expiry, "buy"),
      );
      break;
    case "short strangle":
      comboType = "short_strangle";
      legs.push(
        toLeg(rows.farCall, symbol, ladder.expiry, "sell"),
        toLeg(rows.farPut, symbol, ladder.expiry, "sell"),
      );
      break;
    default:
      return null;
  }

  if (legs.some((leg) => leg == null || leg.entryPrice == null)) return null;
  return {
    underlying: symbol,
    spotPrice: ladder.underlyingPrice,
    label: selected,
    source: "earnings-options-play",
    quoteTimestamp: ladder.fetchedAt ?? null,
    comboType,
    legs: legs as OptionStrategyLeg[],
  };
}

function pickRow(rows: LadderRow[], side: "call" | "put", bucket: "ATM" | "30Δ" | "15Δ"): LadderRow | null {
  return rows.find((row) => row.side === side && row.bucket === bucket) ?? null;
}

function toLeg(
  row: LadderRow | null,
  symbol: string,
  expiry: string,
  side: "buy" | "sell",
): OptionStrategyLeg | null {
  if (!row) return null;
  return optionLegFromLadderRow({ row, underlying: symbol, expiry, side });
}
