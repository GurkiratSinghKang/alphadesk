"use client";

import { Buildings } from "@phosphor-icons/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { useHydratedWatchlist, useMarketStore } from "@/stores/market";

export interface HeroCTAsProps {
  symbol: string;
  className?: string;
}

export function HeroCTAs({ symbol, className }: HeroCTAsProps) {
  const upper = symbol.toUpperCase();
  const tradeHref = `/trade?symbol=${encodeURIComponent(symbol)}`;
  const agentsHref = `/strategies/trading-agents-research?symbol=${encodeURIComponent(upper)}`;

  // Iter 23: read watchlist + hydration flag together so the
  // "Watch"/"Watching" toggle doesn't flash the wrong state during the
  // ~200ms gap between mount and the WatchlistHydrator server reply.
  // For a power user whose actual watchlist contains the current symbol,
  // the pre-iter-23 button would render "Watch" (from DEFAULT_WATCHLIST)
  // then snap to "Watching" once the real list lands.
  const { symbols: watchlist, isHydrating } = useHydratedWatchlist();
  const addToWatchlist = useMarketStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useMarketStore((s) => s.removeFromWatchlist);
  const { toast } = useToast();

  const isWatching = !isHydrating && watchlist.includes(upper);

  const handleWatchClick = () => {
    if (isWatching) {
      removeFromWatchlist(upper);
      toast({ type: "info", message: `Removed ${upper} from watchlist` });
    } else {
      addToWatchlist(upper);
      toast({ type: "success", message: `Added ${upper} to watchlist` });
    }
  };

  return (
    <div
      data-slot="hero-ctas"
      className={
        className ??
        "flex flex-wrap items-center gap-2"
      }
    >
      <Button
        data-testid="hero-cta-trade"
        variant="default"
        size="default"
        nativeButton={false}
        render={<Link href={tradeHref} />}
      >
        Trade {symbol}
      </Button>
      <Button
        data-testid="hero-cta-watch"
        variant={isWatching ? "default" : "outline"}
        size="default"
        type="button"
        onClick={handleWatchClick}
        aria-pressed={isWatching}
        // Iter 23: disable + expose `data-loading` while WatchlistHydrator
        // is in flight so an over-eager click can't toggle against the
        // wrong (stale-default) baseline. Most cold loads settle in
        // ~200ms so the disabled window is invisible in practice.
        disabled={isHydrating}
        data-loading={isHydrating ? "true" : undefined}
        data-watching={isWatching ? "true" : undefined}
      >
        {isWatching ? "Watching" : "Watch"}
      </Button>
      <Button
        data-testid="hero-cta-run-agents"
        variant="outline"
        size="default"
        nativeButton={false}
        render={<Link href={agentsHref} />}
      >
        Run agents
      </Button>
      <Button
        data-testid="hero-cta-all-symbols"
        variant="outline"
        size="default"
        nativeButton={false}
        render={<Link href="/symbols" />}
      >
        <Buildings className="size-4" aria-hidden="true" />
        All symbols
      </Button>
    </div>
  );
}

export default HeroCTAs;
