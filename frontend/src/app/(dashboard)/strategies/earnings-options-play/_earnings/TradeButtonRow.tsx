import Link from "next/link";
import type {
  ComboFillForecast,
  EarningsReportState,
  EarningsTopSetup,
  StrikeLadder,
  LadderRow,
} from "@/types";
import { fmtNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type { OptionStrategyDraft } from "@/lib/optionsPayoff";
import { buildEarningsStrategyDraft } from "./payoffDraft";

/**
 * TradeButtonRow — earnings → /trade deep-link builder.
 *
 * Round-12 / DR-1 (P0): switched from naked-options buttons (short
 * call, short put, naked strangles) to DEFINED-RISK shapes only:
 *
 *   · Bull put spread   — bullish premium-selling, capped loss
 *   · Bear call spread  — bearish premium-selling, capped loss
 *   · Bull call spread  — bullish debit vertical, capped loss
 *   · Bear put spread   — bearish debit vertical, capped loss
 *   · Long call / put   — pure directional debit, capped loss
 *   · Iron condor       — non-directional premium-selling, capped both sides
 *   · Long straddle     — directional vol play, max loss = debit paid
 *
 * Spread widths are picked from the existing strike ladder — bucket
 * pairs (ATM, 30Δ, 15Δ) form the legs; each spread's max loss is
 * (width × 100) − net credit on a credit spread, or the debit on a
 * long straddle. This guarantees every button on this page maps to
 * a trade whose maximum loss is bounded.
 *
 * Canonical leg syntax (F-3):
 *   ?legs=OCC:side:qty[:limit][,OCC:side:qty[:limit]…]
 */

export interface TradeButtonRowProps {
  symbol: string;
  ladder: StrikeLadder | null;
  /**
   * Slice-6 / CH-3F (Tastytrade dynamic preview): emit the hovered
   * strategy's profit zone as ``[low, high]`` so the parent's
   * expected-move strip can render the green zone over the brown
   * 1σ band. ``null`` clears the overlay (mouse-leave).
   */
  onHoverStrategy?: (zone: [number, number] | null) => void;
  /** Emits the exact hovered trade shape for the shared payoff panel. */
  onHoverPayoffDraft?: (draft: OptionStrategyDraft | null) => void;
  /** Claude's recommended setup, used to visually prioritize one button. */
  recommendedSetup?: EarningsTopSetup | null;
  /** Earnings report state; reported/past events should not expose event-entry links. */
  reportState?: EarningsReportState;
  /** True when backend error_codes says the option chain came from demo/synthetic data. */
  syntheticChain?: boolean;
  /**
   * Wave V V5: pre-trade slippage forecast for the recommended setup.
   * When provided, renders the "Expected fill: $X.XX (range $Y - $Z)"
   * line beneath the trade buttons so the user sees the HONEST entry
   * cost — not just the theoretical mid. Null/undefined hides the line.
   */
  recommendedSetupFillForecast?: ComboFillForecast | null;
  /**
   * Wave V V5: net credit / debit (per share) of the recommended setup.
   * Used as the anchor for the slippage line — when present the FE
   * renders it above the forecast line as "Net credit $X.XX". Negative
   * = debit. ``null`` skips the credit/debit anchor.
   */
  recommendedNetCreditOrDebit?: number | null;
}

const STRATEGY_TAG = "earnings-options-play";

export default function TradeButtonRow({
  symbol,
  ladder,
  onHoverStrategy,
  onHoverPayoffDraft,
  recommendedSetup = null,
  reportState = "upcoming",
  syntheticChain = false,
  recommendedSetupFillForecast = null,
  recommendedNetCreditOrDebit = null,
}: TradeButtonRowProps) {
  // Round-7 / EP-6: validate the expiry shape BEFORE building any OCC
  // contract symbol. ``occSymbol`` slices ``YYYY-MM-DD`` at fixed offsets;
  // any other shape (stub responses, chain_demo synthetic rows, future
  // schema drift) silently produces a malformed OCC like ``NVDAC00205000``
  // that the broker rejects only at submit time, after the user already
  // navigated to /trade. Disable the buttons up-front with a clear empty-
  // state instead.
  const expiryValid =
    !!ladder && /^\d{4}-\d{2}-\d{2}$/.test(ladder.expiry);
  const rowExpiryMismatch = !!ladder && ladder.rows.some(
    (r) => r.expiry && r.expiry !== ladder.expiry,
  );
  const eventAlreadyPassed = reportState === "today_done" || reportState === "past";
  if (
    !ladder
    || ladder.rows.length === 0
    || !expiryValid
    || rowExpiryMismatch
    || ladder.isDemo === true
    || syntheticChain
    || eventAlreadyPassed
  ) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="t-mono text-label u-muted">
          {ladder?.isDemo === true || syntheticChain
            ? "— synthetic options chain, trade links disabled until live OPRA quotes are available."
            : eventAlreadyPassed
            ? "— earnings event already passed, event-entry trade links disabled."
            : rowExpiryMismatch
            ? "— option expiry mismatch, trade links disabled until the ladder refreshes."
            : ladder && !expiryValid
            ? "— expiry unavailable, trade buttons disabled."
            : "— options chain unavailable, trade buttons disabled."}
        </p>
      </div>
    );
  }
  const atmCall = pickRow(ladder.rows, "call", "ATM");
  const atmPut = pickRow(ladder.rows, "put", "ATM");
  const farCall = pickRow(ladder.rows, "call", "30Δ");
  const farPut = pickRow(ladder.rows, "put", "30Δ");
  const wideCall = pickRow(ladder.rows, "call", "15Δ");
  const widePut = pickRow(ladder.rows, "put", "15Δ");

  // Bull put spread = sell ATM put, buy 30Δ put as protection
  const bullPutSpread = atmPut && farPut ? { short: atmPut, long: farPut } : null;
  // Bear call spread = sell ATM call, buy 30Δ call as protection
  const bearCallSpread = atmCall && farCall ? { short: atmCall, long: farCall } : null;
  // Bull call spread = buy ATM call, sell 30Δ call against it
  const bullCallSpread = atmCall && farCall ? { long: atmCall, short: farCall } : null;
  // Bear put spread = buy ATM put, sell 30Δ put against it
  const bearPutSpread = atmPut && farPut ? { long: atmPut, short: farPut } : null;
  // Long call / put = pure directional debit, max loss = premium paid
  const longCall = atmCall;
  const longPut = atmPut;
  // Iron condor = bull put spread + bear call spread, all 4 legs at 30Δ/15Δ
  const ironCondor =
    farPut && widePut && farCall && wideCall
      ? { shortPut: farPut, longPut: widePut, shortCall: farCall, longCall: wideCall }
      : null;
  // Long straddle = buy ATM call + buy ATM put — direction-agnostic vol
  const longStraddle = atmCall && atmPut ? { call: atmCall, put: atmPut } : null;
  const quoteTs = ladder.fetchedAt ?? undefined;
  const previewEnter = (setup: EarningsTopSetup, zone: [number, number] | null = null) => {
    onHoverStrategy?.(zone);
    onHoverPayoffDraft?.(buildEarningsStrategyDraft(symbol, ladder, setup));
  };
  const previewLeave = () => {
    onHoverStrategy?.(null);
    onHoverPayoffDraft?.(null);
  };

  // Round-13 / RD-7 (P1): a narrow chain (only ATM rows; no 30Δ/15Δ
  // wing strikes) leaves every defined-risk button null. Pre-fix the
  // user saw an empty `<div>` with a top border — looked broken. Show
  // an explicit "narrow chain" message instead.
  const noButtonsAvailable =
    !bullPutSpread
    && !bearCallSpread
    && !bullCallSpread
    && !bearPutSpread
    && !longCall
    && !longPut
    && !ironCondor
    && !longStraddle;
  if (noButtonsAvailable) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="t-mono text-label u-muted">
          — Narrow chain: only ATM strikes available. Try a different expiry, a
          higher-volume symbol, or wait for 15Δ/30Δ wings to populate.
        </p>
      </div>
    );
  }

  // EOP-AUDIT 2026-05-06 / Bug 1 (flicker): per-button onMouseLeave
  // fired before the next button's onMouseEnter, briefly nulling the
  // preview draft and unmounting the chart between hovers. Hoist the
  // leave handler to the grid container; crossing button A→B no
  // longer triggers a leave at all because the cursor never exits
  // the grid. Per-button onMouseLeave/onBlur removed below.
  const handleGridBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) previewLeave();
  };

  return (
    <>
      {/* EOP-AUDIT 2026-05-06 PR-4: permanent (non-dismissible)
          risk-context surface. The site has a localStorage-gated
          intro card explaining that every trade caps max loss, but
          once dismissed the page has no persistent risk-warning
          surface — a user returning a week later sees no reminder
          that a "long straddle" trade is still bounded. This chip
          rides directly above the trade buttons so the assertion
          travels with the action it qualifies. */}
      <p
        data-slot="trade-button-row-risk-anchor"
        className="mt-4 rounded border border-[color:var(--brand)]/40 bg-[color:var(--brand-tint)] px-2 py-1 t-mono text-label u-brand"
      >
        ✓ Defined risk · every button below caps max loss at the displayed amount.
      </p>
      <div
        data-slot="trade-button-row"
        className="mt-2 grid grid-cols-1 gap-2 border-t border-[color:var(--border)] pt-3 sm:grid-cols-2 md:grid-cols-4"
        onMouseLeave={previewLeave}
        onBlur={handleGridBlur}
      >
      {bullPutSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bull-put-spread"
          setupKind="bull put spread"
          href={buildVerticalSpreadURL({
            symbol,
            short: bullPutSpread.short,
            long: bullPutSpread.long,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
            quoteTs,
          })}
          label={`Bull put spread ${fmtNumber(Math.round(bullPutSpread.long.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bullPutSpread.short.strike), { maximumFractionDigits: 0 })}p`}
          riskCopy={maxLossWidth(bullPutSpread.long.strike, bullPutSpread.short.strike, "credit")}
          recommended={recommendedSetup === "bull put spread"}
          // Slice-6 / CH-3F: bull put spread profits when the underlying
          // stays AT OR ABOVE the short put strike. Profit zone =
          // [short_put, +∞]. We cap at 2× short_put as a sensible
          // strip-extent so the green band has a visible right edge.
          onHoverEnter={() => previewEnter("bull put spread", [bullPutSpread.short.strike, bullPutSpread.short.strike * 2])}
        />
      )}
      {bearCallSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bear-call-spread"
          setupKind="bear call spread"
          href={buildVerticalSpreadURL({
            symbol,
            short: bearCallSpread.short,
            long: bearCallSpread.long,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
            quoteTs,
          })}
          label={`Bear call spread ${fmtNumber(Math.round(bearCallSpread.short.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bearCallSpread.long.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy={maxLossWidth(bearCallSpread.short.strike, bearCallSpread.long.strike, "credit")}
          recommended={recommendedSetup === "bear call spread"}
          // Slice-6 / CH-3F: bear call spread profits when the underlying
          // stays AT OR BELOW the short call strike. Profit zone =
          // [0, short_call]. Lower bound clamped to 0 (price can't go
          // negative).
          onHoverEnter={() => previewEnter("bear call spread", [0, bearCallSpread.short.strike])}
        />
      )}
      {bullCallSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bull-call-spread"
          setupKind="bull call spread"
          href={buildDebitVerticalSpreadURL({
            symbol,
            long: bullCallSpread.long,
            short: bullCallSpread.short,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
            quoteTs,
          })}
          label={`Bull call spread ${fmtNumber(Math.round(bullCallSpread.long.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bullCallSpread.short.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy={maxLossDebit(
            bullCallSpread.long.mid - bullCallSpread.short.mid,
            "Bull call spread",
          )}
          recommended={recommendedSetup === "bull call spread"}
          onHoverEnter={() => {
            const breakeven = bullCallSpread.long.strike + Math.max(0, bullCallSpread.long.mid - bullCallSpread.short.mid);
            previewEnter("bull call spread", [breakeven, breakeven * 2]);
          }}
        />
      )}
      {bearPutSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bear-put-spread"
          setupKind="bear put spread"
          href={buildDebitVerticalSpreadURL({
            symbol,
            long: bearPutSpread.long,
            short: bearPutSpread.short,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
            quoteTs,
          })}
          label={`Bear put spread ${fmtNumber(Math.round(bearPutSpread.long.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bearPutSpread.short.strike), { maximumFractionDigits: 0 })}p`}
          riskCopy={maxLossDebit(
            bearPutSpread.long.mid - bearPutSpread.short.mid,
            "Bear put spread",
          )}
          recommended={recommendedSetup === "bear put spread"}
          onHoverEnter={() => {
            const breakeven = bearPutSpread.long.strike - Math.max(0, bearPutSpread.long.mid - bearPutSpread.short.mid);
            previewEnter("bear put spread", [0, breakeven]);
          }}
        />
      )}
      {longCall && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-long-call"
          setupKind="long call"
          href={buildSingleLegURL({
            symbol,
            row: longCall,
            expiry: ladder.expiry,
            orderSide: "buy",
            quoteTs,
          })}
          label={`Long call ${fmtNumber(Math.round(longCall.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy={maxLossLongOption(longCall.mid, "Long call")}
          recommended={recommendedSetup === "long call"}
          onHoverEnter={() => {
            const breakeven = longCall.strike + Math.max(0, longCall.mid);
            previewEnter("long call", [breakeven, breakeven * 2]);
          }}
        />
      )}
      {longPut && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-long-put"
          setupKind="long put"
          href={buildSingleLegURL({
            symbol,
            row: longPut,
            expiry: ladder.expiry,
            orderSide: "buy",
            quoteTs,
          })}
          label={`Long put ${fmtNumber(Math.round(longPut.strike), { maximumFractionDigits: 0 })}p`}
          riskCopy={maxLossLongOption(longPut.mid, "Long put")}
          recommended={recommendedSetup === "long put"}
          onHoverEnter={() => previewEnter("long put", [0, longPut.strike - Math.max(0, longPut.mid)])}
        />
      )}
      {ironCondor && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-iron-condor"
          setupKind="iron condor"
          href={buildIronCondorURL({
            symbol,
            shortPut: ironCondor.shortPut,
            longPut: ironCondor.longPut,
            shortCall: ironCondor.shortCall,
            longCall: ironCondor.longCall,
            expiry: ladder.expiry,
            quoteTs,
          })}
          label={`Iron condor ${fmtNumber(Math.round(ironCondor.longPut.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(ironCondor.shortPut.strike), { maximumFractionDigits: 0 })}p · ${fmtNumber(Math.round(ironCondor.shortCall.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(ironCondor.longCall.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy={maxLossWidth(
            Math.max(
              ironCondor.shortPut.strike - ironCondor.longPut.strike,
              ironCondor.longCall.strike - ironCondor.shortCall.strike,
            ),
            0,
            "wing",
          )}
          recommended={recommendedSetup === "iron condor"}
          // Slice-6 / CH-3F: iron condor profits when the underlying
          // stays BETWEEN the short put and short call strikes. The
          // green zone is [short_put, short_call] — the canonical
          // "narrow expected move = profit" visual.
          onHoverEnter={() => previewEnter("iron condor", [
            ironCondor.shortPut.strike,
            ironCondor.shortCall.strike,
          ])}
        />
      )}
      {longStraddle && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-long-straddle"
          setupKind="long straddle"
          href={buildStraddleURL({
            symbol,
            call: longStraddle.call,
            put: longStraddle.put,
            expiry: ladder.expiry,
            quoteTs,
          })}
          label={`Long straddle ${fmtNumber(Math.round(longStraddle.call.strike), { maximumFractionDigits: 0 })}c/p`}
          riskCopy={`Long straddle · max loss = debit paid (≈ $${fmtNumber(Math.round((longStraddle.call.mid + longStraddle.put.mid) * 100), { maximumFractionDigits: 0 })}) · profits on a big move either way`}
          recommended={recommendedSetup === "long straddle"}
          // Slice-6 / CH-3F: long straddle profits OUTSIDE the breakevens.
          // The PnLZones primitive renders ONE profit zone — for a
          // straddle we'd need two (below lower BE, above upper BE).
          // Compromise: show the loss zone (between BEs) by passing
          // the *inverse* — our PnLZones default-loss-on-no-zone path
          // handles this OK. Caption explains. Pass null so the strip
          // surfaces only the brown expected-move band, which is the
          // most-honest visualization of "profitable iff move > 1σ".
          onHoverEnter={() => previewEnter("long straddle", null)}
        />
      )}
      </div>
      {recommendedSetupFillForecast ? (
        <FillForecastLine
          forecast={recommendedSetupFillForecast}
          netCreditOrDebit={recommendedNetCreditOrDebit}
        />
      ) : null}
    </>
  );
}

/**
 * Wave V V5 — render the pre-trade slippage forecast beneath the
 * recommended trade buttons.
 *
 * Output:
 *   Net credit $6.62
 *   Expected fill: $6.40 (range $6.25-$6.55) · ~$22 slippage (low confidence)
 *
 * Color coding on the slippage figure:
 *   < $5    → green  (negligible drag)
 *   $5-$25  → amber  (typical)
 *   > $25   → red    (heavy slippage; treat with care)
 */
function FillForecastLine({
  forecast,
  netCreditOrDebit,
}: {
  forecast: ComboFillForecast;
  netCreditOrDebit: number | null;
}) {
  const slippage = forecast.expectedSlippageDollars;
  const slippageColor =
    slippage > 25 ? "u-loss" : slippage > 5 ? "u-warn" : "u-profit";
  // Credit combo (target_mid > 0) → "Net credit $X.XX"; debit (< 0) →
  // "Net debit $X.XX". The label uses the recommended setup's actual
  // net (not the forecast's target_mid) so the headline price matches
  // what the recommender chose to surface elsewhere; range/expected
  // come from the forecast.
  const isCredit = (netCreditOrDebit ?? 0) >= 0;
  const netLabel = netCreditOrDebit === null
    ? null
    : `Net ${isCredit ? "credit" : "debit"} $${fmtNumber(Math.abs(netCreditOrDebit), { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  // For UI display, show the absolute value of the fill so credit and
  // debit combos read naturally. Range bracket: lower = farther from
  // mid (worse), upper = closer to mid (better).
  const expectedAbs = Math.abs(forecast.expectedFill);
  const lowAbs = Math.min(Math.abs(forecast.p10Fill), Math.abs(forecast.p90Fill));
  const highAbs = Math.max(Math.abs(forecast.p10Fill), Math.abs(forecast.p90Fill));
  return (
    <div
      data-slot="trade-button-fill-forecast"
      className="mt-2 rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-2 py-1.5 t-mono text-label"
    >
      {netLabel ? (
        <div data-slot="fill-forecast-net" className="u-default">
          {netLabel}
        </div>
      ) : null}
      <div data-slot="fill-forecast-expected">
        Expected fill: ${fmtNumber(expectedAbs, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
        {" "}(range ${fmtNumber(lowAbs, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
        –${fmtNumber(highAbs, { maximumFractionDigits: 2, minimumFractionDigits: 2 })})
        {" · "}
        <span data-slot="fill-forecast-slippage" className={slippageColor}>
          ~${fmtNumber(slippage, { maximumFractionDigits: 0 })} slippage
        </span>
        {forecast.confidence === "low" ? (
          <span data-slot="fill-forecast-low-confidence" className="u-muted">
            {" "}(low confidence — illiquid chain)
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Round-12 / DR-1: every button on this row links to a DEFINED-RISK
 * combo. The pill label is "Defined risk" instead of the prior
 * "Undefined risk" warning.
 *
 * EOP-AUDIT 2026-05-06 / B1.11: when ``recommended`` is set the card
 * gets a 2px border (was 1px), a brand-tint background, AND a
 * "🎯 RECOMMENDED" badge pinned to the top-right corner so it stands
 * out from the row of otherwise-identical defined-risk cards.
 *
 * EOP-AUDIT 2026-05-06 / B1.15: the "✓ DEFINED RISK" pill used to
 * read identically on every card, even though long straddles /
 * strangles / single-leg long calls/puts have ASYMMETRIC payoff
 * (defined LOSS, unbounded UPSIDE). Naked shorts (currently not
 * surfaced from this row but kept for forward-compat) read
 * "UNDEFINED RISK". Caller passes a ``setupKind`` discriminator and
 * we render the right pill.
 */
type RiskShape =
  | "defined_risk" // bull/bear vertical credit + iron condor + butterflies → ✓ DEFINED RISK
  | "defined_loss_unbounded_upside" // long straddle / long strangle / long call / long put → ✓ DEFINED LOSS · ∞ UPSIDE
  | "naked_short"; // short_strangle / short_straddle / naked calls/puts → ⚠ UNDEFINED RISK · NAKED SHORT

function riskShapeFor(setup: EarningsTopSetup | string | null | undefined): RiskShape {
  switch (setup) {
    case "long straddle":
    case "long strangle":
    case "long call":
    case "long put":
      return "defined_loss_unbounded_upside";
    case "short strangle":
    case "short straddle":
    case "short call":
    case "short put":
      return "naked_short";
    default:
      // bull put spread / bear call spread / bull call spread /
      // bear put spread / iron condor / iron butterfly / vertical
      // spreads → standard defined risk.
      return "defined_risk";
  }
}

function riskShapeCopy(shape: RiskShape, recommended: boolean): string {
  if (shape === "naked_short") {
    return "⚠ UNDEFINED RISK · NAKED SHORT";
  }
  if (shape === "defined_loss_unbounded_upside") {
    return recommended
      ? "✓ Suggested · defined loss · ∞ upside"
      : "✓ Defined loss · ∞ upside";
  }
  return recommended ? "✓ Suggested · defined risk" : "✓ Defined risk";
}

function DefinedRiskTradeLink({
  dataSlot,
  href,
  label,
  riskCopy,
  recommended = false,
  setupKind,
  onHoverEnter,
}: {
  dataSlot: string;
  href: string;
  label: string;
  riskCopy: string;
  recommended?: boolean;
  /** Drives the per-card risk-pill copy (B1.15). */
  setupKind?: EarningsTopSetup | string | null;
  // Slice-6 / CH-3F: hover handlers feed the parent's profit-zone
  // overlay. Optional so the component still works in a standalone
  // context where no overlay is mounted. EOP-AUDIT 2026-05-06 Bug 1:
  // leave/blur handlers are owned by the grid container so crossing
  // A→B doesn't briefly null the draft and unmount the chart.
  onHoverEnter?: () => void;
}) {
  const riskShape = riskShapeFor(setupKind);
  const pillCopy = riskShapeCopy(riskShape, recommended);
  const pillTone =
    riskShape === "naked_short" ? "u-loss" : "u-profit";
  return (
    <Link
      data-slot={dataSlot}
      data-recommended={recommended || undefined}
      data-risk-shape={riskShape}
      href={href}
      title={riskCopy}
      aria-describedby={`${dataSlot}-risk ${dataSlot}-risk-copy`}
      onMouseEnter={onHoverEnter}
      onFocus={onHoverEnter}
      className={cn(
        "group relative min-h-touch rounded px-3 py-2 t-mono text-label flex flex-col items-center justify-center gap-0.5",
        // EOP-AUDIT 2026-05-06 / B1.11: 2px border + brand tint when
        // recommended; 1px default border otherwise. Hover always
        // upgrades the border to brand for affordance.
        recommended
          ? "border-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] shadow-[0_0_0_1px_var(--brand)]"
          : "border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] hover:border-[color:var(--brand)]",
      )}
    >
      {recommended ? (
        <span
          data-slot="trade-button-recommended-badge"
          aria-hidden="true"
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-pill bg-[color:var(--brand)] px-1.5 py-0.5 text-eyebrow font-semibold uppercase tracking-[0.08em] text-[color:var(--brand-fg,white)]"
        >
          <span>🎯</span>
          <span>RECOMMENDED</span>
        </span>
      ) : null}
      <span className="u-brand inline-flex items-center gap-1.5">
        <span aria-hidden="true">▸</span>
        {label}
      </span>
      <span
        id={`${dataSlot}-risk`}
        className={cn(
          "text-label uppercase tracking-wider",
          pillTone,
        )}
      >
        {pillCopy}
      </span>
      <span id={`${dataSlot}-risk-copy`} className="sr-only">
        {riskCopy}
      </span>
    </Link>
  );
}

function pickRow(rows: LadderRow[], side: "call" | "put", bucket: "ATM" | "30Δ" | "15Δ"): LadderRow | null {
  return rows.find((r) => r.side === side && r.bucket === bucket) ?? null;
}

function maxLossWidth(a: number, b: number, kind: "credit" | "wing"): string {
  const widthDollars = Math.abs(a - b);
  if (kind === "wing") {
    return `Iron condor · max loss = wing width × 100 ≈ $${fmtNumber(Math.round(widthDollars * 100), { maximumFractionDigits: 0 })} per contract minus net credit`;
  }
  return `Vertical spread · max loss = ($${fmtNumber(widthDollars, { maximumFractionDigits: 2 })} width × 100) − net credit per contract`;
}

function maxLossDebit(netDebit: number, label: string): string {
  const debitDollars = Math.max(0, netDebit) * 100;
  return `${label} · max loss = net debit paid (≈ $${fmtNumber(Math.round(debitDollars), { maximumFractionDigits: 0 })}) per contract`;
}

function maxLossLongOption(mid: number, label: string): string {
  const debitDollars = Math.max(0, mid) * 100;
  return `${label} · max loss = premium paid (≈ $${fmtNumber(Math.round(debitDollars), { maximumFractionDigits: 0 })}) per contract`;
}

/**
 * OCC contract symbol: SYMBOL + YYMMDD + C|P + strike*1000 padded 8 digits.
 * E.g. NVDA 2026-04-25 $205 call = NVDA260425C00205000.
 *
 * Round-7 / EP-6: callers must validate ``expiry`` matches
 * ``YYYY-MM-DD`` before passing it (see ``TradeButtonRow`` early
 * return). The slice indexing produces silently-corrupt symbols on
 * any other shape; we still defend in depth here by rejecting a
 * non-finite strike, which would otherwise stringify to
 * ``"00000NaN"`` and ride through the URL builder undetected.
 */
function occRoot(symbol: string): string {
  const root = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!root || root.length > 6) {
    throw new Error(`occSymbol: invalid root ${symbol}`);
  }
  return root;
}

function occSymbol(symbol: string, expiry: string, side: "call" | "put", strike: number): string {
  if (!Number.isFinite(strike) || strike <= 0) {
    throw new Error(`occSymbol: invalid strike ${strike}`);
  }
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const side_char = side === "call" ? "C" : "P";
  const strike_padded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${occRoot(symbol)}${yymmdd}${side_char}${strike_padded}`;
}

function fmtMid(mid: number): string {
  // 2-decimal price truncation keeps the URL short and aligned with how
  // option prices quote on US exchanges. 0 stays 0 (parser distinguishes
  // missing from explicit 0).
  if (!Number.isFinite(mid) || mid <= 0) return "";
  return mid.toFixed(2);
}

function addQuoteSnapshotParam(params: URLSearchParams, quoteTs?: string | null): void {
  if (!quoteTs) return;
  const parsed = Date.parse(quoteTs);
  if (Number.isNaN(parsed)) return;
  params.set("quote_ts", quoteTs);
}

export function buildSingleLegURL(opts: {
  symbol: string;
  row: LadderRow;
  expiry: string;
  orderSide?: "buy" | "sell";
  quoteTs?: string | null;
}): string {
  const contract = occSymbol(opts.symbol, opts.expiry, opts.row.side, opts.row.strike);
  const orderSide = opts.orderSide ?? "sell";
  const params = new URLSearchParams({
    symbol: opts.symbol,
    contract,
    side: orderSide,
    qty: "1",
    strategy: STRATEGY_TAG,
  });
  const lim = fmtMid(opts.row.mid);
  if (lim) params.set("limit", lim);
  addQuoteSnapshotParam(params, opts.quoteTs);
  return `/trade?${params.toString()}`;
}

/**
 * Round-12 / DR-1: build a DEFINED-RISK vertical spread (bull put or
 * bear call) — sell the closer-to-money leg, buy the further-from-money
 * leg as protection. Max loss is capped at (width × 100) − net credit.
 */
export function buildVerticalSpreadURL(opts: {
  symbol: string;
  short: LadderRow;
  long: LadderRow;
  expiry: string;
  comboType: "vertical_spread";
  quoteTs?: string | null;
}): string {
  const shortContract = occSymbol(opts.symbol, opts.expiry, opts.short.side, opts.short.strike);
  const longContract = occSymbol(opts.symbol, opts.expiry, opts.long.side, opts.long.strike);
  const shortLim = fmtMid(opts.short.mid);
  const longLim = fmtMid(opts.long.mid);
  const shortLeg = shortLim ? `${shortContract}:sell:1:${shortLim}` : `${shortContract}:sell:1`;
  const longLeg = longLim ? `${longContract}:buy:1:${longLim}` : `${longContract}:buy:1`;
  const legs = `${shortLeg},${longLeg}`;
  const params = new URLSearchParams({
    symbol: opts.symbol,
    legs,
    strategy: STRATEGY_TAG,
    combo_type: opts.comboType,
  });
  addQuoteSnapshotParam(params, opts.quoteTs);
  return `/trade?${params.toString()}`;
}

/**
 * Defined-risk debit vertical: buy the closer-to-money leg and sell the
 * further OTM leg. Max loss is the net debit paid.
 */
export function buildDebitVerticalSpreadURL(opts: {
  symbol: string;
  long: LadderRow;
  short: LadderRow;
  expiry: string;
  comboType: "vertical_spread";
  quoteTs?: string | null;
}): string {
  const longContract = occSymbol(opts.symbol, opts.expiry, opts.long.side, opts.long.strike);
  const shortContract = occSymbol(opts.symbol, opts.expiry, opts.short.side, opts.short.strike);
  const longLim = fmtMid(opts.long.mid);
  const shortLim = fmtMid(opts.short.mid);
  const longLeg = longLim ? `${longContract}:buy:1:${longLim}` : `${longContract}:buy:1`;
  const shortLeg = shortLim ? `${shortContract}:sell:1:${shortLim}` : `${shortContract}:sell:1`;
  const legs = `${longLeg},${shortLeg}`;
  const params = new URLSearchParams({
    symbol: opts.symbol,
    legs,
    strategy: STRATEGY_TAG,
    combo_type: opts.comboType,
  });
  addQuoteSnapshotParam(params, opts.quoteTs);
  return `/trade?${params.toString()}`;
}

/**
 * Round-12 / DR-1: build a DEFINED-RISK iron condor — bull put spread
 * + bear call spread, each side capped by its protective wing.
 */
export function buildIronCondorURL(opts: {
  symbol: string;
  shortPut: LadderRow;
  longPut: LadderRow;
  shortCall: LadderRow;
  longCall: LadderRow;
  expiry: string;
  quoteTs?: string | null;
}): string {
  const sP = occSymbol(opts.symbol, opts.expiry, "put", opts.shortPut.strike);
  const lP = occSymbol(opts.symbol, opts.expiry, "put", opts.longPut.strike);
  const sC = occSymbol(opts.symbol, opts.expiry, "call", opts.shortCall.strike);
  const lC = occSymbol(opts.symbol, opts.expiry, "call", opts.longCall.strike);
  const legs = [
    fmtMid(opts.shortPut.mid)
      ? `${sP}:sell:1:${fmtMid(opts.shortPut.mid)}`
      : `${sP}:sell:1`,
    fmtMid(opts.longPut.mid) ? `${lP}:buy:1:${fmtMid(opts.longPut.mid)}` : `${lP}:buy:1`,
    fmtMid(opts.shortCall.mid)
      ? `${sC}:sell:1:${fmtMid(opts.shortCall.mid)}`
      : `${sC}:sell:1`,
    fmtMid(opts.longCall.mid)
      ? `${lC}:buy:1:${fmtMid(opts.longCall.mid)}`
      : `${lC}:buy:1`,
  ].join(",");
  const params = new URLSearchParams({
    symbol: opts.symbol,
    legs,
    strategy: STRATEGY_TAG,
    combo_type: "iron_condor",
  });
  addQuoteSnapshotParam(params, opts.quoteTs);
  return `/trade?${params.toString()}`;
}

/**
 * Round-12 / DR-1: build a DEFINED-RISK long straddle — buy ATM call +
 * buy ATM put. Max loss is the total debit paid; profits on a big move
 * in either direction. Replaces the old naked short-strangle button.
 */
export function buildStraddleURL(opts: {
  symbol: string;
  call: LadderRow;
  put: LadderRow;
  expiry: string;
  quoteTs?: string | null;
}): string {
  const callContract = occSymbol(opts.symbol, opts.expiry, "call", opts.call.strike);
  const putContract = occSymbol(opts.symbol, opts.expiry, "put", opts.put.strike);
  const callLim = fmtMid(opts.call.mid);
  const putLim = fmtMid(opts.put.mid);
  const callLeg = callLim ? `${callContract}:buy:1:${callLim}` : `${callContract}:buy:1`;
  const putLeg = putLim ? `${putContract}:buy:1:${putLim}` : `${putContract}:buy:1`;
  const legs = `${callLeg},${putLeg}`;
  const params = new URLSearchParams({
    symbol: opts.symbol,
    legs,
    strategy: STRATEGY_TAG,
    // Long straddle isn't in the backend's combo_type allowlist (it's a
    // two-leg debit position, not a credit combo) — so omit combo_type
    // and let the per-leg notional path price it. Net debit = max loss.
  });
  addQuoteSnapshotParam(params, opts.quoteTs);
  return `/trade?${params.toString()}`;
}
