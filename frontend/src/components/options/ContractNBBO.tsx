"use client";

import * as React from "react";
import { useContractSnapshot } from "@/hooks/useContractSnapshot";
import { fmtCurrency, fmtPct } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type { ContractSnapshot } from "@/types";

/**
 * Project Maverick (PM-C): per-contract NBBO panel mounted under an
 * expanded row in the StrikeLadder. Renders bid / spread badge / ask in
 * a 3-column grid, a stacked liquidity bar, and a metadata strip
 * (mid / last / volume / OI / IV).
 *
 * The panel is also re-usable on its own — pass an OCC symbol and it
 * polls the backend itself via ``useContractSnapshot``. Defensive on
 * shape: the API mapper coerces missing fields to safe defaults so a
 * partial broker response still renders.
 */
export interface ContractNBBOProps {
  occSymbol: string;
  className?: string;
}

export default function ContractNBBO({ occSymbol, className }: ContractNBBOProps) {
  const { data: snapshot, isLoading, error } = useContractSnapshot(occSymbol);
  const panelId = `nbbo-${occSymbol}`;

  return (
    <section
      id={panelId}
      data-slot="contract-nbbo"
      className={cn("w-full", className)}
      aria-label={`NBBO for ${occSymbol}`}
    >
      {isLoading && !snapshot && <SkeletonNBBO />}
      {(error || snapshot?.isUnavailable) && !isLoading && (
        <span
          className="t-mono text-label u-loss"
          role="status"
          aria-live="polite"
        >
          NBBO unavailable
        </span>
      )}
      {snapshot && !snapshot.isUnavailable && (
        <>
          {/* Maverick FIX-2.2: when synthetic, show prominent warning at TOP
              before the user reads any numbers, dim the data, and suppress
              fabricated last-price / last-timestamp entirely. */}
          {snapshot.isDemo && (
            <div
              role="alert"
              className="mb-2 rounded border px-2 py-1 t-mono text-label"
              style={{
                borderColor: "var(--state-warning)",
                background: "color-mix(in oklab, var(--state-warning) 12%, transparent)",
                color: "var(--state-warning)",
              }}
            >
              ⚠ NO LIVE QUOTE — Showing synthetic estimates. NOT for trading decisions.
            </div>
          )}
          <div
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mt-2"
            style={snapshot.isDemo ? { opacity: 0.5 } : undefined}
          >
            <BidSide
              price={snapshot.bid}
              size={snapshot.bidSize}
              exchange={snapshot.bidExchange}
            />
            <SpreadBadge
              bid={snapshot.bid}
              ask={snapshot.ask}
              midpoint={snapshot.midpoint}
            />
            <AskSide
              price={snapshot.ask}
              size={snapshot.askSize}
              exchange={snapshot.askExchange}
            />
          </div>
          <LiquidityBar
            bidSize={snapshot.bidSize}
            askSize={snapshot.askSize}
            className="mt-2"
          />
          {/* Suppress last_price + last_timestamp on demo — fabricated trades
              are worse than no information. */}
          <MetaStrip
            snapshot={snapshot}
            suppressLastTrade={snapshot.isDemo}
          />
        </>
      )}
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function SkeletonNBBO() {
  return (
    <div
      className="mt-2 animate-pulse"
      data-slot="contract-nbbo-skeleton"
      aria-hidden="true"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="h-10 rounded bg-[var(--bg-elev-1)]" />
        <div className="h-6 w-20 rounded bg-[var(--bg-elev-1)]" />
        <div className="h-10 rounded bg-[var(--bg-elev-1)]" />
      </div>
      <div className="mt-2 h-1.5 rounded bg-[var(--bg-elev-1)]" />
    </div>
  );
}

interface SpreadBadgeProps {
  bid: number;
  ask: number;
  midpoint: number;
}

/**
 * Spread $ + spread% chip, colour-coded by spread%.
 *
 * Thresholds (spec):
 *   ≤ 5%      → green (--profit)
 *   5..15%    → amber (--state-warning)
 *   > 15%     → red (--loss)
 *
 * Edge case: if midpoint is 0 / non-positive (degraded broker, both
 * sides $0), display "—" and use the warning colour rather than dividing
 * by zero and rendering "Infinity%".
 */
export function SpreadBadge({ bid, ask, midpoint }: SpreadBadgeProps) {
  const spread = ask - bid;
  const validMid = Number.isFinite(midpoint) && midpoint > 0;
  const spreadPct = validMid ? spread / midpoint : null;

  let tone: "ok" | "warn" | "bad" = "ok";
  if (spreadPct == null) tone = "warn";
  else if (spreadPct > 0.15) tone = "bad";
  else if (spreadPct > 0.05) tone = "warn";

  const borderVar =
    tone === "ok" ? "var(--profit)" : tone === "warn" ? "var(--state-warning)" : "var(--loss)";

  return (
    <span
      data-slot="spread-badge"
      data-tone={tone}
      className="rounded border px-2 py-0.5 t-mono text-label tabular-nums whitespace-nowrap"
      style={{ borderColor: borderVar, color: borderVar }}
      title={`Bid-ask spread = ${fmtCurrency(Math.max(spread, 0))} (${
        spreadPct != null ? fmtPct(spreadPct, 1) : "n/a"
      })`}
    >
      {validMid ? fmtCurrency(Math.max(spread, 0)) : "—"}
      {" "}
      <span className="u-muted">
        ({spreadPct != null ? fmtPct(spreadPct, 1) : "—"})
      </span>
    </span>
  );
}

interface LiquidityBarProps {
  bidSize: number;
  askSize: number;
  className?: string;
}

/**
 * Stacked horizontal bar showing relative bid vs ask depth. Suppresses
 * itself with an explanatory caption when the combined size is below 10
 * — those samples are too small to convey anything meaningful, and a
 * 50/50 bar at total=2 looks misleadingly authoritative.
 */
export function LiquidityBar({ bidSize, askSize, className }: LiquidityBarProps) {
  const total = Math.max(bidSize, 0) + Math.max(askSize, 0);
  if (total < 10) {
    return (
      <p
        data-slot="liquidity-bar-empty"
        className={cn("t-mono text-label u-muted", className)}
        aria-label={`Bid size ${bidSize} vs Ask size ${askSize}`}
      >
        — size too small to visualize
      </p>
    );
  }
  const bidPct = (Math.max(bidSize, 0) / total) * 100;
  const askPct = 100 - bidPct;
  return (
    <div
      data-slot="liquidity-bar"
      className={cn("flex h-1.5 w-full overflow-hidden rounded", className)}
      role="img"
      aria-label={`Bid size ${bidSize} vs Ask size ${askSize}`}
      title={`Bid size ${bidSize} vs Ask size ${askSize}`}
    >
      <span
        data-slot="liquidity-bar-bid"
        style={{ width: `${bidPct}%`, background: "var(--profit-tint)" }}
      />
      <span
        data-slot="liquidity-bar-ask"
        style={{ width: `${askPct}%`, background: "var(--loss-tint)" }}
      />
    </div>
  );
}

interface SideProps {
  price: number;
  size: number;
  exchange: string | null;
}

export function BidSide({ price, size, exchange }: SideProps) {
  return (
    <div
      data-slot="bid-side"
      className="rounded px-2 py-1 leading-tight"
      style={{ background: "var(--profit-tint)" }}
    >
      <span className="t-num-md u-profit tabular-nums">
        {fmtCurrency(Math.max(price, 0))}
      </span>
      <span className="ml-1 t-mono text-label u-muted tabular-nums">×{size}</span>
      {exchange && (
        <span className="ml-1 t-mono text-label u-muted">({exchange})</span>
      )}
    </div>
  );
}

export function AskSide({ price, size, exchange }: SideProps) {
  return (
    <div
      data-slot="ask-side"
      className="rounded px-2 py-1 leading-tight text-right"
      style={{ background: "var(--loss-tint)" }}
    >
      <span className="t-num-md u-loss tabular-nums">
        {fmtCurrency(Math.max(price, 0))}
      </span>
      <span className="ml-1 t-mono text-label u-muted tabular-nums">×{size}</span>
      {exchange && (
        <span className="ml-1 t-mono text-label u-muted">({exchange})</span>
      )}
    </div>
  );
}

function MetaStrip({
  snapshot,
  suppressLastTrade = false,
}: {
  snapshot: ContractSnapshot;
  suppressLastTrade?: boolean;
}) {
  return (
    <div
      data-slot="contract-nbbo-meta"
      className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 t-mono text-label u-muted tabular-nums"
    >
      <span>Mid {fmtCurrency(snapshot.midpoint)}</span>
      {snapshot.lastPrice != null && !suppressLastTrade && (
        <span>Last {fmtCurrency(snapshot.lastPrice)}</span>
      )}
      <span>Vol {snapshot.volume}</span>
      <span>OI {snapshot.openInterest}</span>
      {snapshot.impliedVolatility != null && (
        <span>IV {fmtPct(snapshot.impliedVolatility, 1)}</span>
      )}
    </div>
  );
}
