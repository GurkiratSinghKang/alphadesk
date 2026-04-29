"use client";

import { useEffect, useState } from "react";
import type { ClaudeStructured, ClaudeFullResearch } from "@/types";
import { RateLimitError } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";

export interface ClaudeThesisCardProps {
  structured: ClaudeStructured | null;
  full: ClaudeFullResearch | null;
  running: boolean;
  /** Round-4 (CLUSTER D/11): error from the most-recent full-research
   *  request. RateLimitError triggers a live "try again in {n}s"
   *  countdown; other errors render inline as a generic alert. */
  error?: Error | null;
  onRunFull: () => void;
  /**
   * B-94 — SR context. When set, the research-run button's accessible
   * name includes the symbol so users jumping between cards always hear
   * which ticker the action applies to. Optional so the old prop shape
   * stays backwards-compatible.
   */
  symbol?: string;
}

export default function ClaudeThesisCard({ structured, full, running, error = null, onRunFull, symbol }: ClaudeThesisCardProps) {
  if (!structured) {
    return (
      <section
        data-slot="claude-thesis"
        aria-busy={running}
        className="rounded border-l-2 border-[color:var(--brand)] bg-[color:var(--brand-tint)] p-3"
      >
        <div className="flex items-center justify-between">
          <p className="t-label u-brand">◇ CLAUDE · STRUCTURED</p>
          <span className="t-meta">unavailable</span>
        </div>
        {running ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 flex items-center gap-2"
          >
            <LoadingDots />
            <span className="t-mono text-[13px] u-muted">
              Generating full research with the available quote, options, and news context.
            </span>
          </div>
        ) : (
          <p className="mt-2 t-mono text-[13px] leading-relaxed u-muted">
            Structured thesis is unavailable right now. You can still request a full research note from the data that loaded for this symbol.
          </p>
        )}
        <div className="mt-3 border-t border-[color:var(--border)] pt-3">
          {full ? (
            <FullResearchBlock full={full} />
          ) : (
            <FullResearchTrigger
              running={running}
              error={error}
              onRunFull={onRunFull}
              symbol={symbol}
            />
          )}
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
          <FullResearchTrigger
            running={running}
            error={error}
            onRunFull={onRunFull}
            symbol={symbol}
          />
        )}
      </div>
    </section>
  );
}

interface FullResearchTriggerProps {
  running: boolean;
  error: Error | null;
  onRunFull: () => void;
  symbol?: string;
}

/**
 * Round-4 (CLUSTER D/11): the run-full-research button + inline error
 * surface. RateLimitError drives a live "try again in {n}s" countdown
 * so the user can see exactly when the cooldown clears, not just that
 * "the button is disabled".
 */
function FullResearchTrigger({ running, error, onRunFull, symbol }: FullResearchTriggerProps) {
  const isRateLimit = error instanceof RateLimitError;
  const initialRetry = isRateLimit ? error.retryAfter ?? 0 : 0;
  const [retrySec, setRetrySec] = useState(initialRetry);

  // Reset countdown whenever a new error / retry duration arrives, then
  // run a single setInterval until we reach 0. Splitting "reset" and
  // "tick" into two effects (instead of one effect that re-creates the
  // interval on every state change) keeps the cadence stable across
  // re-renders.
  //
  // Round-5 (NEW-Y5 / E-8): dep on `[error, initialRetry]` rather than
  // `[initialRetry]`. Without `error` in the deps a duplicate retryAfter
  // value (user mashes the button twice → backend returns 429 with the
  // same 30s) wouldn't restart the visible timer because `initialRetry`
  // didn't change. Each new RateLimitError instance now retriggers the
  // effect — the visible countdown restarts at the fresh retryAfter.
  useEffect(() => {
    setRetrySec(initialRetry);
    if (initialRetry <= 0) return;
    const id = setInterval(() => {
      setRetrySec((n) => {
        if (n <= 1) {
          clearInterval(id);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [error, initialRetry]);

  const buttonDisabled = running || retrySec > 0;

  return (
    <>
      <button
        type="button"
        onClick={onRunFull}
        disabled={buttonDisabled}
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
            : running
            ? "Generating full research"
            : "Run full research"
        }
        /* B-57 min-h-[44px]: iPad touch target.
           B-88 hover:text-gold-300 lifts the CTA text from --brand
           (7.58:1 on bg-card, borderline AAA) to --gold-300 (9.89:1,
           AAA) so the hover state reads distinctly brighter. */
        className="min-h-[44px] rounded border border-[color:var(--border)] bg-transparent px-3 py-2 t-mono text-[11px] u-brand transition-colors hover:border-[color:var(--brand)] hover:text-gold-300 disabled:opacity-50"
      >
        {running ? (
          <>▸ Generating full research<LoadingDots inline /></>
        ) : (
          "▸ Run full research"
        )}
      </button>
      {error && (
        <p
          role="alert"
          data-slot="claude-thesis-error"
          className="mt-2 t-mono text-[11.5px] u-loss"
        >
          {isRateLimit
            ? retrySec > 0
              ? `Rate limited — try again in ${retrySec}s`
              : "Rate limit cleared — click to retry."
            : `Error · ${error.message}`}
        </p>
      )}
    </>
  );
}

/**
 * Round-4 (CLUSTER E/18): three loading dots — animated under default
 * motion preferences, statically rendered for users with
 * `prefers-reduced-motion: reduce` so they don't read as broken.
 *
 * `inline=true` makes the dots inline-flex so they sit next to button
 * text; the default block flow renders them in a `flex` row used inside
 * the structured-skeleton state.
 */
function LoadingDots({ inline = false }: { inline?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={
          (inline
            ? "motion-safe:inline-flex motion-reduce:hidden ml-1 items-center gap-1"
            : "motion-safe:flex motion-reduce:hidden items-center gap-1") +
          ""
        }
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand)] animate-pulse [animation-delay:300ms]" />
      </span>
      <span
        aria-hidden="true"
        className={
          inline
            ? "motion-safe:hidden motion-reduce:inline ml-1"
            : "motion-safe:hidden motion-reduce:flex"
        }
      >
        ·&nbsp;·&nbsp;·
      </span>
    </>
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
