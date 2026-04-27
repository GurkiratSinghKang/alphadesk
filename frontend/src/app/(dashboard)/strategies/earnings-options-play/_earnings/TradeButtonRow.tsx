import Link from "next/link";
import type { StrikeLadder, LadderRow } from "@/types";
import { fmtNumber } from "@/lib/intl";

/**
 * TradeButtonRow — earnings → /trade deep-link builder.
 *
 * Round-12 / DR-1 (P0): switched from naked-options buttons (short
 * call, short put, naked strangles) to DEFINED-RISK shapes only:
 *
 *   · Bull put spread   — bullish premium-selling, capped loss
 *   · Bear call spread  — bearish premium-selling, capped loss
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
}

const STRATEGY_TAG = "earnings-options-play";

export default function TradeButtonRow({ symbol, ladder, onHoverStrategy }: TradeButtonRowProps) {
  // Round-7 / EP-6: validate the expiry shape BEFORE building any OCC
  // contract symbol. ``occSymbol`` slices ``YYYY-MM-DD`` at fixed offsets;
  // any other shape (stub responses, chain_demo synthetic rows, future
  // schema drift) silently produces a malformed OCC like ``NVDAC00205000``
  // that the broker rejects only at submit time, after the user already
  // navigated to /trade. Disable the buttons up-front with a clear empty-
  // state instead.
  const expiryValid =
    !!ladder && /^\d{4}-\d{2}-\d{2}$/.test(ladder.expiry);
  if (!ladder || ladder.rows.length === 0 || !expiryValid) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="t-mono text-[12px] u-muted">
          {ladder && !expiryValid
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
  // Iron condor = bull put spread + bear call spread, all 4 legs at 30Δ/15Δ
  const ironCondor =
    farPut && widePut && farCall && wideCall
      ? { shortPut: farPut, longPut: widePut, shortCall: farCall, longCall: wideCall }
      : null;
  // Long straddle = buy ATM call + buy ATM put — direction-agnostic vol
  const longStraddle = atmCall && atmPut ? { call: atmCall, put: atmPut } : null;

  // Round-13 / RD-7 (P1): a narrow chain (only ATM rows; no 30Δ/15Δ
  // wing strikes) leaves every defined-risk button null. Pre-fix the
  // user saw an empty `<div>` with a top border — looked broken. Show
  // an explicit "narrow chain" message instead.
  const noButtonsAvailable =
    !bullPutSpread && !bearCallSpread && !ironCondor && !longStraddle;
  if (noButtonsAvailable) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="t-mono text-[12px] u-muted">
          — Narrow chain: only ATM strikes available. Try a different expiry, a
          higher-volume symbol, or wait for 15Δ/30Δ wings to populate.
        </p>
      </div>
    );
  }

  return (
    <div
      data-slot="trade-button-row"
      className="mt-4 grid grid-cols-1 gap-2 border-t border-[color:var(--border)] pt-3 sm:grid-cols-2 md:grid-cols-4"
    >
      {bullPutSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bull-put-spread"
          href={buildVerticalSpreadURL({
            symbol,
            short: bullPutSpread.short,
            long: bullPutSpread.long,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
          })}
          label={`Bull put spread ${fmtNumber(Math.round(bullPutSpread.long.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bullPutSpread.short.strike), { maximumFractionDigits: 0 })}p`}
          riskCopy={maxLossWidth(bullPutSpread.long.strike, bullPutSpread.short.strike, "credit")}
          // Slice-6 / CH-3F: bull put spread profits when the underlying
          // stays AT OR ABOVE the short put strike. Profit zone =
          // [short_put, +∞]. We cap at 2× short_put as a sensible
          // strip-extent so the green band has a visible right edge.
          onHoverEnter={() =>
            onHoverStrategy?.([bullPutSpread.short.strike, bullPutSpread.short.strike * 2])
          }
          onHoverLeave={() => onHoverStrategy?.(null)}
        />
      )}
      {bearCallSpread && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-bear-call-spread"
          href={buildVerticalSpreadURL({
            symbol,
            short: bearCallSpread.short,
            long: bearCallSpread.long,
            expiry: ladder.expiry,
            comboType: "vertical_spread",
          })}
          label={`Bear call spread ${fmtNumber(Math.round(bearCallSpread.short.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(bearCallSpread.long.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy={maxLossWidth(bearCallSpread.short.strike, bearCallSpread.long.strike, "credit")}
          // Slice-6 / CH-3F: bear call spread profits when the underlying
          // stays AT OR BELOW the short call strike. Profit zone =
          // [0, short_call]. Lower bound clamped to 0 (price can't go
          // negative).
          onHoverEnter={() =>
            onHoverStrategy?.([0, bearCallSpread.short.strike])
          }
          onHoverLeave={() => onHoverStrategy?.(null)}
        />
      )}
      {ironCondor && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-iron-condor"
          href={buildIronCondorURL({
            symbol,
            shortPut: ironCondor.shortPut,
            longPut: ironCondor.longPut,
            shortCall: ironCondor.shortCall,
            longCall: ironCondor.longCall,
            expiry: ladder.expiry,
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
          // Slice-6 / CH-3F: iron condor profits when the underlying
          // stays BETWEEN the short put and short call strikes. The
          // green zone is [short_put, short_call] — the canonical
          // "narrow expected move = profit" visual.
          onHoverEnter={() =>
            onHoverStrategy?.([
              ironCondor.shortPut.strike,
              ironCondor.shortCall.strike,
            ])
          }
          onHoverLeave={() => onHoverStrategy?.(null)}
        />
      )}
      {longStraddle && (
        <DefinedRiskTradeLink
          dataSlot="trade-button-long-straddle"
          href={buildStraddleURL({
            symbol,
            call: longStraddle.call,
            put: longStraddle.put,
            expiry: ladder.expiry,
          })}
          label={`Long straddle ${fmtNumber(Math.round(longStraddle.call.strike), { maximumFractionDigits: 0 })}c/p`}
          riskCopy={`Long straddle · max loss = debit paid (≈ $${fmtNumber(Math.round((longStraddle.call.mid + longStraddle.put.mid) * 100), { maximumFractionDigits: 0 })}) · profits on a big move either way`}
          // Slice-6 / CH-3F: long straddle profits OUTSIDE the breakevens.
          // The PnLZones primitive renders ONE profit zone — for a
          // straddle we'd need two (below lower BE, above upper BE).
          // Compromise: show the loss zone (between BEs) by passing
          // the *inverse* — our PnLZones default-loss-on-no-zone path
          // handles this OK. Caption explains. Pass null so the strip
          // surfaces only the brown expected-move band, which is the
          // most-honest visualization of "profitable iff move > 1σ".
          onHoverEnter={() => onHoverStrategy?.(null)}
          onHoverLeave={() => onHoverStrategy?.(null)}
        />
      )}
    </div>
  );
}

/**
 * Round-12 / DR-1: every button on this row links to a DEFINED-RISK
 * combo. The pill label is "Defined risk" instead of the prior
 * "Undefined risk" warning.
 */
function DefinedRiskTradeLink({
  dataSlot,
  href,
  label,
  riskCopy,
  onHoverEnter,
  onHoverLeave,
}: {
  dataSlot: string;
  href: string;
  label: string;
  riskCopy: string;
  // Slice-6 / CH-3F: hover handlers feed the parent's profit-zone
  // overlay. Optional so the component still works in a standalone
  // context where no overlay is mounted.
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}) {
  return (
    <Link
      data-slot={dataSlot}
      href={href}
      title={riskCopy}
      aria-describedby={`${dataSlot}-risk`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onFocus={onHoverEnter}
      onBlur={onHoverLeave}
      className="group min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 t-mono text-[12px] flex flex-col items-center justify-center gap-0.5 hover:border-[color:var(--brand)]"
    >
      <span className="u-brand inline-flex items-center gap-1.5">
        <span aria-hidden="true">▸</span>
        {label}
      </span>
      <span
        id={`${dataSlot}-risk`}
        className="text-[9.5px] uppercase tracking-wider u-profit"
      >
        ✓ Defined risk
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
function occSymbol(symbol: string, expiry: string, side: "call" | "put", strike: number): string {
  if (!Number.isFinite(strike) || strike <= 0) {
    throw new Error(`occSymbol: invalid strike ${strike}`);
  }
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const side_char = side === "call" ? "C" : "P";
  const strike_padded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${symbol}${yymmdd}${side_char}${strike_padded}`;
}

function fmtMid(mid: number): string {
  // 2-decimal price truncation keeps the URL short and aligned with how
  // option prices quote on US exchanges. 0 stays 0 (parser distinguishes
  // missing from explicit 0).
  if (!Number.isFinite(mid) || mid <= 0) return "";
  return mid.toFixed(2);
}

export function buildSingleLegURL(opts: { symbol: string; row: LadderRow; expiry: string }): string {
  const contract = occSymbol(opts.symbol, opts.expiry, opts.row.side, opts.row.strike);
  const params = new URLSearchParams({
    symbol: opts.symbol,
    contract,
    side: "sell",
    qty: "1",
    strategy: STRATEGY_TAG,
  });
  const lim = fmtMid(opts.row.mid);
  if (lim) params.set("limit", lim);
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
  return `/trade?${params.toString()}`;
}
