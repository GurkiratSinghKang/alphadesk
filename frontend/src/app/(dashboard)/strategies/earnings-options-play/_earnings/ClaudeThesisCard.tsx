"use client";

import type { ClaudeStructured, ClaudeFullResearch } from "@/types";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";

export interface ClaudeThesisCardProps {
  structured: ClaudeStructured | null;
  full: ClaudeFullResearch | null;
  running: boolean;
  onRunFull: () => void;
  /**
   * B-94 — SR context. When set, the research-run button's accessible
   * name includes the symbol so users jumping between cards always hear
   * which ticker the action applies to. Optional so the old prop shape
   * stays backwards-compatible.
   */
  symbol?: string;
}

export default function ClaudeThesisCard({ structured, full, running, onRunFull, symbol }: ClaudeThesisCardProps) {
  if (!structured) {
    return (
      <section
        data-slot="claude-thesis"
        aria-busy={true}
        className="rounded border-l-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] p-3"
      >
        <p className="t-label u-brand">◇ CLAUDE · STRUCTURED</p>
        <div
          role="status"
          aria-live="polite"
          className="mt-2 flex items-center gap-2"
        >
          <span className="flex items-center gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:300ms]" />
          </span>
          <span className="t-mono text-[13px] u-muted">
            Analyzing (typically 30 s)… Analysis pending — come back in a moment.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      data-slot="claude-thesis"
      aria-busy={false}
      className="rounded border-l-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] p-3"
    >
      <div className="flex items-center justify-between">
        <p className="t-label u-brand">◇ CLAUDE · STRUCTURED</p>
        <span className="t-meta">{structured.model}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="t-mono text-[14px] font-semibold u-brand">
          {structured.verdict.toUpperCase()}
        </span>
        <span className="t-meta">
          conf {fmtPct(structured.confidence, 0)}
        </span>
      </div>
      <p className="t-meta mt-1">
        est. move: {fmtPct(structured.directionMagnitude.bullCasePct, 1, { signDisplay: "always" })}
        &nbsp;/&nbsp;
        {fmtPct(structured.directionMagnitude.bearCasePct, 1, { signDisplay: "always" })}
      </p>
      <div
        data-slot="claude-thesis-text"
        className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed"
      >
        {structured.thesis}
      </div>
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
        <span className="u-brand">{structured.suggestedPlay}</span>
        <span className="u-muted"> — {structured.suggestedPlayReason}</span>
      </p>

      <div className="mt-3 border-t border-[color:var(--border)] pt-3">
        {full ? (
          <FullResearchBlock full={full} />
        ) : (
          <button
            type="button"
            onClick={onRunFull}
            disabled={running}
            /* B-94 — drop the aria-label when it would merely duplicate the
               visible text; when a `symbol` is provided, use it to
               disambiguate between panels (e.g. "Run full research for
               NVDA"). Otherwise the button's own text content supplies
               the accessible name by default. */
            aria-label={
              symbol
                ? running
                  ? `Generating full research for ${symbol}`
                  : `Run full research for ${symbol}`
                : undefined
            }
            /* B-57 min-h-[44px]: iPad touch target.
               B-88 hover:text-gold-300 lifts the CTA text from --brand
               (7.58:1 on bg-card, borderline AAA) to --gold-300 (9.89:1,
               AAA) so the hover state reads distinctly brighter. */
            className="min-h-[44px] rounded border border-[color:var(--border)] bg-transparent px-3 py-2 t-mono text-[11px] u-brand transition-colors hover:border-[color:var(--brand)] hover:text-gold-300 disabled:opacity-50"
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
      <p className="t-mono text-[13px] leading-relaxed">{full.thesisParagraph}</p>
      {full.comparableSetups.length > 0 && (
        <div>
          <p className="t-label u-muted">COMPARABLE SETUPS</p>
          <ul className="mt-1 space-y-1 t-mono text-[11.5px]">
            {full.comparableSetups.map((c, i) => (
              <li key={i} className="u-muted">
                <span className="">{fmtDate(c.reportDate, { year: "numeric", month: "short", day: "numeric" })}</span> · IVR {fmtNumber(c.ivRank, { maximumFractionDigits: 0 })} · {c.setup} →{" "}
                <span className="u-brand">{c.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <BlockField label="POST-EARNINGS DRIFT PLAYBOOK" text={full.postEarningsDriftPlaybook} />
      <BlockField label="SECTOR BACKDROP" text={full.sectorBackdrop} />
      <BlockField label="ANALYST CONSENSUS DELTA" text={full.analystConsensusDelta} />
      <BlockField label="WHAT WOULD CHANGE MY MIND" text={full.whatWouldChangeMyMind} />
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
