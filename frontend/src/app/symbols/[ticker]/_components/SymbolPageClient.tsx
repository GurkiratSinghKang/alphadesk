"use client";

import Link from "next/link";
import type { EarningsNewsArticle, OHLCVBar, Quote } from "@/types";

import { useSymbolPageData } from "../_hooks/useSymbolPageData";
import { AboutSection } from "../_sections/AboutSection";
import { AgentsDebateCard } from "../_sections/AgentsDebateCard";
import { ChartBand } from "../_sections/ChartBand";
import { DecisionStrip, type DecisionStripMarketRegime } from "../_sections/DecisionStrip";
import { EarningsPanel } from "../_sections/EarningsPanel";
import { IVStatRow } from "../_sections/IVStatRow";
import { KeyStats } from "../_sections/KeyStats";
import { NewsBand } from "../_sections/NewsBand";
import { NotFound } from "../_sections/NotFound";
import { OptionsThesisBand } from "../_sections/OptionsThesisBand";
import { RecommendedSetups } from "../_sections/RecommendedSetups";
import { StickyBand, type StickyBandQuote } from "../_sections/StickyBand";
import { StrategyReverseLookup } from "../_sections/StrategyReverseLookup";
import { UnsupportedAsset } from "../_sections/UnsupportedAsset";
// v2 phase 1.3 — 5-tab navigation per v2-plan §1.3. Tabs are rendered
// below the sticky band; URL-state-backed via ?tab=… so deep links
// + back/forward work. Existing sections are reused; the tab pivot
// only changes which sections render at any one time.
import SymbolTabs, { useSymbolTab } from "../_v2/SymbolTabs";

export interface SymbolPageClientProps {
  symbol: string;
}

const LISTED_TICKER_PATTERN = /^[A-Z][A-Z0-9]{0,4}(?:[.-][A-Z0-9]{1,2})?$/;

interface PublicSymbolProfile {
  name: string;
  sector: string;
  focus: string;
  basePrice: number;
}

const PUBLIC_SYMBOL_PROFILES: Record<string, PublicSymbolProfile> = {
  AAPL: { name: "Apple Inc.", sector: "Consumer hardware", focus: "Devices, services, cash flow", basePrice: 196 },
  MSFT: { name: "Microsoft Corp.", sector: "Cloud software", focus: "Azure, AI, enterprise seats", basePrice: 442 },
  NVDA: { name: "NVIDIA Corp.", sector: "Semiconductors", focus: "AI accelerators, data centers", basePrice: 124 },
  AMZN: { name: "Amazon.com Inc.", sector: "Consumer internet", focus: "AWS, retail margins, ads", basePrice: 186 },
  GOOGL: { name: "Alphabet Inc.", sector: "Search and AI", focus: "Search, cloud, AI capex", basePrice: 172 },
  META: { name: "Meta Platforms", sector: "Social platforms", focus: "Ads, reels, AI infra", basePrice: 518 },
  AVGO: { name: "Broadcom Inc.", sector: "Semiconductors", focus: "Networking silicon, VMware", basePrice: 139 },
  TSLA: { name: "Tesla Inc.", sector: "Electric vehicles", focus: "Deliveries, margins, autonomy", basePrice: 182 },
  LLY: { name: "Eli Lilly", sector: "Pharma", focus: "GLP-1 demand, pipeline", basePrice: 812 },
  JPM: { name: "JPMorgan Chase", sector: "Banks", focus: "Credit, deposits, NII", basePrice: 218 },
  V: { name: "Visa Inc.", sector: "Payments", focus: "Cross-border volume", basePrice: 276 },
  NFLX: { name: "Netflix Inc.", sector: "Streaming", focus: "Ads, subscribers, pricing", basePrice: 642 },
};

// All four originally-stubbed sections now ship live: Strategy reverse
// lookup, Agents debate, Key stats, and About (company description +
// sector/industry). Analyst ratings + peers are deferred until a richer
// data provider lands. The env-flag helper below is dormant — kept in
// place so future stubs can opt in without re-introducing the gate.
// Re-enable by setting NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS=true.
// Read inside the function so tests that mutate process.env observe the change.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function showPlaceholderStubs(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS === "true";
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

function hasListedTickerShape(symbol: string): boolean {
  return LISTED_TICKER_PATTERN.test(symbol.toUpperCase());
}

function profileForSymbol(symbol: string): PublicSymbolProfile {
  const upper = symbol.toUpperCase();
  return PUBLIC_SYMBOL_PROFILES[upper] ?? {
    name: upper,
    sector: "US listed ticker",
    focus: "Quote, chart, research, and strategy context",
    basePrice: 100 + (stableHash(upper) % 240),
  };
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function makePreviewQuote(symbol: string): StickyBandQuote {
  const profile = profileForSymbol(symbol);
  const hash = stableHash(symbol.toUpperCase());
  const direction = hash % 2 === 0 ? 1 : -1;
  const changePct = direction * (0.25 + (hash % 180) / 100);
  const change = Number((profile.basePrice * (changePct / 100)).toFixed(2));
  const last = Number((profile.basePrice + change).toFixed(2));
  const timestamp = Date.now();
  return {
    ask: Number((last + 0.03).toFixed(2)),
    askSize: 10 + (hash % 20),
    bid: Number((last - 0.03).toFixed(2)),
    bidSize: 8 + (hash % 18),
    change,
    changePct,
    close: profile.basePrice,
    high: Number((last * 1.012).toFixed(2)),
    last,
    last_trade_time: new Date(timestamp).toISOString(),
    low: Number((last * 0.988).toFixed(2)),
    open: profile.basePrice,
    regular_close_price: profile.basePrice,
    session: "closed",
    symbol: symbol.toUpperCase(),
    timestamp,
    volume: 1_000_000 + (hash % 12_000_000),
  };
}

function makePreviewBars(symbol: string): OHLCVBar[] {
  const profile = profileForSymbol(symbol);
  const hash = stableHash(symbol.toUpperCase());
  const bars: OHLCVBar[] = [];
  const now = new Date();
  now.setUTCHours(20, 0, 0, 0);
  let price = profile.basePrice * (0.94 + (hash % 12) / 100);
  for (let i = 59; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - i);
    const wave = Math.sin((60 - i + (hash % 9)) / 5) * 0.009;
    const drift = 0.0008 + ((hash % 7) - 3) * 0.00008;
    const open = price;
    const close = price * (1 + drift + wave);
    const high = Math.max(open, close) * 1.006;
    const low = Math.min(open, close) * 0.994;
    bars.push({
      close: Number(close.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      open: Number(open.toFixed(2)),
      time: Math.floor(day.getTime() / 1000),
      volume: 800_000 + ((hash + i * 97) % 8_500_000),
    });
    price = close;
  }
  return bars;
}

export function SymbolPageClient({ symbol }: SymbolPageClientProps) {
  const data = useSymbolPageData(symbol);
  // v2 phase 1.3 — active tab from URL ?tab=… ; defaults to overview.
  const [activeTab, setActiveTab] = useSymbolTab();

  if (data.isCryptoForex) {
    return <UnsupportedAsset symbol={symbol} />;
  }

  // Audit fix: don't NotFound just because `symbolMeta` is null. The
  // search index doesn't always carry every valid ticker (BRK.B,
  // recently-listed names, dot-suffix symbols) — render whatever data
  // the spine and per-symbol queries return. NotFound now requires the
  // page to be done loading AND every primary data source to be empty.
  const ctxData = data.ctx.data?.symbols?.[symbol] ?? null;
  const newsFromContext = envelopeToNewsArticles(ctxData?.news?.value);
  const hasAnyData =
    data.symbolMeta != null ||
    ctxData?.quote?.value != null ||
    (data.bars && data.bars.length > 0) ||
    data.analysis != null ||
    data.ivData != null ||
    data.earningsDetail != null ||
    (data.recommendedSetups != null && data.recommendedSetups.length > 0) ||
    (newsFromContext != null && newsFromContext.length > 0);

  if (!data.isLoading && !hasAnyData && !hasListedTickerShape(symbol)) {
    return <NotFound symbol={symbol} />;
  }

  if (!data.isLoading && !hasAnyData && !data.authBlocked && !data.dataUnavailable) {
    return <NotFound symbol={symbol} />;
  }

  const quote = envelopeToQuote(ctxData?.quote?.value);
  const canShowPublicPreview =
    hasListedTickerShape(symbol) &&
    (data.authBlocked || data.dataUnavailable) &&
    quote == null &&
    (!data.bars || data.bars.length === 0);
  const previewQuote = canShowPublicPreview ? makePreviewQuote(symbol) : null;
  const previewBars = canShowPublicPreview ? makePreviewBars(symbol) : null;
  const effectiveQuote = quote ?? previewQuote;
  const effectiveBars = data.bars && data.bars.length > 0 ? data.bars : previewBars ?? data.bars;
  const marketRegime = envelopeToMarketRegime(ctxData?.marketRegime?.value);
  const newsArticles =
    newsFromContext ?? data.earningsDetail?.news ?? null;

  const claudeStructured = data.earningsDetail?.claudeStructured ?? null;
  const claudeFullResearch = data.earningsDetail?.claudeFullResearch ?? null;
  const ivTermStructure = data.earningsDetail?.ivTermStructure ?? null;
  const skew = data.earningsDetail?.skew ?? null;
  const metrics = data.earningsDetail?.metrics ?? null;

  const limitedMetadata = !data.authBlocked && !data.isLoading && data.symbolMeta === null;
  const publicProfile = profileForSymbol(symbol);
  const title = data.symbolMeta?.name ?? symbol;
  const chartName = data.symbolMeta?.name ?? publicProfile.name;

  return (
    <main id="main" data-testid="symbol-page" data-sym={symbol}>
      <a
        className="sr-only focus:not-sr-only fixed left-3 top-3 z-50 rounded-sm bg-primary px-3 py-2 text-label font-semibold text-primary-foreground shadow-lg"
        href="#chart"
      >
        Skip to chart
      </a>
      <header
        className="border-b border-border-hair px-4 py-5 sm:px-6"
        style={{ background: "var(--ink-100)" }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <nav aria-label="Ticker breadcrumbs">
              <Link
                href="/symbols"
                className="t-eyebrow-italic transition-colors hover:text-primary"
                style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
              >
                SYMBOLS · {symbol.toUpperCase()}
              </Link>
            </nav>
            <h1
              className="m-0 mt-2 italic truncate"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--ink-1000)",
                fontSize: 44,
                fontWeight: 400,
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
              }}
            >
              {title}
            </h1>
          </div>
          <p
            className="italic max-w-xl"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 14.5,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              marginTop: 6,
            }}
          >
            Ticker workspace for {symbol.toUpperCase()}: chart, market context, options thesis,
            strategy lookup, and research surfaces.
          </p>
        </div>
      </header>
      {data.authBlocked ? (
        <div
          data-testid="symbol-auth-note"
          className="mx-4 sm:mx-6 mb-2 mt-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 t-mono text-label text-primary"
        >
          Sign in to load live quotes, charts, and AI research for {symbol}.{" "}
          <Link href="/login" className="underline underline-offset-4 hover:text-fg">
            Open workspace
          </Link>
        </div>
      ) : null}
      {data.dataUnavailable ? (
        <div
          data-testid="symbol-data-note"
          className="mx-4 sm:mx-6 mb-2 mt-2 rounded-md border border-amber/35 bg-amber/10 px-3 py-2 t-mono text-label text-fg-muted"
        >
          Market data is temporarily unavailable for {symbol}. The ticker workspace remains open.
        </div>
      ) : null}
      {canShowPublicPreview ? (
        <section
          data-testid="symbol-preview-note"
          className="mx-4 sm:mx-6 mb-2 mt-2 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="t-label u-muted">Public preview</p>
              <p className="mt-1 t-mono text-body-sm text-fg">
                {publicProfile.sector} · {publicProfile.focus}
              </p>
            </div>
            <Link
              href="/login"
              className="t-mono text-label text-primary underline underline-offset-4 hover:text-fg"
            >
              Load live workspace
            </Link>
          </div>
        </section>
      ) : null}
      {limitedMetadata ? (
        <div
          data-testid="limited-metadata-note"
          className="mx-4 sm:mx-6 mb-2 mt-2 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2 t-mono text-label u-muted"
        >
          Limited metadata available for {symbol}.
        </div>
      ) : null}
      <StickyBand symbol={symbol} quote={effectiveQuote}>
        <DecisionStrip
          symbol={symbol}
          claudeStructured={claudeStructured}
          analysis={data.analysis}
          marketRegime={marketRegime}
        />
      </StickyBand>

      {/* v2 phase 1.3 — 5-tab navigation. Sections below are routed by
       * `activeTab` per v2-plan §1.3. Existing components (ChartBand,
       * OptionsThesisBand, RecommendedSetups, StrategyReverseLookup,
       * EarningsPanel, AgentsDebateCard, NewsBand, AboutSection) are
       * preserved — the pivot only changes which set renders. */}
      <SymbolTabs active={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" && (
        <div role="tabpanel" id="symbol-tab-panel-overview" aria-labelledby="symbol-tab-overview">
          <ChartBand
            symbol={symbol}
            bars={effectiveBars}
            name={chartName}
            quote={effectiveQuote}
            dataMode={canShowPublicPreview ? "preview" : "live"}
          />
          <RecommendedSetups
            symbol={symbol}
            setups={data.recommendedSetups}
            isETF={data.isETF}
            underlying={effectiveQuote?.last ?? null}
          />
          <StrategyReverseLookup symbol={symbol} />
        </div>
      )}

      {activeTab === "fundamentals" && (
        <div role="tabpanel" id="symbol-tab-panel-fundamentals" aria-labelledby="symbol-tab-fundamentals">
          {/* v2 phase 1.3 — KeyStats row (revenue/margins/FCF/ratios)
            * sits at the top of Fundamentals per design ticker.jsx so the
            * tab opens to the numbers, not the earnings calendar. */}
          <KeyStats symbol={symbol} />
          <div className="px-4 sm:px-6 py-4">
            <EarningsPanel
              isETF={data.isETF}
              historicalEarnings={data.earningsDetail?.historicalEarnings ?? null}
              ivTermStructure={ivTermStructure}
              nextReportDate={data.earningsDetail?.reportDate ?? null}
              nextReportTime={data.earningsDetail?.reportTime ?? null}
            />
          </div>
          <AboutSection symbol={symbol} />
        </div>
      )}

      {activeTab === "news" && (
        <div role="tabpanel" id="symbol-tab-panel-news" aria-labelledby="symbol-tab-news">
          <NewsBand news={newsArticles} />
        </div>
      )}

      {activeTab === "options" && (
        <div role="tabpanel" id="symbol-tab-panel-options" aria-labelledby="symbol-tab-options" className="px-4 sm:px-6 py-4 flex flex-col gap-4">
          {/* v2 phase 1.3 — IV stat row tops the Options tab so IV/IVR/IVP
            * + HV terms + expected move read at a glance before the deeper
            * thesis. Mirrors design ticker.jsx Options-tab metrics row. */}
          <IVStatRow ivData={data.ivData} metrics={metrics} />
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
        </div>
      )}

      {activeTab === "history" && (
        <div role="tabpanel" id="symbol-tab-panel-history" aria-labelledby="symbol-tab-history">
          <div className="px-4 sm:px-6 py-4">
            <AgentsDebateCard symbol={symbol} isETF={data.isETF} />
          </div>
        </div>
      )}
    </main>
  );
}

export default SymbolPageClient;
