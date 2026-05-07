"use client";

import type { EarningsNewsArticle, Quote } from "@/types";

import { useSymbolPageData } from "../_hooks/useSymbolPageData";
import { AboutAnalystPeersStub } from "../_sections/AboutAnalystPeersStub";
import { AgentsDebateStub } from "../_sections/AgentsDebateStub";
import { ChartBand } from "../_sections/ChartBand";
import { DecisionStrip, type DecisionStripMarketRegime } from "../_sections/DecisionStrip";
import { EarningsPanel } from "../_sections/EarningsPanel";
import { NewsBand } from "../_sections/NewsBand";
import { NotFound } from "../_sections/NotFound";
import { OptionsThesisBand } from "../_sections/OptionsThesisBand";
import { RecommendedSetups } from "../_sections/RecommendedSetups";
import { StickyBand, type StickyBandQuote } from "../_sections/StickyBand";
import { StrategyReverseLookupStub } from "../_sections/StrategyReverseLookupStub";
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

// T9: ctx.news.value is a raw NewsResponse ({articles: [...], ...}) with
// snake_case article fields. Earnings detail's news is already mapped to
// camelCase but is gated to the curated equity universe — sourcing from
// the spine envelope means ETFs and other broadly-tracked symbols still
// surface a news rail.
function envelopeToNewsArticles(
  value: Record<string, unknown> | null | undefined,
): EarningsNewsArticle[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value.articles;
  if (!Array.isArray(raw)) return null;
  const out: EarningsNewsArticle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const title = a.title;
    const url = a.url;
    const source = a.source;
    const publishedAt = a.published_at;
    if (
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof source !== "string" ||
      typeof publishedAt !== "string"
    ) {
      continue;
    }
    const relevance = a.relevance_score;
    const tier = a.tier;
    const category = a.category;
    const sentiment = a.sentiment;
    out.push({
      title,
      url,
      source,
      publishedAt,
      relevanceScore: typeof relevance === "number" ? relevance : 0,
      tier: typeof tier === "number" ? tier : 2,
      category: typeof category === "string" ? category : null,
      sentiment: typeof sentiment === "string" ? sentiment : null,
    });
  }
  return out;
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

  // Audit fix: don't NotFound just because `symbolMeta` is null. The
  // search index doesn't always carry every valid ticker (BRK.B,
  // recently-listed names, dot-suffix symbols) — render whatever data
  // the spine and per-symbol queries return. NotFound now requires the
  // page to be done loading AND every primary data source to be empty.
  const ctxData = data.ctx.data?.symbols?.[symbol] ?? null;
  const hasAnyData =
    data.symbolMeta != null ||
    ctxData?.quote?.value != null ||
    (data.bars && data.bars.length > 0) ||
    data.analysis != null ||
    data.ivData != null;

  if (!data.isLoading && !hasAnyData) {
    return <NotFound symbol={symbol} />;
  }

  const quote = envelopeToQuote(ctxData?.quote?.value);
  const marketRegime = envelopeToMarketRegime(ctxData?.marketRegime?.value);
  const newsArticles =
    envelopeToNewsArticles(ctxData?.news?.value) ?? data.earningsDetail?.news ?? null;

  const claudeStructured = data.earningsDetail?.claudeStructured ?? null;
  const claudeFullResearch = data.earningsDetail?.claudeFullResearch ?? null;
  const ivTermStructure = data.earningsDetail?.ivTermStructure ?? null;
  const skew = data.earningsDetail?.skew ?? null;
  const metrics = data.earningsDetail?.metrics ?? null;

  const limitedMetadata = !data.isLoading && data.symbolMeta === null;

  return (
    <main data-testid="symbol-page" data-sym={symbol}>
      {limitedMetadata ? (
        <div
          data-testid="limited-metadata-note"
          className="mx-4 sm:mx-6 mb-2 mt-2 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2 t-mono text-label u-muted"
        >
          Limited metadata available for {symbol}.
        </div>
      ) : null}
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

      <RecommendedSetups
        symbol={symbol}
        setups={data.recommendedSetups}
        isETF={data.isETF}
        underlying={quote?.last ?? null}
      />

      <StrategyReverseLookupStub />

      <div
        data-slot="agents-earnings-row"
        className="grid grid-cols-1 gap-4 px-4 sm:px-6 mb-6 xl:grid-cols-2"
      >
        <AgentsDebateStub />
        <EarningsPanel
          isETF={data.isETF}
          historicalEarnings={data.earningsDetail?.historicalEarnings ?? null}
          ivTermStructure={ivTermStructure}
          nextReportDate={data.earningsDetail?.reportDate ?? null}
          nextReportTime={data.earningsDetail?.reportTime ?? null}
        />
      </div>

      <NewsBand news={newsArticles} />

      <AboutAnalystPeersStub />
    </main>
  );
}

export default SymbolPageClient;
