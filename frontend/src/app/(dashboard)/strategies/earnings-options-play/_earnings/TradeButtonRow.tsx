import Link from "next/link";
import type { StrikeLadder, LadderRow } from "@/types";

export interface TradeButtonRowProps {
  symbol: string;
  ladder: StrikeLadder | null;
}

export default function TradeButtonRow({ symbol, ladder }: TradeButtonRowProps) {
  if (!ladder || ladder.rows.length === 0) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--border)] pt-3">
        <p className="t-mono text-[12px] u-muted">
          — options chain unavailable, trade buttons disabled.
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
          ▸ Short call {Math.round(atmCall.strike)}c
        </Link>
      )}
      {atmPut && (
        <Link
          data-slot="trade-button-short-put"
          href={buildSingleLegURL({ symbol, row: atmPut, expiry: ladder.expiry })}
          className="min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-center t-mono text-[12px] u-brand flex items-center justify-center hover:border-[color:var(--brand)]"
        >
          ▸ Short put {Math.round(atmPut.strike)}p
        </Link>
      )}
      {farPut && farCall && (
        <Link
          data-slot="trade-button-strangle"
          href={buildStrangleURL({ symbol, put: farPut, call: farCall, expiry: ladder.expiry })}
          className="min-h-[44px] rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-center t-mono text-[12px] u-brand flex items-center justify-center hover:border-[color:var(--brand)]"
        >
          ▸ Sell strangle {Math.round(farPut.strike)}/{Math.round(farCall.strike)}
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
 */
function occSymbol(symbol: string, expiry: string, side: "call" | "put", strike: number): string {
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const side_char = side === "call" ? "C" : "P";
  const strike_padded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${symbol}${yymmdd}${side_char}${strike_padded}`;
}

function buildSingleLegURL(opts: { symbol: string; row: LadderRow; expiry: string }): string {
  const contract = occSymbol(opts.symbol, opts.expiry, opts.row.side, opts.row.strike);
  const params = new URLSearchParams({
    symbol: opts.symbol,
    contract,
    side: "sell",
    qty: "1",
  });
  return `/trade?${params.toString()}`;
}

function buildStrangleURL(opts: {
  symbol: string;
  put: LadderRow;
  call: LadderRow;
  expiry: string;
}): string {
  const putContract = occSymbol(opts.symbol, opts.expiry, "put", opts.put.strike);
  const callContract = occSymbol(opts.symbol, opts.expiry, "call", opts.call.strike);
  const legs = `${putContract}:sell:1,${callContract}:sell:1`;
  const params = new URLSearchParams({ symbol: opts.symbol, legs });
  return `/trade?${params.toString()}`;
}
