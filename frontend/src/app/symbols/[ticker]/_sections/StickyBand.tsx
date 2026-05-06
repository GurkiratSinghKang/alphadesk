"use client";

import type { ReactNode } from "react";

import { TickerPriceDisplay } from "@/components/primitives/TickerPriceDisplay";
import type { Quote } from "@/types";

import { HeroCTAs } from "./HeroCTAs";

// StickyBand only requires ``last`` for rendering — all other Quote fields are
// accessed with optional chaining + null fallbacks below. Accepting a narrower
// shape lets callers (e.g. SymbolPageClient) pass a runtime-validated subset of
// the wire-format Quote without needing the full envelope.
export type StickyBandQuote = Partial<Quote> & { last: number };

export interface StickyBandProps {
  symbol: string;
  quote: StickyBandQuote | null | undefined;
  extendedQuote?: StickyBandQuote | null;
  children?: ReactNode;
}

export function StickyBand({ symbol, quote, extendedQuote, children }: StickyBandProps) {
  const isLoading = quote == null;
  const eh = extendedQuote ?? quote ?? null;

  const timestampIso =
    quote && typeof quote.timestamp === "number" && Number.isFinite(quote.timestamp)
      ? new Date(quote.timestamp).toISOString()
      : null;

  return (
    <section
      data-testid="sticky-band"
      data-slot="symbol-sticky-band"
      className={[
        "sticky top-0 z-30",
        "backdrop-blur-md",
        "bg-[color-mix(in_oklab,var(--bg-elev-1)_85%,transparent)]",
        "border-b border-border-hair",
        "px-4 py-3 sm:px-6 sm:py-4",
      ].join(" ")}
    >
      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <StickyBandSkeleton symbol={symbol} />
          ) : (
            <TickerPriceDisplay
              last={quote.last}
              change={quote.change ?? null}
              changePct={quote.changePct ?? null}
              timestamp={timestampIso}
              extendedPrice={eh?.extended_price ?? null}
              extendedChange={eh?.extended_change ?? null}
              extendedChangePct={eh?.extended_change_pct ?? null}
              extendedSession={eh?.extended_session ?? null}
              extendedTimestamp={eh?.last_trade_time ?? null}
            />
          )}
        </div>
        <div className="shrink-0">
          <HeroCTAs symbol={symbol} />
        </div>
      </div>
      {children ? <div className="mt-3 sm:mt-4">{children}</div> : null}
    </section>
  );
}

function StickyBandSkeleton({ symbol }: { symbol: string }) {
  return (
    <div
      data-testid="sticky-band-skeleton"
      data-slot="sticky-band-skeleton"
      aria-busy="true"
      aria-label={`Loading ${symbol} price`}
      className="min-w-0"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="h-5 w-14 animate-pulse rounded-sm bg-bg-elev-2" />
        <div className="h-7 w-32 animate-pulse rounded-sm bg-bg-elev-2" />
      </div>
      <div className="mt-2 h-4 w-24 animate-pulse rounded-sm bg-bg-elev-2" />
    </div>
  );
}

export default StickyBand;
