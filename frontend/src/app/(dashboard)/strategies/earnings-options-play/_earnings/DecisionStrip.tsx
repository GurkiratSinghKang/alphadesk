"use client";

import type { ClaudeStructured, EarningsMetricsBlock } from "@/types";
import { fmtPct } from "@/lib/intl";

const LEGACY_UNSUPPORTED_PLAYS = new Set(["short call", "short strangle"]);

/**
 * EOP-AUDIT 2026-05-06 / B1.20: the recommender's minimum-confidence
 * threshold. Mirrors ``CLAUDE_MIN_CONFIDENCE_TO_RECOMMEND`` in the
 * backend recommender; surfaced here so the user can see whether
 * Claude's confidence cleared the bar. If the BE constant changes,
 * update this in lockstep.
 */
const CONFIDENCE_THRESHOLD_PCT = 60;

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
  const legacyUnsupported = LEGACY_UNSUPPORTED_PLAYS.has(structured.suggestedPlay);

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
          className="font-serif italic text-h1 leading-tight u-brand"
          style={{ letterSpacing: 0 }}
        >
          {verdict}
        </span>
        <span className="t-meta u-muted mt-0.5">
          {structured.suggestedPlay}
          {legacyUnsupported ? " · legacy, not tradeable" : ""}
        </span>
      </div>

      {/* CONFIDENCE — 12-stop progress bar */}
      <div className="flex flex-col">
        <span className="t-label u-muted">Confidence</span>
        <div className="mt-1 flex items-center gap-2">
          {/* EOP-AUDIT 2026-05-06 / B1.20: confidence threshold tick.
              The recommender's "minimum to recommend" is 60% — without
              a reference mark the user can't tell whether the bar is
              "good enough". A vertical tick at 60% on the track plus
              the explanatory caption below makes the cutoff explicit. */}
          <div
            className="relative h-2 flex-1 overflow-visible rounded-full bg-bg-elev-1"
            role="progressbar"
            aria-valuenow={confPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`AI confidence ${confPct}%`}
          >
            <div
              className={
                "h-full overflow-hidden rounded-full transition-all " +
                (highConfidence ? "bg-[color:var(--brand)]" : "bg-fg-muted")
              }
              style={{ width: `${confPct}%` }}
            />
            <span
              data-slot="confidence-threshold-tick"
              aria-hidden="true"
              title="Minimum to recommend: 60%"
              className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[color:var(--fg)]"
              style={{ left: `${CONFIDENCE_THRESHOLD_PCT}%` }}
            />
          </div>
          <span className="t-num-md tabular-nums">{confPct}%</span>
        </div>
        <span
          data-slot="confidence-threshold-caption"
          className="t-meta u-muted mt-0.5"
        >
          {confPct >= CONFIDENCE_THRESHOLD_PCT
            ? `Threshold: ${CONFIDENCE_THRESHOLD_PCT}% — clears the system's minimum to recommend.`
            : `Threshold: ${CONFIDENCE_THRESHOLD_PCT}% — at ${confPct}% the system suggests caution.`}
        </span>
        <span className="t-meta u-muted mt-0.5">
          model: {structured.model}
        </span>
      </div>

      {/* EXPECTED MOVE — signed % with band copy */}
      <div className="flex flex-col">
        <span className="t-label u-muted">Expected move</span>
        <span className="font-mono text-h2 leading-tight tabular-nums">
          {expMovePct != null ? `±${fmtPct(Math.abs(expMovePct), 1)}` : "—"}
        </span>
        <span className="t-meta u-muted mt-0.5">
          {expMovePct != null ? "1σ band by expiry" : "metric unavailable"}
        </span>
      </div>
    </section>
  );
}
