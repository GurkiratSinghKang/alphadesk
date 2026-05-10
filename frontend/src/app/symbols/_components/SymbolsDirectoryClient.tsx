"use client";

import {
  ArrowRight,
  Buildings,
  ChartLineUp,
  House,
  MagnifyingGlass,
  TrendUp,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { getSnapshots, searchSymbols } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Quote } from "@/types";

interface TopCompany {
  symbol: string;
  name: string;
  sector: string;
  venue: string;
  focus: string;
  liquidity: string;
}

interface SymbolResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  sector: string;
}

type SearchState = "idle" | "loading" | "ready" | "error";

const TOP_COMPANIES: TopCompany[] = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    sector: "Consumer hardware",
    venue: "NASDAQ",
    focus: "Devices, services, cash flow",
    liquidity: "Mega cap",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    sector: "Cloud software",
    venue: "NASDAQ",
    focus: "Azure, AI, enterprise seats",
    liquidity: "Mega cap",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    sector: "Semiconductors",
    venue: "NASDAQ",
    focus: "AI accelerators, data centers",
    liquidity: "Mega cap",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc.",
    sector: "Consumer internet",
    venue: "NASDAQ",
    focus: "AWS, retail margins, ads",
    liquidity: "Mega cap",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    sector: "Search and AI",
    venue: "NASDAQ",
    focus: "Search, cloud, AI capex",
    liquidity: "Mega cap",
  },
  {
    symbol: "META",
    name: "Meta Platforms",
    sector: "Social platforms",
    venue: "NASDAQ",
    focus: "Ads, reels, AI infra",
    liquidity: "Mega cap",
  },
  {
    symbol: "AVGO",
    name: "Broadcom Inc.",
    sector: "Semiconductors",
    venue: "NASDAQ",
    focus: "Networking silicon, VMware",
    liquidity: "Mega cap",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    sector: "Electric vehicles",
    venue: "NASDAQ",
    focus: "Deliveries, margins, autonomy",
    liquidity: "Mega cap",
  },
  {
    symbol: "LLY",
    name: "Eli Lilly",
    sector: "Pharma",
    venue: "NYSE",
    focus: "GLP-1 demand, pipeline",
    liquidity: "Mega cap",
  },
  {
    symbol: "JPM",
    name: "JPMorgan Chase",
    sector: "Banks",
    venue: "NYSE",
    focus: "Credit, deposits, NII",
    liquidity: "Mega cap",
  },
  {
    symbol: "V",
    name: "Visa Inc.",
    sector: "Payments",
    venue: "NYSE",
    focus: "Cross-border volume",
    liquidity: "Mega cap",
  },
  {
    symbol: "NFLX",
    name: "Netflix Inc.",
    sector: "Streaming",
    venue: "NASDAQ",
    focus: "Ads, subscribers, pricing",
    liquidity: "Large cap",
  },
];

const TOP_SYMBOLS = TOP_COMPANIES.map((company) => company.symbol);
const PUBLIC_SYMBOL_DATA_OPTIONS = {
  suppressAuthRedirect: true,
  suppressGlobalError: true,
} as const;
const DIRECT_TICKER_PATTERN = /^[A-Z][A-Z0-9]{0,4}(?:[.-][A-Z0-9]{1,2})?$/;

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function quoteFor(quotes: Record<string, Quote>, symbol: string): Quote | undefined {
  return quotes[symbol] ?? quotes[symbol.toUpperCase()] ?? quotes[symbol.toLowerCase()];
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatVolume(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

function formatChangePct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function changeTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-fg-muted";
  if (value > 0) return "text-profit";
  if (value < 0) return "text-down-500";
  return "text-fg-muted";
}

function toCompanyResult(result: SymbolResult): TopCompany {
  return {
    symbol: normalizeSymbol(result.symbol),
    name: result.name || result.symbol,
    sector: result.sector || result.type || "Equity",
    venue: result.exchange || "US",
    focus: result.type ? `${result.type} instrument` : "Symbol detail",
    liquidity: result.exchange || "Market",
  };
}

function topCompanyToResult(company: TopCompany): SymbolResult {
  return {
    exchange: company.venue,
    name: company.name,
    sector: company.sector,
    symbol: company.symbol,
    type: "stock",
  };
}

function fallbackResultsForQuery(value: string, apiResults: SymbolResult[] = []): SymbolResult[] {
  const trimmed = value.trim();
  const q = trimmed.toLowerCase();
  const direct = normalizeSymbol(trimmed);
  const merged = new Map<string, SymbolResult>();

  for (const result of apiResults) {
    const symbol = normalizeSymbol(result.symbol);
    if (symbol) merged.set(symbol, { ...result, symbol });
  }

  for (const company of TOP_COMPANIES) {
    if (
      company.symbol.toLowerCase().includes(q) ||
      company.name.toLowerCase().includes(q) ||
      company.sector.toLowerCase().includes(q)
    ) {
      merged.set(company.symbol, topCompanyToResult(company));
    }
  }

  if (DIRECT_TICKER_PATTERN.test(direct) && !merged.has(direct)) {
    merged.set(direct, {
      exchange: "US",
      name: `${direct} ticker`,
      sector: "Equity",
      symbol: direct,
      type: "stock",
    });
  }

  return Array.from(merged.values());
}

export function SymbolsDirectoryClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SymbolResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const quoteWaitTimer = window.setTimeout(() => {
      if (!cancelled) {
        setQuotesLoading(false);
        setQuoteError("Quote feed is still loading");
      }
    }, 3200);

    getSnapshots(TOP_SYMBOLS, PUBLIC_SYMBOL_DATA_OPTIONS)
      .then((data) => {
        if (!cancelled) {
          const hasQuotes = TOP_SYMBOLS.some((symbol) => quoteFor(data, symbol));
          setQuotes(data);
          setQuoteError(hasQuotes ? null : "Quote feed returned no rows");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setQuotes({});
          setQuoteError(err.message || "Quotes unavailable");
        }
      })
      .finally(() => {
        window.clearTimeout(quoteWaitTimer);
        if (!cancelled) setQuotesLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(quoteWaitTimer);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchSymbols(trimmed, 8, PUBLIC_SYMBOL_DATA_OPTIONS)
        .then((results) => {
          if (!cancelled) {
            setSearchResults(fallbackResultsForQuery(trimmed, results));
            setSearchState("ready");
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setSearchResults(fallbackResultsForQuery(trimmed));
            setSearchError(err.message || "Search unavailable");
            setSearchState("error");
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setSearchResults([]);
      setSearchState("idle");
      setSearchError(null);
      return;
    }
    setSearchState("loading");
    setSearchError(null);
  }

  const visibleCompanies = useMemo(() => {
    const q = query.trim();
    if (!q) return TOP_COMPANIES;
    return searchResults.map(toCompanyResult).filter((company) => company.symbol);
  }, [query, searchResults]);

  const topMover = useMemo(() => {
    let best: { company: TopCompany; quote: Quote; score: number } | null = null;
    for (const company of TOP_COMPANIES) {
      const quote = quoteFor(quotes, company.symbol);
      if (!quote || typeof quote.changePct !== "number") continue;
      const score = Math.abs(quote.changePct);
      if (!best || score > best.score) best = { company, quote, score };
    }
    return best;
  }, [quotes]);

  function openSymbol(symbol: string) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    router.push(`/symbols/${encodeURIComponent(normalized)}`);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = visibleCompanies[0]?.symbol || query;
    openSymbol(first);
  }

  const searching = query.trim().length > 0;
  const searchLoading = searchState === "loading";
  const showEmpty = searching && !searchLoading && visibleCompanies.length === 0;

  return (
    <main
      id="main"
      className="min-h-[100dvh] bg-bg text-fg"
      data-testid="symbols-directory"
    >
      <a
        className="sr-only focus:not-sr-only fixed left-3 top-3 z-50 rounded-sm bg-primary px-3 py-2 text-label font-semibold text-primary-foreground shadow-lg"
        href="#symbol-search"
      >
        Skip to symbol search
      </a>
      <header className="border-b border-border/70 bg-bg/95 px-4 py-4 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-body-sm font-semibold text-fg transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
          >
            <span className="font-display italic text-primary">alpha</span>
            <span>AlphaDesk</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Research directory navigation">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-bg-elev-1 px-3 text-label font-medium text-fg-muted transition-colors hover:border-primary/50 hover:text-fg active:scale-[0.98]"
            >
              <House className="size-4" aria-hidden="true" />
              Dashboard
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 text-label font-semibold text-primary transition-colors hover:bg-primary/15 active:scale-[0.98]"
              data-testid="symbols-sign-in-link"
            >
              Sign in
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] gap-5 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-7 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 rounded-sm border border-border bg-bg-card shadow-[0_24px_80px_-64px_rgba(0,0,0,0.85)]">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-2">
                <p className="t-label u-brand">RESEARCH</p>
                <h1 className="text-h2 font-semibold text-fg">Find a market, then open its ticker page</h1>
                <p className="max-w-2xl text-body-sm text-fg-muted">
                  Browse top companies by default, search any ticker when you need it, and jump into the dedicated ticker workspace with one selection.
                </p>
              </div>
              <div className="flex min-w-[220px] items-center gap-2 rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2">
                <span className="flex size-2 rounded-full bg-profit shadow-[0_0_0_4px_rgba(110,155,45,0.12)]" aria-hidden="true" />
                <span className="t-mono text-label text-fg-muted">
                  {quotesLoading ? "Loading quotes" : quoteError ? "Ticker list ready" : "Live quotes loaded"}
                </span>
              </div>
            </div>

            <form className="mt-5" onSubmit={handleSubmit}>
              <label htmlFor="symbol-search" className="t-label text-fg-muted">
                Search ticker or company
              </label>
              <div className="mt-2 flex min-h-12 items-center gap-2 rounded-sm border border-border bg-bg px-3 transition-colors focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20">
                <MagnifyingGlass className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
                <input
                  id="symbol-search"
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  placeholder="AAPL, NVIDIA, JPM..."
                  className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-hint md:text-body-sm"
                  data-testid="symbols-search-input"
                  spellCheck={false}
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => handleQueryChange("")}
                    className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-elev-1 hover:text-fg active:scale-[0.96]"
                    aria-label="Clear symbol search"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-sm bg-primary px-2 text-label font-semibold text-primary-foreground transition-colors hover:bg-gold-300 active:scale-[0.98] sm:px-3"
                >
                  Open
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </form>

            {searchError ? (
              <div className="mt-3 flex items-start gap-2 rounded-sm border border-amber/35 bg-amber/10 px-3 py-2 text-label text-fg-muted">
                <WarningCircle className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden="true" />
                <span>Search fell back to the default company list.</span>
              </div>
            ) : null}
          </div>

          <div className="px-4 py-3 sm:px-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-body-sm font-semibold text-fg">
                  {searching ? "Search results" : "Top companies"}
                </h2>
                <p className="t-meta">
                  {searching
                    ? "Select a result to open its ticker workspace."
                    : "Default screen, ordered for fast research entry."}
                </p>
              </div>
              <span className="rounded-sm border border-border-hair bg-bg-elev-1 px-2 py-1 t-mono text-label text-fg-muted">
                {visibleCompanies.length} markets
              </span>
            </div>

            <div className="overflow-hidden rounded-sm border border-border-hair" data-testid="symbols-top-list">
              <div className="hidden grid-cols-[minmax(180px,1fr)_minmax(220px,1.1fr)_minmax(86px,0.55fr)_minmax(86px,0.55fr)_minmax(96px,0.55fr)_44px] gap-3 border-b border-border-hair bg-bg-elev-1 px-3 py-2 t-label text-fg-muted md:grid">
                <span>Symbol</span>
                <span>Focus</span>
                <span>Last</span>
                <span>Change</span>
                <span>Volume</span>
                <span className="sr-only">Open</span>
              </div>

              {searchLoading ? (
                <SymbolsSkeleton />
              ) : showEmpty ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-body-sm font-medium text-fg">No matching symbols</p>
                  <p className="mt-1 text-body-sm text-fg-muted">
                    Try a ticker, company name, or sector keyword.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border-hair">
                  {visibleCompanies.map((company) => {
                    const quote = quoteFor(quotes, company.symbol);
                    const tone = changeTone(quote?.changePct);
                    return (
                      <li key={company.symbol}>
                        <Link
                          href={`/symbols/${encodeURIComponent(company.symbol)}`}
                          className="group grid min-h-[74px] gap-2 px-3 py-3 transition-colors hover:bg-bg-elev-1 active:bg-bg-elev-2 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.1fr)_minmax(86px,0.55fr)_minmax(86px,0.55fr)_minmax(96px,0.55fr)_44px] md:items-center md:gap-3"
                          data-testid={`symbols-row-${company.symbol}`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-body-sm font-semibold text-fg">
                                {company.symbol}
                              </span>
                              <span className="rounded-sm border border-border-hair px-1.5 py-0.5 t-label text-fg-muted">
                                {company.venue}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-body-sm text-fg-muted">{company.name}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-body-sm leading-snug text-fg">{company.focus}</p>
                            <p className="mt-1 t-meta">{company.sector}</p>
                          </div>
                          <Metric label="Last" value={quotesLoading ? null : formatPrice(quote?.last)} />
                          <Metric
                            label="Change"
                            value={quotesLoading ? null : formatChangePct(quote?.changePct)}
                            className={tone}
                          />
                          <Metric label="Volume" value={quotesLoading ? null : formatVolume(quote?.volume)} />
                          <span className="hidden size-9 items-center justify-center rounded-sm border border-border-hair text-fg-muted transition-colors group-hover:text-fg md:inline-flex">
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className="rounded-sm border border-border bg-bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="t-label u-brand">MARKET BOARD</p>
                <h2 className="mt-2 text-body font-semibold text-fg">Fast entry rail</h2>
              </div>
              <ChartLineUp className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {TOP_COMPANIES.slice(0, 6).map((company) => {
                const quote = quoteFor(quotes, company.symbol);
                return (
                  <button
                    type="button"
                    key={company.symbol}
                    onClick={() => openSymbol(company.symbol)}
                    className="min-h-16 rounded-sm border border-border-hair bg-bg px-3 text-left transition-colors hover:border-primary/50 hover:bg-bg-elev-1 active:scale-[0.98]"
                  >
                    <span className="block font-mono text-body-sm font-semibold text-fg">{company.symbol}</span>
                    <span className={cn("mt-1 block t-label", changeTone(quote?.changePct))}>
                      {quotesLoading ? "--" : formatChangePct(quote?.changePct)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-sm border border-border bg-bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-sm border border-primary/35 bg-primary/10 text-primary">
                <Buildings className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-body-sm font-semibold text-fg">Ticker pages open from here</h2>
                <p className="mt-1 text-body-sm text-fg-muted">
                  Choosing a row opens the full ticker page with chart, options thesis, strategy lookup, news, earnings, and company context.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-sm border border-border bg-bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-sm border border-profit/35 bg-profit/10 text-profit">
                <TrendUp className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-body-sm font-semibold text-fg">Largest move on the board</h2>
                {topMover ? (
                  <button
                    type="button"
                    onClick={() => openSymbol(topMover.company.symbol)}
                    className="mt-3 flex w-full items-center justify-between rounded-sm border border-border-hair bg-bg px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-bg-elev-1 active:scale-[0.98]"
                  >
                    <span>
                      <span className="block font-mono text-body-sm font-semibold text-fg">
                        {topMover.company.symbol}
                      </span>
                      <span className="mt-1 block t-meta">{topMover.company.name}</span>
                    </span>
                    <span className={cn("font-mono text-body-sm font-semibold", changeTone(topMover.quote.changePct))}>
                      {formatChangePct(topMover.quote.changePct)}
                    </span>
                  </button>
                ) : (
                  <p className="mt-2 text-body-sm text-fg-muted">
                    Quote data will populate this once the feed responds.
                  </p>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block">
      <span className="t-label text-fg-muted md:hidden">{label}</span>
      {value === null ? (
        <span className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-elev-2" aria-label={`Loading ${label}`} />
      ) : (
        <span className={cn("font-mono text-body-sm text-fg", className)}>{value}</span>
      )}
    </div>
  );
}

function SymbolsSkeleton() {
  return (
    <div aria-label="Loading symbols" aria-busy="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="grid min-h-[74px] gap-3 border-b border-border-hair px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_0.9fr_0.7fr_0.7fr_0.7fr_44px] md:items-center"
        >
          <div className="space-y-2">
            <div className="h-4 w-20 animate-pulse rounded-sm bg-bg-elev-2" />
            <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-elev-2" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded-sm bg-bg-elev-2" />
            <div className="h-3 w-24 animate-pulse rounded-sm bg-bg-elev-2" />
          </div>
          <div className="h-4 w-16 animate-pulse rounded-sm bg-bg-elev-2" />
          <div className="h-4 w-14 animate-pulse rounded-sm bg-bg-elev-2" />
          <div className="h-4 w-16 animate-pulse rounded-sm bg-bg-elev-2" />
          <div className="hidden size-9 animate-pulse rounded-sm bg-bg-elev-2 md:block" />
        </div>
      ))}
    </div>
  );
}
