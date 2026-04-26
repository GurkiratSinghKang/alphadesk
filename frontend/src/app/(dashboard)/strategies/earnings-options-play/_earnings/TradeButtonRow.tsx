import Link from "next/link";
import type { StrikeLadder, LadderRow } from "@/types";
import { fmtNumber } from "@/lib/intl";

/**
 * TradeButtonRow — earnings → /trade deep-link builder.
 *
 * Round-5 F-1, F-3: every link now includes:
 *   · `strategy=earnings-options-play`  — flows through to placeOrder so
 *      reports/strategy-performance attributes the trade correctly.
 *   · `limit` price (= row.mid)        — encoded into the leg syntax so
 *      the OrderBar pre-fills with a sane mid quote rather than blank.
 *
 * Canonical leg syntax (F-3):
 *   ?legs=OCC:side:qty[:limit][,OCC:side:qty[:limit]…]
 *
 * Old 3-field tuples (`OCC:side:qty`) keep parsing — `limit` is optional.
 */

export interface TradeButtonRowProps {
  symbol: string;
  ladder: StrikeLadder | null;
}

const STRATEGY_TAG = "earnings-options-play";

export default function TradeButtonRow({ symbol, ladder }: TradeButtonRowProps) {
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

  return (
    <div
      data-slot="trade-button-row"
      className="mt-4 grid grid-cols-1 gap-2 border-t border-[color:var(--border)] pt-3 md:grid-cols-3"
    >
      {atmCall && (
        <Link
          data-slot="trade-button-short-call"
          href={buildSingleLegURL({ symbol, row: atmCall, expiry: ladder.expiry })}
          className="min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-center t-mono text-[12px] u-brand flex items-center justify-center hover:border-[color:var(--brand)]"
        >
          ▸ Short call {fmtNumber(Math.round(atmCall.strike), { maximumFractionDigits: 0 })}c
        </Link>
      )}
      {atmPut && (
        <Link
          data-slot="trade-button-short-put"
          href={buildSingleLegURL({ symbol, row: atmPut, expiry: ladder.expiry })}
          className="min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-center t-mono text-[12px] u-brand flex items-center justify-center hover:border-[color:var(--brand)]"
        >
          ▸ Short put {fmtNumber(Math.round(atmPut.strike), { maximumFractionDigits: 0 })}p
        </Link>
      )}
      {farPut && farCall && (
        <Link
          data-slot="trade-button-strangle"
          href={buildStrangleURL({ symbol, put: farPut, call: farCall, expiry: ladder.expiry })}
          className="min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-center t-mono text-[12px] u-brand flex items-center justify-center hover:border-[color:var(--brand)]"
        >
          ▸ Sell strangle {fmtNumber(Math.round(farPut.strike), { maximumFractionDigits: 0 })}/{fmtNumber(Math.round(farCall.strike), { maximumFractionDigits: 0 })}
        </Link>
      )}
    </div>
  );
}

function pickRow(rows: LadderRow[], side: "call" | "put", bucket: "ATM" | "30Δ" | "15Δ"): LadderRow | null {
  return rows.find((r) => r.side === side && r.bucket === bucket) ?? null;
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

export function buildStrangleURL(opts: {
  symbol: string;
  put: LadderRow;
  call: LadderRow;
  expiry: string;
}): string {
  const putContract = occSymbol(opts.symbol, opts.expiry, "put", opts.put.strike);
  const callContract = occSymbol(opts.symbol, opts.expiry, "call", opts.call.strike);
  const putLim = fmtMid(opts.put.mid);
  const callLim = fmtMid(opts.call.mid);
  // Canonical leg syntax: OCC:side:qty[:limit] — limit is optional.
  const putLeg = putLim ? `${putContract}:sell:1:${putLim}` : `${putContract}:sell:1`;
  const callLeg = callLim ? `${callContract}:sell:1:${callLim}` : `${callContract}:sell:1`;
  const legs = `${putLeg},${callLeg}`;
  const params = new URLSearchParams({
    symbol: opts.symbol,
    legs,
    strategy: STRATEGY_TAG,
    combo_type: "strangle",
  });
  return `/trade?${params.toString()}`;
}
