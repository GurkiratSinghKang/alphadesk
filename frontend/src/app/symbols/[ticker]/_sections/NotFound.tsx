"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchSymbols } from "@/lib/api";

import { normalizeSymbol } from "../_lib/normalizeSymbol";

export interface NotFoundProps {
  symbol: string;
  nearestMatch?: string | null;
}

export function NotFound({ symbol, nearestMatch: nearestMatchProp = null }: NotFoundProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const search = useQuery({
    queryKey: ["nearestMatch", symbol],
    queryFn: () => searchSymbols(symbol, 5),
    staleTime: 60 * 60 * 1000,
    enabled: !!symbol && nearestMatchProp == null,
    retry: 1,
  });

  const nearestMatch =
    nearestMatchProp ??
    (search.data
      ? (search.data.find((r) => r.symbol.toUpperCase() !== symbol.toUpperCase())?.symbol ?? null)
      : null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = normalizeSymbol(query);
    if (next) router.push(`/symbols/${encodeURIComponent(next)}`);
  }

  return (
    <main
      data-testid="symbol-not-found"
      data-slot="symbol-not-found"
      data-sym={symbol}
      className="mx-auto max-w-2xl px-6 py-24 text-center"
    >
      <h1 className="font-display text-h1">We don&apos;t have data for {symbol}.</h1>
      {nearestMatch ? (
        <p className="mt-4 t-mono u-muted">
          Try{" "}
          <Link
            data-testid="not-found-nearest-link"
            href={`/symbols/${encodeURIComponent(nearestMatch)}`}
            className="u-brand underline"
          >
            {nearestMatch}
          </Link>
          .
        </p>
      ) : (
        <p className="mt-4 t-mono u-muted">Try a different ticker.</p>
      )}

      <form
        data-testid="not-found-search-form"
        onSubmit={onSubmit}
        className="mt-6 flex flex-row items-center justify-center gap-2"
      >
        <Input
          data-testid="not-found-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="AAPL"
          className="max-w-[160px]"
          aria-label="Search ticker"
        />
        <Button data-testid="not-found-search-submit" type="submit" variant="primary" size="default">
          Search
        </Button>
      </form>
    </main>
  );
}

export default NotFound;
