/**
 * intl — locale-aware formatting helpers.
 *
 * These helpers wrap the standard `Intl.*` objects so components can render
 * numbers, currency, percentages, dates, and pluralized nouns according to
 * the user's browser locale + timezone. Pre-existing code hard-coded
 * "en-US" and formatted with manual `.toFixed()`/template-string glue,
 * which produced wrong output for users in de-DE, fr-FR, ja-JP, etc. (e.g.
 * "$100.50" vs "100,50 $", "5m ago" vs "il y a 5 min"), and wrong dates
 * for users outside UTC (date crossing midnight showed tomorrow's label).
 *
 * Tracks bugs B-70 (date TZ), B-71 (currency locale), B-72 (number
 * separators), B-73 (pluralization), B-74 (date weekday name locale).
 *
 * TODO B-75: RTL support — flip sidebar and detail columns when locale is rtl.
 */

/** User's BCP-47 locale tag, e.g. "en-US", "de-DE". Falls back to "en-US". */
export function getUserLocale(): string {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.language || "en-US";
}

/** User's IANA timezone, e.g. "America/New_York". Falls back to "UTC". */
export function getUserTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Format an ISO date string (either "YYYY-MM-DD" or full ISO datetime)
 * per the user's locale + timezone. Bare dates ("YYYY-MM-DD") are
 * anchored to UTC midnight so the label doesn't shift by one day for
 * users east/west of UTC before the final locale conversion.
 */
export function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return new Intl.DateTimeFormat(getUserLocale(), {
    month: "short",
    day: "numeric",
    timeZone: getUserTimezone(),
    ...opts,
  }).format(d);
}

/** Full datetime with time + timezone label, e.g. "Apr 24, 2026, 4:30 PM EDT". */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return new Intl.DateTimeFormat(getUserLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getUserTimezone(),
    timeZoneName: "short",
  }).format(d);
}

/** Locale-aware number formatting. Defaults: no currency, up to 2 decimals. */
export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getUserLocale(), {
    maximumFractionDigits: 2,
    ...opts,
  }).format(n);
}

/**
 * Locale-aware percentage. Accepts a ratio (0.055 → "5.50%" in en-US,
 * "5,50 %" in de-DE). `digits` controls both min and max fraction digits
 * so output length stays stable.
 */
export function fmtPct(n: number, digits = 2): string {
  return new Intl.NumberFormat(getUserLocale(), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Locale-aware currency, defaulting to USD. */
export function fmtCurrency(
  n: number,
  currency = "USD",
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getUserLocale(), {
    style: "currency",
    currency,
    ...opts,
  }).format(n);
}

/**
 * Locale-aware pluralization using `Intl.PluralRules`. Returns
 * "`count` `word`" where the word is `singular` for the "one"
 * plural-rule category and `plural` for all others (or `singular + "s"`
 * if `plural` isn't provided — a coarse English default).
 *
 * B-73: replaces naive `${n} reporting` which always read as singular
 * for count=1 and always appended the same noun-form regardless of
 * locale plural rules.
 */
export function fmtPlural(count: number, singular: string, plural?: string): string {
  const suffix = plural ?? singular + "s";
  try {
    const rule = new Intl.PluralRules(getUserLocale()).select(count);
    const word = rule === "one" ? singular : suffix;
    return `${fmtNumber(count, { maximumFractionDigits: 0 })} ${word}`;
  } catch {
    return `${count} ${count === 1 ? singular : suffix}`;
  }
}

/**
 * Human relative time: "5m ago", "2h ago", "3d ago" — localized via
 * `Intl.RelativeTimeFormat`. Future timestamps produce "in 5m" forms.
 */
export function fmtRelative(iso: string): string {
  const then = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).getTime();
  const diffSec = (Date.now() - then) / 1000;
  const abs = Math.abs(diffSec);
  let unit: Intl.RelativeTimeFormatUnit;
  let value: number;
  if (abs < 60) {
    unit = "second";
    value = -Math.round(diffSec);
  } else if (abs < 3600) {
    unit = "minute";
    value = -Math.round(diffSec / 60);
  } else if (abs < 86400) {
    unit = "hour";
    value = -Math.round(diffSec / 3600);
  } else if (abs < 86400 * 30) {
    unit = "day";
    value = -Math.round(diffSec / 86400);
  } else if (abs < 86400 * 365) {
    unit = "month";
    value = -Math.round(diffSec / (86400 * 30));
  } else {
    unit = "year";
    value = -Math.round(diffSec / (86400 * 365));
  }
  try {
    return new Intl.RelativeTimeFormat(getUserLocale(), { numeric: "auto", style: "narrow" }).format(
      value,
      unit,
    );
  } catch {
    // Absolute-value fallback for environments without RelativeTimeFormat.
    return diffSec >= 0 ? `${Math.abs(value)}${unit[0]} ago` : `in ${Math.abs(value)}${unit[0]}`;
  }
}
