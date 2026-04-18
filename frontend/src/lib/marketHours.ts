/**
 * marketHours.ts
 * ──────────────
 * DST-correct NYSE session helper. Uses `Intl.DateTimeFormat` with the
 * `America/New_York` timeZone so the window automatically shifts between
 * EST (UTC-5) in winter and EDT (UTC-4) roughly March–November.
 *
 * Regular session: 09:30–16:00 ET, Monday–Friday.
 *
 * NOTE: This helper does not know about NYSE-observed US holidays or
 * half-day closes (e.g. day after Thanksgiving closes at 13:00). The
 * authoritative answer lives on the backend `/api/v1/market/status`
 * endpoint. Use this only for a best-effort client-side indicator.
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

/** Is the NYSE regular session open right now (Mon–Fri, 09:30–16:00 ET)? */
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
