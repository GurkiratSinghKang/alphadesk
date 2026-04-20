/**
 * formatDate — single TZ formatter shared by header, clock, and auth pages.
 *
 * BUG-012 fix: the login nameplate formatted the date via
 * `new Date().toISOString().slice(0, 10)` (UTC), while the desk clock
 * formatted via `toLocaleDateString` with the browser's implicit locale
 * and no `timeZone` option. After 20:00 ET (00:00 UTC) the two disagreed
 * — login showed tomorrow, desk showed today.
 *
 * Always format in America/New_York so ET markets stay aligned with the
 * text the user sees.
 */

const ET = "America/New_York";

/** ISO-like "YYYY-MM-DD" in America/New_York. Default output. */
export function formatDate(
  date: Date = new Date(),
  style: "iso" | "long" = "iso"
): string {
  if (style === "long") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  }
  // Intl doesn't emit ISO directly; derive via en-CA which uses YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "HH:MM:SS" 24h clock in America/New_York. */
export function formatTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ET,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
