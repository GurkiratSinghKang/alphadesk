import type { EarningsReportTime } from "@/types";

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
        {/* B-90 — id referenced by the parent <section
            aria-labelledby="detail-header-title"> so SR users get a proper
            accessible name for the detail region. */}
        <h2 id="detail-header-title" className="t-display-section italic mt-1">
          {company} <span className="text-[color:var(--fg-dim)]">· {symbol}</span>
        </h2>
        <p className="t-meta mt-1">{sector} · Reports {formatReportDate(report_date)} · {report_time}</p>
      </div>
      <div className="text-right">
        <div className="t-num-hero">
          {quote ? quote.last.toFixed(2) : "—"}
        </div>
        <div className={"t-mono text-[13px] " + (isNeg ? "u-loss" : "u-profit")}>
          {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} · ${((changePct ?? 0) * 100).toFixed(2)}%`}
        </div>
      </div>
    </header>
  );
}

function formatReportDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
