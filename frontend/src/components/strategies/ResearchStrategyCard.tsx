import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface ResearchCardMetrics {
  thisWeekCount: number;
  avgIvRank: number;
  topSetup: string | null;
}

export interface ResearchStrategyCardProps {
  id: string;
  name: string;
  subtitle: string;
  metrics: ResearchCardMetrics;
}

/**
 * Research-kind strategy card for /strategies.
 *
 * Mirrors the autonomous-strategy card's shape (page must stay visually
 * coherent), but swaps the Sharpe/CAGR/MaxDD metric row for honest
 * research metrics — count of upcoming earnings, average IV rank across
 * those earnings, and the current top-setup symbol.
 *
 * Pill reads "RESEARCH" (vs "ACTIVE") so users immediately see this is a
 * decision-support tool, not an autonomous strategy.
 */
export default function ResearchStrategyCard({
  id,
  name,
  subtitle,
  metrics,
}: ResearchStrategyCardProps) {
  return (
    <Link
      href={`/strategies/${id}`}
      className="group relative block rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-5 transition-colors hover:border-[color:var(--fg-accent)]"
      data-slot="research-strategy-card"
      data-strategy-id={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="t-display-section italic">{name}</h3>
          <p className="mt-1 font-mono text-[13px] text-[color:var(--fg-muted)]">
            {subtitle}
          </p>
        </div>
        <span className="t-label shrink-0 rounded border border-[color:var(--fg-border)] px-2 py-0.5 text-[color:var(--fg-accent)]">
          RESEARCH
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-[color:var(--fg-border)] pt-4">
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">THIS WEEK</dt>
          <dd className="t-num-lg">{metrics.thisWeekCount}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">earnings</dd>
        </div>
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">AVG IV RANK</dt>
          <dd className="t-num-lg">{metrics.avgIvRank || "—"}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">across set</dd>
        </div>
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">TOP SETUP</dt>
          <dd className="t-num-lg">{metrics.topSetup ?? "—"}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">recommended</dd>
        </div>
      </dl>

      <ArrowRight
        className="absolute bottom-4 right-4 h-4 w-4 text-[color:var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </Link>
  );
}
