"use client";

import type { Quote } from "@/types";

import { useSymbolPageData } from "../_hooks/useSymbolPageData";
import { ChartBand } from "../_sections/ChartBand";
import { DecisionStrip, type DecisionStripMarketRegime } from "../_sections/DecisionStrip";
import { NotFound } from "../_sections/NotFound";
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

  return (
    <main data-testid="symbol-page" data-sym={symbol}>
      <StickyBand symbol={symbol} quote={quote}>
        <DecisionStrip
          symbol={symbol}
          claudeStructured={null}
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

      {data.isETF ? (
        <aside
          data-testid="etf-thesis-placeholder"
          data-slot="etf-thesis-placeholder"
          className="mx-auto max-w-3xl px-4 py-8 text-center sm:px-6 t-mono u-muted"
        >
          AI thesis available for individual equities only. ETF analysis coming in a future update.
        </aside>
      ) : null}
    </main>
  );
}

export default SymbolPageClient;
