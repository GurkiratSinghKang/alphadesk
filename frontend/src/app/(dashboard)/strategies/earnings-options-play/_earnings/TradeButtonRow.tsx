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
  // Round-8 / DT-02: defensive 15Δ wide-strangle. Lower vega, higher
  // POP — a core earnings premium-seller play. The ``pickRow`` typedef
  // already supports the ``"15Δ"`` bucket; the row was simply never
  // built. Rendered as a fourth button only when both legs exist (very
  // illiquid names with thin chains will fall back to the existing
  // ATM/30Δ trio).
  const wideCall = pickRow(ladder.rows, "call", "15Δ");
  const widePut = pickRow(ladder.rows, "put", "15Δ");

  return (
    <div
      data-slot="trade-button-row"
      className="mt-4 grid grid-cols-1 gap-2 border-t border-[color:var(--border)] pt-3 sm:grid-cols-2 md:grid-cols-4"
    >
      {atmCall && (
        <UndefinedRiskTradeLink
          dataSlot="trade-button-short-call"
          href={buildSingleLegURL({ symbol, row: atmCall, expiry: ladder.expiry })}
          label={`Sell-to-open call ${fmtNumber(Math.round(atmCall.strike), { maximumFractionDigits: 0 })}c`}
          riskCopy="Naked short call · max loss UNLIMITED above strike"
        />
      )}
      {atmPut && (
        <UndefinedRiskTradeLink
          dataSlot="trade-button-short-put"
          href={buildSingleLegURL({ symbol, row: atmPut, expiry: ladder.expiry })}
          label={`Sell-to-open put ${fmtNumber(Math.round(atmPut.strike), { maximumFractionDigits: 0 })}p`}
          riskCopy={`Naked short put · max loss ≈ $${fmtNumber(Math.round(atmPut.strike) * 100, { maximumFractionDigits: 0 })} if stock → 0`}
        />
      )}
      {farPut && farCall && (
        <UndefinedRiskTradeLink
          dataSlot="trade-button-strangle"
          href={buildStrangleURL({ symbol, put: farPut, call: farCall, expiry: ladder.expiry })}
          label={`Sell 30Δ strangle ${fmtNumber(Math.round(farPut.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(farCall.strike), { maximumFractionDigits: 0 })}`}
          riskCopy="Naked strangle · max loss UNLIMITED · breakeven outside strikes ± credit"
        />
      )}
      {widePut && wideCall && (
        <UndefinedRiskTradeLink
          dataSlot="trade-button-wide-strangle"
          href={buildStrangleURL({ symbol, put: widePut, call: wideCall, expiry: ladder.expiry })}
          label={`Sell 15Δ strangle ${fmtNumber(Math.round(widePut.strike), { maximumFractionDigits: 0 })}/${fmtNumber(Math.round(wideCall.strike), { maximumFractionDigits: 0 })}`}
          riskCopy="Wider 15Δ strangle · higher POP, lower premium · still naked / unlimited risk"
        />
      )}
    </div>
  );
}

/**
 * Round-8 / NV-02: shared button that surfaces an UNDEFINED RISK pill
 * for every uncovered short trade. Novices reading "Short call 500c"
 * without context assume defined risk; this label is now explicit
 * ("Sell-to-open call") and the warning chip + tooltip surface the
 * unbounded loss profile before they click through to /trade.
 */
function UndefinedRiskTradeLink({
  dataSlot,
  href,
  label,
  riskCopy,
}: {
  dataSlot: string;
  href: string;
  label: string;
  riskCopy: string;
}) {
  return (
    <Link
      data-slot={dataSlot}
      href={href}
      title={riskCopy}
      aria-describedby={`${dataSlot}-risk`}
      className="group min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 t-mono text-[12px] flex flex-col items-center justify-center gap-0.5 hover:border-[color:var(--brand)]"
    >
      <span className="u-brand inline-flex items-center gap-1.5">
        <span aria-hidden="true">▸</span>
        {label}
      </span>
      <span
        id={`${dataSlot}-risk`}
        className="text-[9.5px] uppercase tracking-wider u-loss"
      >
        ⚠ Undefined risk
      </span>
    </Link>
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
