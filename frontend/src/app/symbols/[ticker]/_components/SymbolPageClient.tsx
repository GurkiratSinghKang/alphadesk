"use client";

import type { Quote } from "@/types";

import { useSymbolPageData } from "../_hooks/useSymbolPageData";
import { ChartBand } from "../_sections/ChartBand";
import { DecisionStrip, type DecisionStripMarketRegime } from "../_sections/DecisionStrip";
import { NotFound } from "../_sections/NotFound";
import { OptionsThesisBand } from "../_sections/OptionsThesisBand";
import { StickyBand, type StickyBandQuote } from "../_sections/StickyBand";
import { UnsupportedAsset } from "../_sections/UnsupportedAsset";

export interface SymbolPageClientProps {
  symbol: string;
}

function pickNumber(value: Record<string, unknown>, key: keyof Quote): number | undefined {
  const raw = value[key as string];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function pickString(value: Record<string, unknown>, key: keyof Quote): string | undefined {
  const raw = value[key as string];
  return typeof raw === "string" ? raw : undefined;
}

function envelopeToQuote(value: Record<string, unknown> | null | undefined): StickyBandQuote | null {
  if (!value || typeof value !== "object") return null;
  const last = value.last;
  if (typeof last !== "number" || !Number.isFinite(last)) return null;

  const session = pickString(value, "session");
  const extendedSession = pickString(value, "extended_session");

  return {
    last,
    change: pickNumber(value, "change"),
    changePct: pickNumber(value, "changePct"),
    timestamp: pickNumber(value, "timestamp"),
    extended_price: pickNumber(value, "extended_price"),
    extended_change: pickNumber(value, "extended_change"),
    extended_change_pct: pickNumber(value, "extended_change_pct"),
    extended_session:
      extendedSession === "pre" || extendedSession === "post" ? extendedSession : null,
    last_trade_time: pickString(value, "last_trade_time") ?? null,
    session:
      session === "pre" || session === "regular" || session === "post" || session === "closed"
        ? session
        : null,
  };
}

function envelopeToMarketRegime(
  value: Record<string, unknown> | null | undefined,
): DecisionStripMarketRegime | null {
  if (!value || typeof value !== "object") return null;
  const summary = typeof value.summary === "string" ? value.summary : null;
  const regime = typeof value.regime === "string" ? value.regime : summary;
  const label = typeof value.label === "string" ? value.label : summary;
  const vix = typeof value.vix_level === "number" ? value.vix_level : null;
  if (!regime && !label && vix == null) return null;
  return { regime, label, vix_level: vix };
}

export function SymbolPageClient({ symbol }: SymbolPageClientProps) {
  const data = useSymbolPageData(symbol);

  if (data.isCryptoForex) {
    return <UnsupportedAsset symbol={symbol} />;
  }

  if (!data.isLoading && data.symbolMeta === null) {
    return <NotFound symbol={symbol} />;
  }

  const ctxData = data.ctx.data?.symbols?.[symbol] ?? null;
  const quote = envelopeToQuote(ctxData?.quote?.value);
  const marketRegime = envelopeToMarketRegime(ctxData?.marketRegime?.value);

  const claudeStructured = data.earningsDetail?.claudeStructured ?? null;
  const claudeFullResearch = data.earningsDetail?.claudeFullResearch ?? null;
  const ivTermStructure = data.earningsDetail?.ivTermStructure ?? null;
  const skew = data.earningsDetail?.skew ?? null;
  const metrics = data.earningsDetail?.metrics ?? null;

  return (
    <main data-testid="symbol-page" data-sym={symbol}>
      <StickyBand symbol={symbol} quote={quote}>
        <DecisionStrip
          symbol={symbol}
          claudeStructured={claudeStructured}
          analysis={data.analysis}
          marketRegime={marketRegime}
        />
      </StickyBand>

      <ChartBand
        symbol={symbol}
        bars={data.bars}
        name={data.symbolMeta?.name ?? null}
        quote={quote}
      />

      <OptionsThesisBand
        symbol={symbol}
        ivData={data.ivData}
        claudeStructured={claudeStructured}
        claudeFullResearch={claudeFullResearch}
        ivTermStructure={ivTermStructure}
        skew={skew}
        metrics={metrics}
        analysisSummary={data.analysis?.summary ?? null}
        isETF={data.isETF}
      />
    </main>
  );
}

export default SymbolPageClient;
