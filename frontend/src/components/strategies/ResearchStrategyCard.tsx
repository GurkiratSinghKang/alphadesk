import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface ResearchCardMetric {
  label: string;
  value: string | number | null;
  hint: string;
}

export interface ResearchStrategyCardProps {
  id: string;
  name: string;
  subtitle: string;
  metrics: ResearchCardMetric[];
}

/**
 * Research-kind strategy card for /strategies.
 *
 * Mirrors the autonomous-strategy card's shape (page must stay visually
 * coherent), but swaps the Sharpe/CAGR/MaxDD metric row for honest,
 * per-tool research metrics.
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
          <h3 className="t-section-display italic">{name}</h3>
          <p className="mt-1 font-mono text-body-sm text-[color:var(--fg-muted)]">
            {subtitle}
          </p>
        </div>
        <span className="t-label shrink-0 rounded border border-[color:var(--fg-border)] px-2 py-0.5 text-[color:var(--fg-accent)]">
          RESEARCH
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-[color:var(--fg-border)] pt-4">
        {metrics.slice(0, 3).map((metric) => (
          <div key={metric.label}>
            <dt className="t-label text-[color:var(--fg-muted)]">{metric.label}</dt>
            <dd className="t-num-lg">{metric.value ?? "—"}</dd>
            <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">{metric.hint}</dd>
          </div>
        ))}
      </dl>

      <ArrowRight
        className="absolute bottom-4 right-4 h-4 w-4 text-[color:var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </Link>
  );
}
