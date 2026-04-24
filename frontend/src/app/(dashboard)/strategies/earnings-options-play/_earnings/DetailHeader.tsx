import type { Ref } from "react";
import type { EarningsReportTime } from "@/types";
import { fmtCurrency, fmtDate, fmtPct } from "@/lib/intl";
import { fmtRelativeTime } from "@/lib/time";

export interface DetailHeaderProps {
  symbol: string;
  company: string;
  sector: string;
  // Nullable for stub-detail responses — see B-41 in earnings_screener.py.
  reportDate: string | null;
  reportTime: EarningsReportTime;
  quote: { last: number; change: number; changePct: number } | null;
  /** ISO datetime of the most-recent detail snapshot. Surfaces as the
   *  "Updated 5 m ago" label in the header. */
  generatedAt?: string;
  /** Ref to the H2 heading so the parent panel can move focus here
   *  after a filter-triggered symbol change (B-56). */
  headingRef?: Ref<HTMLHeadingElement>;
}

export default function DetailHeader({
  symbol, company, sector, reportDate, reportTime, quote, generatedAt, headingRef,
}: DetailHeaderProps) {
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;
  const isNeg = (change ?? 0) < 0;
  const freshness = getFreshness(generatedAt);

  return (
    <header
      data-slot="detail-header"
      className="flex items-baseline justify-between gap-6 border-b border-[color:var(--border)] pb-3"
    >
      <div>
        <p className="t-label">§ EARNINGS · OPTIONS PLAY</p>
        {/* B-56 headingRef + tabIndex={-1}: parent moves focus here after a
            filter-driven symbol change so SR users land on the new symbol.
            B-90 id: the parent <section aria-labelledby="detail-header-title">
            uses it to name the detail region. */}
        <h2
          id="detail-header-title"
          ref={headingRef}
          tabIndex={-1}
          className="t-display-section italic mt-1 outline-none"
        >
          {company} <span className="text-[color:var(--fg-dim)]">· {symbol}</span>
        </h2>
        <p className="t-meta mt-1">{sector} · Reports {reportDate ? formatReportDate(reportDate) : "—"} · {reportTime}</p>
        {generatedAt && (
          <p
            data-slot="detail-updated"
            className="t-meta mt-0.5 u-muted"
            title={generatedAt}
          >
            Updated {fmtRelativeTime(generatedAt)}
          </p>
        )}
      </div>
      <div className="text-right">
        <div className="flex items-center justify-end gap-2">
          {freshness && (
            <span
              data-slot="freshness-pill"
              title={generatedAt}
              aria-label={freshness.kind === "live" ? "Live price" : `Delayed price, ${freshness.age}`}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 t-mono text-[10px] uppercase tracking-wide " +
                (freshness.kind === "live"
                  ? "border-[color:var(--profit)] text-[color:var(--profit)]"
                  : "border-[color:var(--border)] u-muted")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (freshness.kind === "live"
                    ? "bg-[color:var(--profit)]"
                    : "bg-[color:var(--fg-muted)]")
                }
              />
              {freshness.kind === "live" ? "LIVE" : `DELAYED ${freshness.age}`}
            </span>
          )}
          <div className="t-num-hero">
            {quote ? fmtCurrency(quote.last, "USD") : "—"}
          </div>
        </div>
        <div className={"t-mono text-[13px] " + (isNeg ? "u-loss" : "u-profit")}>
          {change == null
            ? "—"
            : `${fmtCurrency(change, "USD", { signDisplay: "always" })} · ${fmtPct(changePct ?? 0, 2)}`}
        </div>
      </div>
    </header>
  );
}

/**
 * Convert a generatedAt timestamp into a LIVE/DELAYED pill descriptor.
 * <30s old reads as live; otherwise shows the short relative age.
 */
function getFreshness(iso: string | undefined): { kind: "live" | "delayed"; age: string } | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const ageSec = (Date.now() - then) / 1000;
  if (ageSec < 30) return { kind: "live", age: "just now" };
  return { kind: "delayed", age: fmtRelativeTime(iso) };
}

function formatReportDate(iso: string): string {
  // Locale-aware via Intl — formats in the viewer's timezone and locale.
  return fmtDate(iso, { weekday: "short", month: "short", day: "numeric" });
}
