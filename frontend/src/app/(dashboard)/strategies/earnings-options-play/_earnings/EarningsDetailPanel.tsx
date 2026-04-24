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

  return (
    <section
      data-slot="earnings-detail-panel"
      className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-4"
    >
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

      {detail.partial && (
        <p className="mt-3 font-mono text-[11px] text-[color:var(--fg-muted)]">
          Some fields partial — one or more providers were unavailable.
        </p>
      )}
    </section>
  );
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
