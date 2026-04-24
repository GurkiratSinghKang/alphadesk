"use client";

import type { ClaudeStructured, ClaudeFullResearch } from "@/types";

export interface ClaudeThesisCardProps {
  structured: ClaudeStructured | null;
  full: ClaudeFullResearch | null;
  running: boolean;
  onRunFull: () => void;
}

export default function ClaudeThesisCard({ structured, full, running, onRunFull }: ClaudeThesisCardProps) {
  if (!structured) {
    return (
      <section data-slot="claude-thesis" className="rounded border-l-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] p-3">
        <p className="t-label u-brand">◇ CLAUDE · STRUCTURED</p>
        <p className="mt-2 t-mono text-[13px] u-muted">
          Analysis pending — come back in a moment, or retry.
        </p>
      </section>
    );
  }

  return (
    <section data-slot="claude-thesis" className="rounded border-l-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] p-3">
      <div className="flex items-center justify-between">
        <p className="t-label u-brand">◇ CLAUDE · STRUCTURED</p>
        <span className="t-meta">{structured.model}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="t-mono text-[14px] font-semibold u-brand">
          {structured.verdict.toUpperCase()}
        </span>
        <span className="t-meta">
          conf {Math.round(structured.confidence * 100)}%
        </span>
      </div>
      <p className="t-meta mt-1">
        est. move: +{(structured.direction_magnitude.bull_case_pct * 100).toFixed(1)}%
        &nbsp;/&nbsp;
        {(structured.direction_magnitude.bear_case_pct * 100).toFixed(1)}%
      </p>
      <p className="mt-2 t-mono text-[13px] leading-relaxed">
        {structured.thesis}
      </p>
      {structured.catalysts.length > 0 && (
        <p className="mt-2 t-mono text-[11.5px] u-muted">
          <span className="u-profit">Catalysts:</span> {structured.catalysts.join(" · ")}
        </p>
      )}
      {structured.risks.length > 0 && (
        <p className="t-mono text-[11.5px] u-muted">
          <span className="u-loss">Risks:</span> {structured.risks.join(" · ")}
        </p>
      )}
      <p className="mt-1 t-mono text-[11.5px]">
        <span className="u-muted">Play:</span>{" "}
        <span className="u-brand">{structured.suggested_play}</span>
        <span className="u-muted"> — {structured.suggested_play_reason}</span>
      </p>

      <div className="mt-3 border-t border-[color:var(--border)] pt-3">
        {full ? (
          <FullResearchBlock full={full} />
        ) : (
          <button
            type="button"
            onClick={onRunFull}
            disabled={running}
            aria-label={running ? "Generating full research" : "Run full research"}
            /* B-88 — hover:text-gold-300 lifts the CTA text from --brand
               (7.58:1 on bg-card, borderline AAA) to --gold-300 (9.89:1,
               AAA) so the hover state reads distinctly brighter. */
            className="rounded border border-[color:var(--border)] bg-transparent px-3 py-1 t-mono text-[11px] u-brand transition-colors hover:border-[color:var(--brand)] hover:text-gold-300 disabled:opacity-50"
          >
            {running ? "▸ Generating full research…" : "▸ Run full research"}
          </button>
        )}
      </div>
    </section>
  );
}

function FullResearchBlock({ full }: { full: ClaudeFullResearch }) {
  return (
    <div data-slot="claude-full-research" className="space-y-3">
      <p className="t-label u-brand">◈ FULL RESEARCH NOTE</p>
      <p className="t-mono text-[13px] leading-relaxed">{full.thesis_paragraph}</p>
      {full.comparable_setups.length > 0 && (
        <div>
          <p className="t-label u-muted">COMPARABLE SETUPS</p>
          <ul className="mt-1 space-y-1 t-mono text-[11.5px]">
            {full.comparable_setups.map((c, i) => (
              <li key={i} className="u-muted">
                <span className="">{c.report_date}</span> · IVR {c.iv_rank.toFixed(0)} · {c.setup} →{" "}
                <span className="u-brand">{c.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <BlockField label="POST-EARNINGS DRIFT PLAYBOOK" text={full.post_earnings_drift_playbook} />
      <BlockField label="SECTOR BACKDROP" text={full.sector_backdrop} />
      <BlockField label="ANALYST CONSENSUS DELTA" text={full.analyst_consensus_delta} />
      <BlockField label="WHAT WOULD CHANGE MY MIND" text={full.what_would_change_my_mind} />
    </div>
  );
}

function BlockField({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="t-label u-muted">{label}</p>
      <p className="mt-0.5 t-mono text-[12px] leading-relaxed">{text}</p>
    </div>
  );
}
