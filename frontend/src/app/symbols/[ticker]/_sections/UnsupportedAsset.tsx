"use client";

import Link from "next/link";

export interface UnsupportedAssetProps {
  symbol: string;
}

export function UnsupportedAsset({ symbol }: UnsupportedAssetProps) {
  return (
    <main
      data-testid="unsupported-asset"
      data-slot="symbol-unsupported-asset"
      data-sym={symbol}
      className="mx-auto max-w-2xl px-6 py-24 text-center"
    >
      <h1 className="font-display text-h1">{symbol}</h1>
      <p className="mt-4 t-mono u-muted">isn&apos;t supported yet.</p>
      <p className="mt-2 t-mono u-muted">
        Crypto and forex tickers are out of scope for MVP.
      </p>
      <Link href="/" className="mt-6 inline-block u-brand underline">
        Back to dashboard
      </Link>
    </main>
  );
}

export default UnsupportedAsset;
