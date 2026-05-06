"use client";

import AIThesisCard from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/AIThesisCard";
import IVTermSkew from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew";
import type {
  ClaudeFullResearch,
  ClaudeStructured,
  EarningsMetricsBlock,
  IVTermPoint,
  SkewBlock,
} from "@/types";

import type { IVDataResult } from "../_hooks/useSymbolPageData";
import { IVStatRow } from "./IVStatRow";

export interface OptionsThesisBandProps {
  symbol: string;
  ivData: IVDataResult | null;
  claudeStructured: ClaudeStructured | null;
  claudeFullResearch: ClaudeFullResearch | null;
  ivTermStructure?: IVTermPoint[] | null;
  skew?: SkewBlock | null;
  metrics?: EarningsMetricsBlock | null;
  analysisSummary?: string | null;
  isETF: boolean;
}

export function OptionsThesisBand({
  symbol,
  ivData,
  claudeStructured,
  claudeFullResearch,
  ivTermStructure = null,
  skew = null,
  metrics = null,
  analysisSummary = null,
  isETF,
}: OptionsThesisBandProps) {
  const showIV = !!ivData && ivData.currentIV != null;

  return (
    <section
      data-testid="options-thesis-band"
      className="grid grid-cols-1 gap-4 px-4 py-6 sm:px-6 xl:grid-cols-2"
    >
      {showIV ? (
        <article
          id="options"
          data-testid="options-section"
          data-slot="options-section"
          className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
        >
          <h2 className="t-label u-muted">OPTIONS</h2>
          <div className="mt-3">
            <IVStatRow ivData={ivData} metrics={metrics} />
          </div>
          {ivTermStructure != null || skew != null ? (
            <IVTermSkew term={ivTermStructure ?? null} skew={skew ?? null} />
          ) : null}
        </article>
      ) : null}

      <article
        id="thesis"
        data-testid="thesis-section"
        data-slot="thesis-section"
        className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
      >
        <h2 className="t-label u-muted">AI THESIS</h2>
        <div className="mt-3">
          {claudeStructured != null ? (
            <AIThesisCard
              structured={claudeStructured}
              full={claudeFullResearch}
              running={false}
              onRunFull={() => {}}
              symbol={symbol}
              showRunControls={false}
            />
          ) : analysisSummary != null && analysisSummary.length > 0 ? (
            <div data-slot="quick-analysis-card">
              <p className="t-label u-brand">QUICK ANALYSIS</p>
              <p className="mt-2 font-sans text-body-sm leading-relaxed">
                {analysisSummary}
              </p>
            </div>
          ) : (
            <p
              data-testid="thesis-empty-state"
              className="t-mono text-body-sm u-muted"
            >
              {isETF
                ? "AI thesis available for individual equities only. ETF analysis coming in a future update."
                : "AI thesis is not available for this symbol yet."}
            </p>
          )}
        </div>
      </article>
    </section>
  );
}

export default OptionsThesisBand;
