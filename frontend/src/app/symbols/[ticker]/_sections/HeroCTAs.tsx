"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export interface HeroCTAsProps {
  symbol: string;
  className?: string;
}

export function HeroCTAs({ symbol, className }: HeroCTAsProps) {
  const tradeHref = `/trade?symbol=${encodeURIComponent(symbol)}`;

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
        variant="outline"
        size="default"
        type="button"
      >
        Watch
      </Button>
      <Button
        data-testid="hero-cta-run-agents"
        variant="outline"
        size="default"
        type="button"
        disabled
        title="Coming in v1"
      >
        Run agents (coming v1)
      </Button>
    </div>
  );
}

export default HeroCTAs;
