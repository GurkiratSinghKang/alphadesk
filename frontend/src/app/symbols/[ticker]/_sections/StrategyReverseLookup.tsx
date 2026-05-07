"use client";

import { useQuery } from "@tanstack/react-query";

import { getStrategiesBySymbol } from "@/lib/api";
import { fmtCurrency } from "@/lib/intl";
import type { StrategyMatch, StrategyMatchesResponse } from "@/types";

const SKELETON_CARDS = Array.from({ length: 6 }, (_, i) => i);

// T11: render the "live signals on this symbol across our strategies"
// section on /symbols/[ticker]. Replaces the StrategyReverseLookupStub.
// Strategies that aren't in this symbol's universe are filtered out
// entirely — the card grid shows only strategies that have something to
// say (holding it, signal active, or in universe with no signal).
export interface StrategyReverseLookupProps {
  symbol: string;
}

type StrategyStatus = "holding" | "signal" | "watching";

interface StrategyCardModel {
  match: StrategyMatch;
  status: StrategyStatus;
}

function classifyMatch(match: StrategyMatch): StrategyStatus | null {
  if (match.currentPosition) return "holding";
  if (match.hasEntrySignal) return "signal";
  if (match.inUniverse) return "watching";
  return null;
}

function statusChipClass(status: StrategyStatus): string {
  switch (status) {
    case "holding":
      // Green = open position
      return "bg-up-500/10 text-up-500 border-up-500/30";
    case "signal":
      // Brand = entry signal
      return "bg-brand-tint text-brand-dim border border-border-hair";
    case "watching":
      // Muted = in universe, no signal
      return "bg-bg u-muted border border-border-hair";
  }
}

function formatStatusLabel(card: StrategyCardModel): string {
  const { match, status } = card;
  if (status === "holding" && match.currentPosition) {
    const qty = match.currentPosition.qty;
    const sideLabel = match.side === "short" ? "Short" : "Holding";
    const sign = qty < 0 ? "-" : "";
    return `${sideLabel} ${sign}${Math.abs(qty)} ${Math.abs(qty) === 1 ? "share" : "shares"}`;
  }
  if (status === "signal") return "Entry signal active";
  return "In universe, no signal";
}

function StrategyCard({ card }: { card: StrategyCardModel }) {
  const { match, status } = card;
  const pnl = match.currentPosition?.unrealizedPnl ?? null;
  const showPnl = status === "holding" && pnl != null;
  const pnlColor =
    pnl != null && pnl > 0
      ? "text-up-500"
      : pnl != null && pnl < 0
        ? "text-down-500"
        : "u-muted";

  return (
    <div
      data-testid={`strategy-card-${match.strategyId}`}
      data-slot="strategy-card"
      data-strategy-status={status}
      className="rounded-sm border border-border-hair bg-bg p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="t-mono text-label leading-tight">{match.name}</h3>
        <span
          className={`t-mono text-micro rounded-xs px-1.5 py-0.5 whitespace-nowrap ${statusChipClass(
            status,
          )}`}
          data-slot="strategy-status-chip"
        >
          {formatStatusLabel(card)}
        </span>
      </div>
      {showPnl ? (
        <p className={`t-mono text-micro mt-2 ${pnlColor}`} data-slot="strategy-pnl">
          Unrealized {fmtCurrency(pnl ?? 0)}
        </p>
      ) : null}
    </div>
  );
}

export function StrategyReverseLookup({ symbol }: StrategyReverseLookupProps) {
  const query = useQuery<StrategyMatchesResponse>({
    queryKey: ["strategies-by-symbol", symbol],
    queryFn: () => getStrategiesBySymbol(symbol),
    staleTime: 60_000, // backend caches this in Redis for 60s; mirror on the client.
    enabled: Boolean(symbol),
  });

  if (query.isLoading) {
    return (
      <section
        id="strategies"
        data-testid="strategy-reverse-lookup"
        data-slot="strategy-reverse-lookup-loading"
        className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="t-label u-muted">STRATEGIES</h2>
          <span className="t-mono text-label u-muted">Loading…</span>
        </header>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SKELETON_CARDS.map((i) => (
            <div key={i} className="h-20 w-full rounded-sm bg-bg" data-slot="ghost-card" />
          ))}
        </div>
      </section>
    );
  }

  // Error state — render empty section gracefully so the rest of the page
  // doesn't shift. Audit defensively against a missing matches array (server
  // 5xx etc.) — apiFetch can throw before the runtime type guard runs.
  if (query.isError || !query.data) {
    return (
      <section
        id="strategies"
        data-testid="strategy-reverse-lookup"
        data-slot="strategy-reverse-lookup-error"
        className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="t-label u-muted">STRATEGIES</h2>
          <span className="t-mono text-label u-muted">Unavailable</span>
        </header>
      </section>
    );
  }

  const cards: StrategyCardModel[] = query.data.matches
    .map((m) => {
      const status = classifyMatch(m);
      return status ? { match: m, status } : null;
    })
    .filter((c): c is StrategyCardModel => c !== null)
    // Holding > entry signal > watching, then alphabetical within bucket.
    .sort((a, b) => {
      const order: Record<StrategyStatus, number> = { holding: 0, signal: 1, watching: 2 };
      const delta = order[a.status] - order[b.status];
      if (delta !== 0) return delta;
      return a.match.name.localeCompare(b.match.name);
    });

  // Cap at 12 cards so the section doesn't dominate the page when every
  // strategy passes the universe filter (which is the MVP default). The
  // overflow lives in the API response if a follow-up wants to surface it.
  const visible = cards.slice(0, 12);

  return (
    <section
      id="strategies"
      data-testid="strategy-reverse-lookup"
      data-slot="strategy-reverse-lookup"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="t-label u-muted">STRATEGIES</h2>
        <span className="t-mono text-label u-muted">
          {visible.length === 0 ? "No matches" : `${visible.length} matches`}
        </span>
      </header>
      {visible.length === 0 ? (
        <p
          className="mt-4 t-mono text-label u-muted"
          data-slot="strategy-reverse-lookup-empty"
        >
          {symbol} is not in any strategy universe today.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((card) => (
            <StrategyCard key={card.match.strategyId} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

export default StrategyReverseLookup;
