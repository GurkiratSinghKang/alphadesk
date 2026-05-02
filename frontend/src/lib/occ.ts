export type ParsedOccSymbol = {
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
};

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
