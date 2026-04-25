/**
 * Time helpers shared by detail panels and feed components.
 *
 * `fmtRelativeTime` formats an ISO datetime as a short English relative
 * phrase ("5 m ago", "2 h ago", "just now") using Intl.RelativeTimeFormat
 * so it's locale-aware and falls back gracefully for bad input.
 *
 * Round-4 adds:
 *   - `getFreshness` — bucket a timestamp into fresh/stale/expired.
 *   - `useTick` — re-render hook that bumps state on a fixed cadence
 *     so consumers can rely on `Date.now()` in their render path
 *     without freezing the displayed timestamp.
 */

import { useEffect, useState } from "react";

/**
 * Returns a short relative-time string for an ISO datetime. Returns "—"
 * for missing/invalid input. Falls back to a coarse ISO date if the
 * runtime doesn't support Intl.RelativeTimeFormat.
 *
 * Examples (assuming now is 2026-04-24T15:00:00Z):
 *   fmtRelativeTime("2026-04-24T14:55:00Z") -> "5 m ago"
 *   fmtRelativeTime("2026-04-24T13:00:00Z") -> "2 h ago"
 *   fmtRelativeTime("2026-04-23T15:00:00Z") -> "1 d ago"
 */
export function fmtRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = (now.getTime() - then) / 1000;
  const absSec = Math.abs(diffSec);

  // "Just now" window — sub-30s reads as live.
  if (absSec < 30) return "just now";

  // Intl.RelativeTimeFormat exists in all modern runtimes; guard anyway.
  const rtf =
    typeof Intl !== "undefined" && typeof Intl.RelativeTimeFormat === "function"
      ? new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" })
      : null;

  const sign = diffSec >= 0 ? -1 : 1; // past = negative for RTF
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (absSec < 60) {
    value = Math.round(absSec);
    unit = "second";
  } else if (absSec < 60 * 60) {
    value = Math.round(absSec / 60);
    unit = "minute";
  } else if (absSec < 60 * 60 * 24) {
    value = Math.round(absSec / 3600);
    unit = "hour";
  } else {
    value = Math.round(absSec / 86400);
    unit = "day";
  }

  if (rtf) return rtf.format(sign * value, unit);

  // Fallback — compact manual form.
  const suffix = diffSec >= 0 ? " ago" : " from now";
  const unitAbbr: Record<string, string> = { second: "s", minute: "m", hour: "h", day: "d" };
  return `${value} ${unitAbbr[unit] ?? unit}${suffix}`;
}

export type FreshnessLevel = "fresh" | "stale" | "expired";

/**
 * Bucket a timestamp into a freshness level for the detail panel pill.
 * - fresh:   < 30s old
 * - stale:   < 5m old
 * - expired: ≥ 5m old (or unknown)
 */
export function getFreshness(
  input: string | number | Date | null | undefined,
  now: number = Date.now(),
): FreshnessLevel {
  if (input == null) return "expired";
  let then: number;
  if (input instanceof Date) {
    then = input.getTime();
  } else if (typeof input === "number") {
    then = input;
  } else {
    const parsed = Date.parse(input);
    if (!Number.isFinite(parsed)) return "expired";
    then = parsed;
  }
  const diffSec = Math.max(0, (now - then) / 1000);
  if (diffSec < 30) return "fresh";
  if (diffSec < 300) return "stale";
  return "expired";
}

/**
 * Force-rerender hook: bumps a counter every `intervalMs` so consumers
 * can rely on `Date.now()` in their render path without freezing the
 * displayed timestamp. Used by `DetailHeader` (15s tick) and `NewsFeed`
 * (60s tick). Don't use in components whose data doesn't decay (the
 * MetricsStrip and StrikeLadder rerender on data refresh, not the
 * wall clock).
 *
 * Pass `0` (or a negative number) to disable the interval — useful in
 * tests where fake timers haven't been set up.
 */
export function useTick(intervalMs: number = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
