"use client";

import { fmtCurrency, fmtPct } from "@/lib/intl";
import { fmtRelativeTime, useTick } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * TickerPriceDisplay (primitive)
 * ──────────────────────────────
 * Google-Finance / Robinhood two-line ticker pattern: a regular-session
 * hero price + delta on top, and a smaller secondary line for the
 * extended-hours (pre-market / after-hours) trade when one is available.
 *
 *   AMD $356.28 +4.32%
 *          After Hours $414.00 +13.34%
 *
 * Design contract (PM-B):
 *   · Both deltas are measured against the regular close — the secondary
 *     line is *not* "AH change vs AH open"; it's the raw extended-hours
 *     trade vs the close.
 *   · Session labels are spelled out ("After Hours", "Pre-market"), not
 *     "AH"/"PM" abbreviations. The compact ExtendedHoursBadge primitive
 *     covers the abbreviation-style use cases (table rows, position
 *     lists) — this surface is the headline-style display.
 *   · The secondary line is *suppressed* when the upstream extended-hours
 *     trade is older than 15 minutes. A stale post-market mark plastered
 *     under a fresh regular-session price is worse than no mark at all.
 *   · The freshness pill (LIVE / DELAYED Xs) lives inside this component
 *     so any surface that adopts the primitive gets the same wall-clock
 *     decay treatment for free. The pill ticks every 5s via `useTick`
 *     and crosses the LIVE → DELAYED boundary at 30s.
 *
 * `changePct` is a *percentage value* (4.32 means +4.32%), not a decimal
 * fraction. We divide by 100 before passing through `fmtPct` so the
 * locale formatter ("percent" style) emits the right number — this
 * mirrors the fix already applied at DetailHeader.tsx (Round-8 visual
 * bug DH1: a 2.15% change rendered as 215% when fed raw to the percent
 * formatter, which expects 0.0215).
 */
export type TickerSession = "pre" | "post";

export interface TickerPriceDisplayProps {
  last: number;
  change: number | null;
  /** Percentage value, e.g. 4.32 for +4.32%. NOT a decimal fraction. */
  changePct: number | null;
  /** ISO timestamp of the regular-session quote — drives the LIVE/DELAYED pill. */
  timestamp?: string | null;
  extendedPrice?: number | null;
  extendedChange?: number | null;
  /** Percentage value, e.g. 13.34 for +13.34%. NOT a decimal fraction. */
  extendedChangePct?: number | null;
  extendedSession?: TickerSession | null;
  /** ISO timestamp of the last extended-hours trade — drives the 15-min stale check. */
  extendedTimestamp?: string | null;
  /** Feature/env flag — when explicitly false, the secondary line is suppressed. */
  hasExtendedHours?: boolean;
  layout?: "stacked" | "inline";
  className?: string;
}

/** 15 minutes — anything older and the AH/PM mark is suppressed. */
const STALE_EXTENDED_MS = 15 * 60 * 1000;

/** Sub-30s = LIVE, anything else falls back to DELAYED Xs. */
const LIVE_PILL_THRESHOLD_MS = 30 * 1000;

const SESSION_LABEL: Record<TickerSession, string> = {
  pre: "Pre-market",
  post: "After Hours",
};

export function TickerPriceDisplay({
  last,
  change,
  changePct,
  timestamp,
  extendedPrice,
  extendedChange,
  extendedChangePct,
  extendedSession,
  extendedTimestamp,
  hasExtendedHours = true,
  layout = "stacked",
  className,
}: TickerPriceDisplayProps) {
  // 5s tick keeps the freshness pill at most ~5s stale around the 30s
  // boundary, matching the DetailHeader's existing cadence so adoption
  // doesn't change perceived behaviour. Visibility-gated inside useTick
  // so a hidden tab pays no cost.
  useTick(5_000);

  const shouldShowExtended =
    hasExtendedHours !== false &&
    extendedSession != null &&
    extendedPrice != null &&
    Number.isFinite(extendedPrice) &&
    extendedChangePct != null &&
    Number.isFinite(extendedChangePct) &&
    !isStale(extendedTimestamp);

  const primaryDeltaText = formatDelta(change, changePct);
  const primaryDeltaClass = deltaClass(changePct);

  const extendedDeltaText = shouldShowExtended
    ? formatDelta(extendedChange ?? null, extendedChangePct ?? null)
    : null;
  const extendedDeltaClass = shouldShowExtended ? deltaClass(extendedChangePct) : "";

  if (layout === "inline") {
    return (
      <div
        data-slot="ticker-price-display-inline"
        className={cn("inline-flex items-baseline gap-2", className)}
      >
        <span className="t-mono">{fmtCurrency(last, "USD")}</span>
        {primaryDeltaText && (
          <span className={cn("t-mono text-body-sm", primaryDeltaClass)}>{primaryDeltaText}</span>
        )}
        {shouldShowExtended && extendedSession && extendedPrice != null && (
          <>
            <span className="t-label u-muted" aria-hidden="true">·</span>
            <span className="t-label u-muted">{SESSION_LABEL[extendedSession]}</span>
            <span className="t-mono">{fmtCurrency(extendedPrice, "USD")}</span>
            {extendedDeltaText && (
              <span className={cn("t-mono text-label", extendedDeltaClass)}>{extendedDeltaText}</span>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div data-slot="ticker-price-display" className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <FreshnessPill timestamp={timestamp ?? null} />
        <span className="t-num-hero min-w-0 text-numeric-hero tracking-[0]">
          {fmtCurrency(last, "USD")}
        </span>
      </div>
      <div
        data-slot="ticker-price-display-delta"
        className={cn("t-mono text-body-sm", primaryDeltaClass)}
      >
        {primaryDeltaText ?? "—"}
      </div>
      {shouldShowExtended && extendedSession && extendedPrice != null && (
        <div
          data-slot="extended-hours-secondary"
          data-session={extendedSession}
          className="mt-1 border-t border-[color:var(--border-hair,var(--border))] pt-1"
        >
          {/* Maverick FIX-D (new-trader P1 #5): "After Hours" alone reads
              like an additional delta on top of today's regular change.
              Append "(vs. today's close)" so the reference point is
              explicit, and put the full explanation behind an <abbr>
              tooltip + dotted underline so screen readers and hover
              users both get the disambiguation. */}
          <abbr
            data-slot="extended-hours-label"
            title="After-hours change is measured against today's regular-session close, not added to today's regular change"
            className="t-label u-muted no-underline decoration-dotted underline-offset-4 [text-decoration-style:dotted] hover:underline cursor-help"
          >
            {SESSION_LABEL[extendedSession]}{" "}
            <span className="u-muted">(vs. today&apos;s close)</span>
          </abbr>{" "}
          <span className="t-mono text-body-sm">{fmtCurrency(extendedPrice, "USD")}</span>
          {extendedDeltaText && (
            <span className={cn("t-mono text-label ml-2", extendedDeltaClass)}>
              {extendedDeltaText}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default TickerPriceDisplay;

/**
 * LIVE/DELAYED pill — was previously inlined in DetailHeader. Lifted here
 * so every adopter of TickerPriceDisplay gets the same freshness signal
 * without re-implementing the 30s threshold + 5s tick.
 */
function FreshnessPill({ timestamp }: { timestamp: string | null }) {
  const freshness = getFreshness(timestamp);
  if (!freshness) return null;
  return (
    <span
      data-slot="freshness-pill"
      data-kind={freshness.kind}
      title={timestamp ?? undefined}
      aria-label={
        freshness.kind === "live"
          ? "Live price"
          : `Delayed price, ${freshness.age}`
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 t-mono text-label uppercase tracking-wide",
        freshness.kind === "live"
          ? "border-[color:var(--profit)] text-[color:var(--profit)]"
          : "border-[color:var(--border)] u-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          freshness.kind === "live"
            ? "bg-[color:var(--profit)]"
            : "bg-[color:var(--fg-muted)]",
        )}
      />
      {freshness.kind === "live" ? "LIVE" : `DELAYED ${freshness.age}`}
    </span>
  );
}

function getFreshness(
  iso: string | null,
): { kind: "live" | "delayed"; age: string } | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const ageMs = Date.now() - then;
  if (ageMs < LIVE_PILL_THRESHOLD_MS) return { kind: "live", age: "just now" };
  return { kind: "delayed", age: fmtRelativeTime(iso) };
}

function isStale(iso: string | null | undefined): boolean {
  if (!iso) return false; // No timestamp — caller hasn't told us; trust the data.
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return true;
  return Date.now() - then > STALE_EXTENDED_MS;
}

/**
 * Format a (change, changePct) pair as ``+$1.42 (+0.71%)`` or
 * ``-$2.62 (-2.15%)``. `changePct` is divided by 100 before passing to
 * `fmtPct` because that helper uses Intl `style: "percent"` (which
 * multiplies by 100 internally), and our wire contract carries
 * percentages as 4.32 not 0.0432. Returns null when both inputs are
 * null/non-finite — caller decides what to render in that case.
 */
function formatDelta(change: number | null, changePct: number | null): string | null {
  if (
    (change == null || !Number.isFinite(change)) &&
    (changePct == null || !Number.isFinite(changePct))
  ) {
    return null;
  }
  const dollar =
    change != null && Number.isFinite(change)
      ? fmtCurrency(change, "USD", { signDisplay: "always" })
      : "";
  const pct =
    changePct != null && Number.isFinite(changePct)
      ? fmtPct(changePct / 100, 2, { signDisplay: "always" })
      : "";
  if (dollar && pct) return `${dollar} (${pct})`;
  return dollar || pct || null;
}

function deltaClass(changePct: number | null | undefined): string {
  if (changePct == null || !Number.isFinite(changePct)) return "u-muted";
  return changePct >= 0 ? "u-profit" : "u-loss";
}
