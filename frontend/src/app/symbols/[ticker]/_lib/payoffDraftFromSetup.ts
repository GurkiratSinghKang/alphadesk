import type { EarningsSetup, EarningsSetupLeg } from "@/types";
import type { OptionStrategyDraft, OptionStrategyLeg } from "@/lib/optionsPayoff";
import { formatOccSymbol } from "@/lib/occ";

// T8 / Section 7: convert a recommender ``EarningsSetup`` (wire shape from
// ``/api/v1/earnings/{symbol}/analysis``) into the existing
// ``OptionStrategyDraft`` shape consumed by ``OptionsPayoffPanel``. The
// recommender's ``setup_id`` covers 14 known shapes plus ``"skip"``; we
// map the kind → comboType so the payoff panel's caption + chart styling
// pick the right preset, and we project each leg's ``mid`` price into
// ``entryPrice``. ``"skip"`` and any unrecognised setup_id return null —
// the caller renders the card without a payoff panel rather than crashing.
//
// Why a new adapter (vs. re-using the EOP ``buildEarningsStrategyDraft``):
// the EOP variant takes a ``StrikeLadder`` + ``EarningsTopSetup`` string
// and builds legs by picking ATM/30Δ/15Δ rows from the ladder. The
// symbol-page recommender already returns concrete legs (strike + expiry +
// mid per leg), so there's no ladder to consult — we project the wire legs
// directly. Re-using the EOP version would require a synthetic ladder.
const SUPPORTED_SETUP_KINDS = new Set<string>([
  "iron_condor",
  "iron_butterfly",
  "short_strangle",
  "short_straddle",
  "bear_call_spread",
  "bull_put_spread",
  "bull_call_spread",
  "bear_put_spread",
  "long_call",
  "long_put",
  "long_straddle",
  "long_strangle",
  "calendar_spread",
  "diagonal_spread",
]);

export function payoffDraftFromSetup(
  setup: EarningsSetup,
  underlying: string,
  spotPrice: number | null = null,
): OptionStrategyDraft | null {
  if (!setup || !Array.isArray(setup.legs) || setup.legs.length === 0) {
    return null;
  }
  if (!SUPPORTED_SETUP_KINDS.has(setup.setupId)) {
    return null;
  }
  const legs: OptionStrategyLeg[] = [];
  for (const wireLeg of setup.legs) {
    const leg = toOptionStrategyLeg(wireLeg, underlying);
    if (leg === null) return null;
    legs.push(leg);
  }
  return {
    underlying,
    spotPrice,
    label: humanLabelFromSetupId(setup.setupId),
    source: "earnings-options-play",
    quoteTimestamp: null,
    comboType: setup.setupId,
    legs,
  };
}

function toOptionStrategyLeg(
  wireLeg: EarningsSetupLeg,
  underlying: string,
): OptionStrategyLeg | null {
  if (
    !Number.isFinite(wireLeg.strike)
    || wireLeg.strike <= 0
    || !Number.isInteger(wireLeg.qty)
    || wireLeg.qty <= 0
    || !Number.isFinite(wireLeg.mid)
    || wireLeg.mid < 0
  ) {
    return null;
  }
  const occSymbol = formatOccSymbol({
    symbol: underlying,
    expiry: wireLeg.expiry,
    side: wireLeg.contractType,
    strike: wireLeg.strike,
  });
  if (!occSymbol) return null;
  return {
    id: `${occSymbol}:${wireLeg.side}`,
    occSymbol,
    underlying,
    expiry: wireLeg.expiry,
    kind: wireLeg.contractType,
    strike: wireLeg.strike,
    side: wireLeg.side,
    qty: wireLeg.qty,
    entryPrice: wireLeg.mid,
    mid: wireLeg.mid,
  };
}

function humanLabelFromSetupId(setupId: string): string {
  return setupId.replace(/_/g, " ");
}
