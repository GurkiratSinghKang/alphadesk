"use client";

/**
 * TickerFreshnessStrip — domain-aware freshness chips for the earnings
 * detail panel.
 *
 * Each chip is the canonical source for its domain (QUOTE / OPTIONS /
 * EARNINGS / RESEARCH). The header's "Updated just now" string refers
 * exclusively to the regular-session quote — these chips fill in the
 * freshness picture for everything else.
 *
 * Bug-fix history:
 *
 *   • B1.5 / B2.14 — `EARNINGS fresh May 4, 8:00 PM` was 2 days stale
 *     yet labeled "fresh". The 5-min stale threshold inherited from
 *     the realtime-quote pipeline made no sense for low-frequency
 *     domains. Each domain now has its own quality bucketing
 *     (``DOMAIN_THRESHOLDS_SEC``).
 *
 *   • B1.5 — EARNINGS chip surfaces last + next earnings dates inline
 *     ("last May 5 · next May 6") instead of a "fresh" adjective. The
 *     real signal for earnings is the calendar dates, not the fetch
 *     timestamp.
 *
 *   • B1.7 / B2.16 — Time formats unified. Chip timestamps render as
 *     "Today 1:50 PM" when the asOf falls on the viewer's local
 *     calendar day, otherwise "May 4, 8:00 PM" (date + time, 12-hour
 *     with AM/PM). Header "Updated just now" stays scoped to the
 *     quote.
 *
 *   • B1.23 / B2.15 — RESEARCH no longer shows a red "unavailable"
 *     pill. When research is genuinely missing (e.g. not pre-warmed
 *     for this ticker) the chip uses the grey "warming up" tone with
 *     an explanation tooltip + a "Why?" expander. Red is reserved for
 *     hard-error states, not coverage gaps.
 *
 *   • B2.15 — Every chip carries a tooltip describing what the domain
 *     means + the freshness threshold used to bucket it.
 */

import { useMemo, useState } from "react";
import type { TickerContext, TickerFactEnvelope, TickerFactQuality } from "@/types";

/**
 * Domain key — identifies the data class. Drives copy + freshness
 * thresholds. Kept narrower than ``TickerContext`` keys (we don't
 * surface ``news`` or ``marketRegime`` in this strip — they have their
 * own UI affordances).
 */
type FreshnessDomain = "quote" | "options" | "earnings" | "research";

/**
 * Per-domain bucketing thresholds, in seconds. The strip defaults to
 * the quote-style 30s/300s split because that's the realtime contract
 * for streaming prices; everything else gets a more forgiving window
 * because the underlying data updates on a much slower cadence.
 *
 *   - Quote: realtime tick — anything past 30s is "stale", past 5m is
 *     "expired".
 *   - Options chain: refreshed roughly per minute during market hours.
 *     5-minute "fresh" window, 30-minute "stale" beyond that.
 *   - Earnings calendar: changes once per quarter at most. 7-day
 *     "fresh" window; >30 days = "stale" (likely a stub).
 *   - Research (analyst PT changes, sector backdrop): 6-hour fresh
 *     window because tier-1 outlets may publish updates same-day.
 */
const DOMAIN_THRESHOLDS_SEC: Record<
  FreshnessDomain,
  { freshSec: number; staleSec: number }
> = {
  quote: { freshSec: 30, staleSec: 300 },
  options: { freshSec: 5 * 60, staleSec: 30 * 60 },
  earnings: { freshSec: 7 * 24 * 60 * 60, staleSec: 30 * 24 * 60 * 60 },
  research: { freshSec: 6 * 60 * 60, staleSec: 24 * 60 * 60 },
};

/**
 * Plain-language explanation of what each chip represents. Surfaced as
 * a hover tooltip + the body of the "Why?" expander on the RESEARCH
 * chip when it's marked unavailable.
 */
const DOMAIN_HELP: Record<FreshnessDomain, string> = {
  quote:
    "Last regular-session price for this ticker. Refreshed every few seconds during market hours.",
  options:
    "Front-month option-chain snapshot used for IV / strike / Greeks. Refreshed roughly every minute during market hours.",
  earnings:
    "Earnings calendar entry — last reported quarter and next confirmed report date.",
  research:
    "Research blocks (analyst PT changes, sector backdrop) are not yet wired for this ticker. Pre-warmed only for top-50 reporters.",
};

const DOMAIN_LABEL: Record<FreshnessDomain, string> = {
  quote: "QUOTE",
  options: "OPTIONS",
  earnings: "EARNINGS",
  research: "RESEARCH",
};

/**
 * Visual quality bucket for the chip palette. Distinct from the wire
 * ``TickerFactQuality`` because we want a fourth "warming" tone for
 * coverage gaps that aren't actual errors.
 *
 *   - fresh:   green — data is fresh AND from a reliable source
 *   - amber:   amber — data is stale OR from a fallback / demo source
 *   - error:   red — data is genuinely missing because of a hard error
 *   - warming: grey — data is "warming up" / not pre-warmed for this
 *              ticker (e.g. IV history under 30 days; research not
 *              pre-warmed). Less alarming and more informative than
 *              red.
 */
type ChipTone = "fresh" | "amber" | "error" | "warming";

const TONE_CLASS: Record<ChipTone, string> = {
  fresh: "text-profit",
  amber: "text-amber",
  error: "text-loss",
  warming: "u-muted",
};

const TONE_QUALITY_LABEL: Record<ChipTone, string> = {
  fresh: "fresh",
  amber: "stale",
  error: "error",
  warming: "warming up",
};

/**
 * Bucket a fact envelope into our 4-tone chip quality. Wire qualities
 * map as follows:
 *
 *   - "fresh" with asOf inside the domain freshSec window → fresh
 *   - "fresh" with asOf past freshSec but inside staleSec → amber
 *   - "fresh" with asOf past staleSec → amber (still has data, just
 *     old; we don't promote a stale earnings chip to red because the
 *     calendar entry is still useful)
 *   - "stale" / "expired" → amber
 *   - "demo" → amber (fallback source, as designed)
 *   - "unavailable" → warming (pre-warm coverage gap, not a hard error)
 *
 * The ``isResearch`` flag treats unavailable RESEARCH specifically as
 * "warming up" rather than an error — this is the B1.23 / B2.15 fix.
 */
function pickTone(
  domain: FreshnessDomain,
  fact: TickerFactEnvelope<Record<string, unknown>> | null | undefined,
  nowMs: number,
): ChipTone {
  if (!fact || !fact.freshness) return "warming";
  const quality = fact.freshness.quality;
  if (quality === "unavailable") return "warming";
  if (quality === "demo") return "amber";
  if (quality === "expired" || quality === "stale") return "amber";
  // quality === "fresh" — bucket by domain-specific window using asOf.
  const asOf = fact.freshness.asOf ?? fact.freshness.observedAt ?? null;
  if (!asOf) return "fresh";
  const ts = Date.parse(asOf);
  if (!Number.isFinite(ts)) return "fresh";
  const ageSec = Math.max(0, (nowMs - ts) / 1000);
  const { freshSec } = DOMAIN_THRESHOLDS_SEC[domain];
  if (ageSec <= freshSec) return "fresh";
  return "amber";
}

/**
 * Format an ISO timestamp as a chip-friendly absolute label.
 *
 *   - Same calendar day in the viewer's locale → "Today 1:50 PM"
 *   - Different day → "May 4, 8:00 PM"
 *
 * Falls back to the raw input for unparseable strings so a malformed
 * timestamp surfaces visibly rather than rendering nothing.
 */
export function formatChipTimestamp(value: string | null | undefined, nowMs: number = Date.now()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date(nowMs);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (sameDay) return `Today ${time}`;
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
  return `${datePart}, ${time}`;
}

/**
 * Format a bare ISO date (YYYY-MM-DD) as "May 6". Used for the EARNINGS
 * chip's last/next dates which arrive as calendar dates, not point-in-
 * time timestamps.
 */
export function formatEarningsDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Parse bare dates as local midnight to avoid TZ-shifted "yesterday"
  // labels for west-of-UTC viewers.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  let date: Date;
  if (m) {
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    date = new Date(iso);
  }
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Pull a ``last earnings`` ISO date out of the ticker-context envelope.
 * The backend's ``earnings`` fact wraps the Polygon / FMP calendar
 * payload — keys vary slightly across providers, so we look at a few
 * canonical paths defensively.
 */
function extractLastEarningsDate(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  // Common direct keys.
  for (const key of ["last_report_date", "lastReportDate", "prior_report_date"]) {
    const v = value[key];
    if (typeof v === "string") return v;
  }
  // prior_moves[-1].date — last entry of the historical moves array.
  const priorMoves = value["prior_moves"] ?? value["priorMoves"];
  if (Array.isArray(priorMoves) && priorMoves.length > 0) {
    const last = priorMoves[priorMoves.length - 1];
    if (last && typeof last === "object") {
      const d = (last as Record<string, unknown>).date ?? (last as Record<string, unknown>).report_date;
      if (typeof d === "string") return d;
    }
  }
  return null;
}

function extractNextEarningsDate(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  for (const key of ["next_report_date", "nextReportDate", "report_date", "reportDate"]) {
    const v = value[key];
    if (typeof v === "string") return v;
  }
  return null;
}

export interface TickerFreshnessStripProps {
  context: TickerContext | null;
  /**
   * Optional inline help URL — overrides the default ``/help/earnings-data``
   * target for the "Why?" link on the RESEARCH chip.
   */
  helpHref?: string;
  /** Test seam: override Date.now() for snapshot stability. */
  nowMs?: number;
}

export default function TickerFreshnessStrip({
  context,
  helpHref = "/help/earnings-data",
  nowMs = Date.now(),
}: TickerFreshnessStripProps) {
  if (!context) return null;
  // Even when individual envelopes are absent, we want to render a
  // complete strip so the user sees coverage at a glance — a missing
  // chip is worse than a "warming up" chip that explains why the data
  // isn't there. ``items`` drives the order; the strip renders all
  // four domains regardless of whether ``fact`` is populated.
  const items: Array<[FreshnessDomain, TickerFactEnvelope<Record<string, unknown>> | null | undefined]> = useMemo(
    () => [
      ["quote", context.quote ?? null],
      ["options", context.optionsSummary ?? null],
      ["earnings", context.earnings ?? null],
      ["research", context.research ?? null],
    ],
    [context.quote, context.optionsSummary, context.earnings, context.research],
  );
  return (
    <div
      data-slot="ticker-freshness-strip"
      role="status"
      aria-label="Per-domain data freshness"
      className="mb-3 flex flex-wrap items-center gap-2 rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-elev-1)] px-3 py-2"
    >
      {items.map(([domain, fact]) => (
        <FreshnessChip
          key={domain}
          domain={domain}
          fact={fact ?? null}
          nowMs={nowMs}
          helpHref={helpHref}
        />
      ))}
    </div>
  );
}

interface FreshnessChipProps {
  domain: FreshnessDomain;
  fact: TickerFactEnvelope<Record<string, unknown>> | null;
  nowMs: number;
  helpHref: string;
}

function FreshnessChip({ domain, fact, nowMs, helpHref }: FreshnessChipProps) {
  const tone = pickTone(domain, fact, nowMs);
  const label = DOMAIN_LABEL[domain];
  const qualityLabel = TONE_QUALITY_LABEL[tone];
  const help = DOMAIN_HELP[domain];

  // Earnings chip surfaces explicit calendar dates instead of a
  // freshness adjective — see B1.5 in the file header.
  if (domain === "earnings") {
    return (
      <EarningsChip
        fact={fact}
        tone={tone}
        label={label}
        help={help}
      />
    );
  }

  const wireQuality: TickerFactQuality | undefined = fact?.freshness?.quality;
  const isResearchUnavailable = domain === "research" && wireQuality === "unavailable";

  if (isResearchUnavailable) {
    return (
      <ResearchUnavailableChip help={help} helpHref={helpHref} label={label} />
    );
  }

  const tooltip =
    fact?.freshness?.asOf || fact?.freshness?.observedAt
      ? `${help}\n\nLast updated: ${formatChipTimestamp(fact?.freshness?.asOf ?? fact?.freshness?.observedAt ?? null, nowMs)}`
      : help;
  return (
    <span
      data-slot={`freshness-chip-${domain}`}
      data-quality={qualityLabel}
      data-tone={tone}
      title={tooltip}
      className="inline-flex items-center gap-1.5 rounded-pill border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] px-2.5 py-1 font-mono text-eyebrow text-[color:var(--fg-muted)]"
    >
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <span className={TONE_CLASS[tone]}>{qualityLabel}</span>
      {fact?.freshness?.asOf && (
        <span className="text-[color:var(--fg-hint)]">
          {formatChipTimestamp(fact.freshness.asOf, nowMs)}
        </span>
      )}
    </span>
  );
}

function EarningsChip({
  fact,
  tone,
  label,
  help,
}: {
  fact: TickerFactEnvelope<Record<string, unknown>> | null;
  tone: ChipTone;
  label: string;
  help: string;
}) {
  const value = fact?.value ?? null;
  const lastDate = extractLastEarningsDate(value);
  const nextDate = extractNextEarningsDate(value);
  const lastLabel = formatEarningsDate(lastDate);
  const nextLabel = formatEarningsDate(nextDate);
  // Build "last May 5 · next May 6" — fall back to "?" if a side is
  // missing rather than collapsing the layout, so the user can see
  // exactly which leg is unknown.
  const lastFragment = lastLabel ?? (lastDate ? lastDate : "?");
  const nextFragment = nextLabel ?? (nextDate ? nextDate : "?");
  return (
    <span
      data-slot="freshness-chip-earnings"
      data-quality={TONE_QUALITY_LABEL[tone]}
      data-tone={tone}
      title={`${help}\n\nLast earnings: ${lastFragment}\nNext earnings: ${nextFragment}`}
      className="inline-flex items-center gap-1.5 rounded-pill border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] px-2.5 py-1 font-mono text-eyebrow text-[color:var(--fg-muted)]"
    >
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <span className="text-[color:var(--fg-hint)]">
        last <span className={TONE_CLASS.fresh}>{lastFragment}</span>
      </span>
      <span aria-hidden className="text-[color:var(--fg-hint)]">·</span>
      <span className="text-[color:var(--fg-hint)]">
        next <span className={TONE_CLASS.fresh}>{nextFragment}</span>
      </span>
    </span>
  );
}

function ResearchUnavailableChip({
  help,
  helpHref,
  label,
}: {
  help: string;
  helpHref: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span
      data-slot="freshness-chip-research"
      data-quality="warming"
      data-tone="warming"
      title={help}
      className="inline-flex items-center gap-1.5 rounded-pill border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] px-2.5 py-1 font-mono text-eyebrow text-[color:var(--fg-muted)]"
    >
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <span className={TONE_CLASS.warming}>warming up</span>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label="Why is research warming up?"
        onClick={() => setExpanded((v) => !v)}
        className="ml-1 rounded-sm border border-[color:var(--fg-border)] px-1 text-[color:var(--fg-hint)] hover:u-brand focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[color:var(--brand)]"
      >
        Why?
      </button>
      {expanded && (
        <span
          data-slot="freshness-chip-research-help"
          role="note"
          className="ml-1 max-w-[28rem] whitespace-normal text-[color:var(--fg-muted)]"
        >
          {help}{" "}
          <a
            href={helpHref}
            className="underline decoration-dotted hover:u-brand"
          >
            Learn more
          </a>
        </span>
      )}
    </span>
  );
}
