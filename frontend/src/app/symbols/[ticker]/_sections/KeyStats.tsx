"use client";

import { useQuery } from "@tanstack/react-query";

import { getTickerFundamentals } from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtPct } from "@/lib/intl";
import type { TickerFundamentals } from "@/types";

const DASH = "—";

// 24h matches the backend Redis TTL — fundamentals don't move within a
// trading day, and we don't want React Query to re-fetch on every page
// remount when the data is already warm in the BE cache.
const STALE_TIME_MS = 24 * 60 * 60 * 1000;
const PUBLIC_SYMBOL_DATA_OPTIONS = {
  suppressAuthRedirect: true,
  suppressGlobalError: true,
} as const;

export interface KeyStatsProps {
  symbol: string;
}

interface CellSpec {
  key: string;
  label: string;
  value: string;
}

function fmtLargeCurrency(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return fmtCurrency(n, "USD", { notation: "compact", maximumFractionDigits: 1 });
}

function fmtLargeNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return fmtNumber(n, { notation: "compact", maximumFractionDigits: 1 });
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return fmtCurrency(n);
}

function fmtRatio(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return fmtNumber(n, { maximumFractionDigits: 2 });
}

function fmtPercentRatio(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  // Backend dividend_yield is a ratio (0.0003 = 0.03%) — fmtPct multiplies by 100.
  return fmtPct(n, 2);
}

function buildCells(fund: TickerFundamentals | null | undefined): CellSpec[] {
  return [
    { key: "market-cap", label: "Mkt Cap", value: fmtLargeCurrency(fund?.marketCap ?? null) },
    { key: "pe-ratio", label: "P/E", value: fmtRatio(fund?.peRatio ?? null) },
    { key: "eps-ttm", label: "EPS (TTM)", value: fmtRatio(fund?.epsTtm ?? null) },
    { key: "div-yield", label: "Div Yield", value: fmtPercentRatio(fund?.dividendYield ?? null) },
    { key: "fifty-two-w-high", label: "52w High", value: fmtPrice(fund?.fiftyTwoWeekHigh ?? null) },
    { key: "fifty-two-w-low", label: "52w Low", value: fmtPrice(fund?.fiftyTwoWeekLow ?? null) },
    { key: "avg-vol", label: "Avg Vol (30d)", value: fmtLargeNumber(fund?.avgVolume30d ?? null) },
    { key: "beta", label: "Beta", value: fmtRatio(fund?.beta ?? null) },
  ];
}

function Shell({
  cells,
  variant,
}: {
  cells: CellSpec[];
  variant: "loading" | "ready" | "error";
}) {
  return (
    <section
      id="key-stats"
      data-testid="key-stats"
      data-slot={`key-stats-${variant}`}
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
    >
      <p className="t-label u-muted">Fundamentals</p>
      {variant === "loading" ? (
        <p className="mt-1 t-mono text-body-sm u-muted">Loading…</p>
      ) : variant === "error" ? (
        <p className="mt-1 t-mono text-body-sm u-muted">Unavailable</p>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className="rounded-sm bg-bg p-2"
            data-slot="key-stats-cell"
            data-cell-key={cell.key}
          >
            <dt className="t-label u-muted text-micro">{cell.label}</dt>
            <dd className="t-mono mt-1 text-label">{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function KeyStats({ symbol }: KeyStatsProps) {
  const query = useQuery<TickerFundamentals>({
    queryKey: ["fundamentals", symbol],
    queryFn: () => getTickerFundamentals(symbol, PUBLIC_SYMBOL_DATA_OPTIONS),
    staleTime: STALE_TIME_MS,
    enabled: Boolean(symbol),
  });

  if (query.isLoading) {
    // Render the same 8-cell layout with em-dashes so the panel
    // doesn't pop in/out of existence — only the header eyebrow flips.
    return <Shell cells={buildCells(null)} variant="loading" />;
  }

  if (query.isError || !query.data) {
    // Don't crash the page on a fundamentals fetch failure — the rest
    // of the symbols page is still useful without this section.
    return <Shell cells={buildCells(null)} variant="error" />;
  }

  return <Shell cells={buildCells(query.data)} variant="ready" />;
}

export default KeyStats;
