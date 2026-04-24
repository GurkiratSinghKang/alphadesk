"use client";

import { useEffect, useState } from "react";
import type { EarningsDetail } from "@/types";

import DetailHeader from "./DetailHeader";
import MetricsStrip from "./MetricsStrip";
import ClaudeThesisCard from "./ClaudeThesisCard";
import StrikeLadder from "./StrikeLadder";
import HistoricalMoves from "./HistoricalMoves";
import IVTermSkew from "./IVTermSkew";
import NewsFeed from "./NewsFeed";
import TradeButtonRow from "./TradeButtonRow";

export interface EarningsDetailPanelProps {
  detail: EarningsDetail | null;
  loading: boolean;
  error: string | null;
  runningFull: boolean;
  onRunFullResearch: () => void;
}

/**
 * V2 layout — two columns at ≥1200px panel width, collapses to V1 stacked
 * below. Sub-panels slot into consistent vertical rhythm via the editorial
 * tokens.
 */
export default function EarningsDetailPanel({
  detail, loading, error, runningFull, onRunFullResearch,
}: EarningsDetailPanelProps) {
  const isWide = useIsWide(1200);

  if (error) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <div role="alert">
          <p className="font-mono text-[13px] text-[color:var(--fg-neg)]">Error · {error}</p>
        </div>
      </section>
    );
  }
  if (loading && !detail) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading detail…</p>
        </div>
      </section>
    );
  }
  if (!detail) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Select a symbol from the sidebar.</p>
      </section>
    );
  }

  // Missing-field hints may be populated later by the backend (Agent α's
  // B-81 work). Read defensively — fall back to a generic banner.
  const missingFields = extractMissingFields(detail);

  return (
    <section
      data-slot="earnings-detail-panel"
      className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-4"
    >
      {detail.partial && (
        <div
          data-slot="partial-data-banner"
          role="status"
          aria-live="polite"
          className="mb-3 rounded border border-[color:var(--warn,#d97706)] bg-[color:var(--warn-tint,rgba(217,119,6,0.12))] px-3 py-2"
        >
          <p className="font-mono text-[12px] text-[color:var(--warn,#d97706)]">
            ⚠ Partial data — some providers were unavailable.
          </p>
          {missingFields && missingFields.length > 0 ? (
            <p className="mt-1 font-mono text-[11px] u-muted">
              Missing: {missingFields.join(", ")}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11px] u-muted">
              Some data unavailable — see fields marked —
            </p>
          )}
        </div>
      )}
      <DetailHeader
        symbol={detail.symbol} company={detail.company} sector={detail.sector}
        report_date={detail.report_date} report_time={detail.report_time}
        quote={detail.quote} generated_at={detail.generated_at}
      />
      <MetricsStrip metrics={detail.metrics} />

      {isWide ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Left column: thesis + news */}
          <div className="min-w-0 space-y-3">
            <ClaudeThesisCard
              structured={detail.claude_structured} full={detail.claude_full_research}
              running={runningFull} onRunFull={onRunFullResearch}
            />
            <NewsFeed news={detail.news} />
          </div>
          {/* Right column: ladder + historical + term/skew */}
          <div className="min-w-0 space-y-3">
            <StrikeLadder ladder={detail.strike_ladder} />
            <HistoricalMoves historical={detail.historical_earnings} />
            <IVTermSkew term={detail.iv_term_structure} skew={detail.skew} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <ClaudeThesisCard
            structured={detail.claude_structured} full={detail.claude_full_research}
            running={runningFull} onRunFull={onRunFullResearch}
          />
          <StrikeLadder ladder={detail.strike_ladder} />
          <HistoricalMoves historical={detail.historical_earnings} />
          <IVTermSkew term={detail.iv_term_structure} skew={detail.skew} />
          <NewsFeed news={detail.news} />
        </div>
      )}

      <TradeButtonRow symbol={detail.symbol} ladder={detail.strike_ladder} />
    </section>
  );
}

/**
 * Pull an optional list of missing-field names off the detail payload.
 * Agent α's B-81 work may add `missing_fields` or `validation_errors`
 * to the schema — read without hard-typing so we surface whichever
 * lands without pushing types/index.ts changes through this bundle.
 */
function extractMissingFields(detail: EarningsDetail): string[] | null {
  const raw = detail as unknown as {
    missing_fields?: unknown;
    validation_errors?: unknown;
  };
  const src = raw.missing_fields ?? raw.validation_errors;
  if (!Array.isArray(src)) return null;
  const out = src.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Track whether the viewport (or the panel's container ideally — but
 * without a ResizeObserver setup we use window width as a proxy) is wider
 * than `px`. Panel-width comes out close to viewport-width minus 280px
 * sidebar, so viewport >= 1480 ≈ panel >= 1200.
 */
function useIsWide(panelThresholdPx: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const viewportThreshold = panelThresholdPx + 300; // +sidebar+gutters
    const check = () => setWide(window.innerWidth >= viewportThreshold);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [panelThresholdPx]);
  return wide;
}
