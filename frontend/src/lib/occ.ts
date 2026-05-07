export type ParsedOccSymbol = {
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
};

/**
 * Quick-test predicate: does ``s`` look like a full OCC option contract?
 *
 * OCC contract format: ROOT (1–6 letters/digits) + YYMMDD (6 digits) +
 * C|P (call/put marker) + strike (8 digits, price * 1000 zero-padded).
 *
 * Used by /trade to decide whether the staged ticket includes any option
 * legs — only then does the auto-refresh of ``quote_at_fill_ts`` need to
 * run, since the backend's stale-quote gate fail-closes for option legs
 * but not equity-only orders.
 *
 * Cheap regex-only check; for parsing the parts use ``parseOccSymbol``.
 */
export function isOccSymbol(s: string): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  return /^[A-Z0-9]{1,6}\d{6}[CP]\d{8}$/.test(s);
}

export function formatOccSymbol({
  symbol,
  expiry,
  side,
  strike,
}: {
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
}): string | null {
  const root = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!root || root.length > 6) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const sideChar = side === "call" ? "C" : "P";
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${root}${yymmdd}${sideChar}${strikePadded}`;
}

/**
 * Parse an OCC option symbol into its constituent parts.
 *
 * Format: SSSSSS YYMMDD C|P NNNNNNNN (strike is 8 digits, price x 1000)
 * Example: NVDA260425C00205000 -> { symbol:"NVDA", expiry:"2026-04-25", side:"call", strike:205 }
 */
export function parseOccSymbol(occ: string): ParsedOccSymbol | null {
  const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!m) return null;
  const [, sym, yymmdd, sideChar, strikeStr] = m;
  const expiry =
    "20" +
    yymmdd.slice(0, 2) +
    "-" +
    yymmdd.slice(2, 4) +
    "-" +
    yymmdd.slice(4, 6);
  return {
    symbol: sym,
    expiry,
    side: sideChar === "C" ? "call" : "put",
    strike: parseInt(strikeStr, 10) / 1000,
  };
}
