import type { EarningsReportTime } from "@/types";
import { fmtCurrency, fmtDate, fmtPct } from "@/lib/intl";

export interface DetailHeaderProps {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  quote: { last: number; change: number; change_pct: number } | null;
}

export default function DetailHeader({
  symbol, company, sector, report_date, report_time, quote,
}: DetailHeaderProps) {
  const change = quote?.change ?? null;
  const changePct = quote?.change_pct ?? null;
  const isNeg = (change ?? 0) < 0;

  return (
    <header
      data-slot="detail-header"
      className="flex items-baseline justify-between gap-6 border-b border-[color:var(--border)] pb-3"
    >
      <div>
        <p className="t-label">§ EARNINGS · OPTIONS PLAY</p>
        <h2 className="t-display-section italic mt-1">
          {company} <span className="text-[color:var(--fg-dim)]">· {symbol}</span>
        </h2>
        <p className="t-meta mt-1">{sector} · Reports {formatReportDate(report_date)} · {report_time}</p>
      </div>
      <div className="text-right">
        <div className="t-num-hero">
          {quote ? fmtCurrency(quote.last, "USD") : "—"}
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

function formatReportDate(iso: string): string {
  // Locale-aware via Intl — formats in the viewer's timezone and locale.
  return fmtDate(iso, { weekday: "short", month: "short", day: "numeric" });
}
