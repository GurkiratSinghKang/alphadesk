/**
 * marketHours.ts
 * ──────────────
 * DST-correct NYSE session helper. Uses `Intl.DateTimeFormat` with the
 * `America/New_York` timeZone so the window automatically shifts between
 * EST (UTC-5) in winter and EDT (UTC-4) roughly March–November.
 *
 * Regular session: 09:30–16:00 ET, Monday–Friday.
 *
 * Canonical source of truth: prefer ``useMarketStatus()`` from
 * ``@/hooks/useQueries``. That hook reads ``/api/v1/market/market-status``
 * which proxies Polygon and Alpaca, both of which honour the
 * NYSE-observed US holiday schedule (MLK, Good Friday, Juneteenth,
 * Independence Day, Labor Day, Thanksgiving, Christmas, ad-hoc closures
 * like the passing-of-Carter on 2025-01-09 etc.). The helpers in this
 * file know NOTHING about holidays or half-day closes (day after
 * Thanksgiving, day before Christmas — both close at 13:00 ET); they
 * are intentionally retained as a synchronous fallback for first-paint
 * (before the hook resolves) and React-Query failure modes so the UI
 * degrades to today's heuristic instead of a hard "unknown" state.
 */

export interface MarketHoursParts {
  weekday: string; // e.g. "Mon"
  hour: number; // 0-23 in ET
  minute: number; // 0-59
}

/** Resolve the current clock in America/New_York — works in all browsers. */
function getNYParts(now: Date = new Date()): MarketHoursParts {
  // `en-US` + `weekday: "short"` returns "Mon", "Tue", …, "Sun".
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let weekday = "";
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = p.value;
    else if (p.type === "hour") {
      // formatToParts can emit "24" for midnight under hour12:false in some runtimes
      const h = parseInt(p.value, 10);
      hour = Number.isFinite(h) ? h % 24 : 0;
    } else if (p.type === "minute") minute = parseInt(p.value, 10) || 0;
  }
  return { weekday, hour, minute };
}

/**
 * Heuristic NYSE-session check: Mon–Fri, 09:30–16:00 ET. Returns ``true``
 * on every weekday during regular hours including US holidays — see the
 * file-level docstring. Use ``useMarketStatus()`` for the holiday-aware
 * answer; this helper is the synchronous fallback for first paint and
 * hook failures.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = getNYParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = hour * 60 + minute;
  const openMins = 9 * 60 + 30; // 09:30
  const closeMins = 16 * 60; // 16:00
  return mins >= openMins && mins < closeMins;
}

/**
 * Rough status for UI labelling. "pre" = before 09:30 ET on a weekday,
 * "post" = after 16:00 ET on a weekday, "closed" = weekend, "open" = regular.
 */
export function getMarketSession(
  now: Date = new Date()
): "open" | "pre" | "post" | "closed" {
  const { weekday, hour, minute } = getNYParts(now);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const mins = hour * 60 + minute;
  const openMins = 9 * 60 + 30;
  const closeMins = 16 * 60;
  if (mins < openMins) return "pre";
  if (mins >= closeMins) return "post";
  return "open";
}
