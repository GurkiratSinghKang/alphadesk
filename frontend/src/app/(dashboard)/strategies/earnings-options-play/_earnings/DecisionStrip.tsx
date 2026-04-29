"use client";

import type { ClaudeStructured, EarningsMetricsBlock } from "@/types";
import { fmtPct } from "@/lib/intl";

/**
 * DecisionStrip — Round-8 single-view bundle B.
 *
 * The page hero for the earnings detail surface. Promotes Claude's
 * VERDICT + CONFIDENCE + EXPECTED MOVE from the third-tier
 * ClaudeThesisCard into the FIRST thing the user sees after the
 * symbol header. The trader's actual question on this page is
 * "should I take this?" — burying that answer in a paragraph card
 * was a clear violation of R8 (one-hero-per-page) per the synthesis
 * proposal.
 *
 * Renders nothing when ``structured`` is missing — the existing
 * "claude_unavailable" partial-data banner already covers that case
 * upstream and a placeholder strip would just add noise.
 *
 * Confidence: 12-stop progress bar (0-100). Tone: brand color when
 * ≥ 70 (high-conviction), muted otherwise — matches the editorial
 * palette without inventing new tokens.
 *
 * Expected move: signed % from ``metrics.expectedMovePct``. The
 * sign display matches the ``±`` convention used elsewhere on the
 * page (MetricsStrip ``±X.X%``) so users see the same number twice
 * in two roles — hero + ladder context.
 */
export interface DecisionStripProps {
  structured: ClaudeStructured | null;
  metrics: EarningsMetricsBlock | null;
}

export default function DecisionStrip({ structured, metrics }: DecisionStripProps) {
  if (!structured) return null;

  const verdict = structured.verdict.toUpperCase();
  const confPct = Math.round(structured.confidence * 100);
  const highConfidence = confPct >= 70;
  const expMovePct = metrics?.expectedMovePct ?? null;

  return (
    <section
      data-slot="decision-strip"
      aria-label="Earnings trade decision summary"
      className="mb-3 grid grid-cols-1 gap-3 rounded-lg border border-border bg-bg-card px-4 py-3 sm:grid-cols-3"
    >
      {/* VERDICT — the decision */}
      <div className="flex flex-col">
        <span className="t-label u-muted">Verdict</span>
        <span
          className="font-serif italic text-[28px] leading-tight u-brand"
          style={{ letterSpacing: 0 }}
        >
          {verdict}
        </span>
        <span className="t-meta u-muted mt-0.5">
          {structured.suggestedPlay}
        </span>
      </div>

      {/* CONFIDENCE — 12-stop progress bar */}
      <div className="flex flex-col">
        <span className="t-label u-muted">Confidence</span>
        <div className="mt-1 flex items-center gap-2">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elev-1"
            role="progressbar"
            aria-valuenow={confPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Claude confidence ${confPct}%`}
          >
            <div
              className={
                "h-full rounded-full transition-all " +
                (highConfidence ? "bg-[color:var(--brand)]" : "bg-fg-muted")
              }
              style={{ width: `${confPct}%` }}
            />
          </div>
          <span className="t-num-md tabular-nums">{confPct}%</span>
        </div>
        <span className="t-meta u-muted mt-0.5">
          model: {structured.model}
        </span>
      </div>

      {/* EXPECTED MOVE — signed % with band copy */}
      <div className="flex flex-col">
        <span className="t-label u-muted">Expected move</span>
        <span className="font-mono text-[24px] leading-tight tabular-nums">
          {expMovePct != null ? `±${fmtPct(Math.abs(expMovePct), 1)}` : "—"}
        </span>
        <span className="t-meta u-muted mt-0.5">
          {expMovePct != null ? "1σ band by expiry" : "metric unavailable"}
        </span>
      </div>
    </section>
  );
}
