"use client";

import * as React from "react";
import { useContractSnapshot } from "@/hooks/useContractSnapshot";
import { fmtCurrency, fmtPct } from "@/lib/intl";
import { useTick } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ContractSnapshot } from "@/types";

/**
 * Maverick FIX-A — short relative-time formatter for the NBBO panel's
 * "Last $4.20 (3s ago)" + "Quoted Xs ago" captions. Mirrors the helper
 * shape called out in the pro-trader audit P0 #3 (compact "Ns/Nm/Nh"
 * suffixes; not the locale-aware Intl.RelativeTimeFormat used elsewhere
 * because the surface is a compact metadata strip, not prose).
 *
 * Returns "" for null/non-finite input so callers can suppress the
 * caption without an explicit guard.
 */
function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

/**
 * Maverick FIX-A — colour bucket for the freshness dot adjacent to the
 * "Quoted Ns ago" caption. Green if the quote is < 60 s old, amber for
 * 60–300 s, red beyond 5 min. Returns null when there is no timestamp.
 */
function freshnessTone(
  iso: string | null | undefined,
  now: number,
): { tone: "ok" | "warn" | "bad"; ageMs: number } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ageMs = now - t;
  if (ageMs < 60_000) return { tone: "ok", ageMs };
  if (ageMs < 300_000) return { tone: "warn", ageMs };
  return { tone: "bad", ageMs };
}

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
  // Maverick FIX-A (pro-trader P0 #3): keep the relative-time strings
  // "Last $X (Ns ago)" + "Quoted Ns ago" + the freshness dot fresh
  // without re-fetching. 5 s cadence is fast enough for a desk operator
  // to see the colour cross 60 s / 5 min thresholds within one tick.
  // ``useTick`` already pauses on hidden tabs so this is cheap.
  useTick(5_000);
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
            <div className="flex flex-col items-center gap-0.5">
              <SpreadBadge
                bid={snapshot.bid}
                ask={snapshot.ask}
                midpoint={snapshot.midpoint}
              />
              {/* Maverick FIX-A (pro-trader P0 #3): "Quoted Ns ago" caption
                  with a colored freshness dot. Backed by fetchedAt — that's
                  the timestamp the backend stamped when it pulled the NBBO
                  from the upstream provider. Suppressed on synthetic data
                  because the dot would advertise a freshness that doesn't
                  apply. */}
              {!snapshot.isDemo && (
                <FreshnessCaption iso={snapshot.fetchedAt} />
              )}
            </div>
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
  // Maverick FIX-A: render the last-trade timestamp as a relative-time
  // suffix beside the price ("Last $4.20 (3s ago)") so an operator can
  // tell whether the print is current at a glance. Recomputed on each
  // render — the parent's useTick(5_000) keeps Date.now() ticking.
  const lastAge = formatRelativeTime(snapshot.lastTimestamp, Date.now());
  return (
    <div
      data-slot="contract-nbbo-meta"
      className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 t-mono text-label u-muted tabular-nums"
    >
      <span>Mid {fmtCurrency(snapshot.midpoint)}</span>
      {snapshot.lastPrice != null && !suppressLastTrade && (
        <span data-slot="contract-nbbo-last">
          Last {fmtCurrency(snapshot.lastPrice)}
          {lastAge && (
            <span className="ml-1 u-muted">({lastAge})</span>
          )}
        </span>
      )}
      <span>Vol {snapshot.volume}</span>
      <span>OI {snapshot.openInterest}</span>
      {snapshot.impliedVolatility != null && (
        <span>IV {fmtPct(snapshot.impliedVolatility, 1)}</span>
      )}
    </div>
  );
}

/**
 * Maverick FIX-A (pro-trader P0 #3): tiny "Quoted Ns ago" caption + a
 * colored dot that turns amber after 60 s and red after 5 min. Lives
 * under the SpreadBadge so the freshness signal sits next to the
 * price-derived chip the operator is already reading.
 *
 * The component reads ``Date.now()`` directly — the parent panel ticks
 * every 5 s via ``useTick`` so this re-renders on the same cadence
 * without needing its own subscription.
 */
function FreshnessCaption({ iso }: { iso: string | null | undefined }) {
  const tone = freshnessTone(iso, Date.now());
  if (!tone) return null;
  const dotColor =
    tone.tone === "ok"
      ? "var(--profit)"
      : tone.tone === "warn"
        ? "var(--state-warning)"
        : "var(--loss)";
  const ageText = formatRelativeTime(iso, Date.now()) || "just now";
  return (
    <span
      data-slot="contract-nbbo-freshness"
      data-tone={tone.tone}
      className="inline-flex items-center gap-1 t-mono text-label u-muted tabular-nums"
      title={iso ?? undefined}
      aria-label={`Quoted ${ageText}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: dotColor }}
      />
      Quoted {ageText}
    </span>
  );
}
