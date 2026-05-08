"use client";

import { Buildings } from "@phosphor-icons/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { useMarketStore } from "@/stores/market";

export interface HeroCTAsProps {
  symbol: string;
  className?: string;
}

export function HeroCTAs({ symbol, className }: HeroCTAsProps) {
  const upper = symbol.toUpperCase();
  const tradeHref = `/trade?symbol=${encodeURIComponent(symbol)}`;
  const agentsHref = `/strategies/trading-agents-research?symbol=${encodeURIComponent(upper)}`;

  // Subscribe only to `watchlist` for re-render efficiency — selecting a
  // primitive-array slice means this component rerenders only when the
  // watchlist mutates, not on every quote tick.
  const watchlist = useMarketStore((s) => s.watchlist);
  const addToWatchlist = useMarketStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useMarketStore((s) => s.removeFromWatchlist);
  const { toast } = useToast();

  const isWatching = watchlist.includes(upper);

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
