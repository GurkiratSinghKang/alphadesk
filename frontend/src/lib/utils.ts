import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// AlphaDesk type-token classes (`text-eyebrow`, `text-label`, `text-body`,
// `text-h1`, `text-display-md`, …) are not Tailwind built-ins, so the bare
// `twMerge` puts them in the same conflict group as colour utilities like
// `text-primary-foreground`. Result: `cn("text-label", "text-primary-foreground")`
// drops the colour, leaving the gold "Create alert" CTA invisible on a gold
// background. Register the tokens as their own font-size group so size-tokens
// and colour-tokens can coexist on the same element.
const merge = extendTailwindMerge({
  override: {
    classGroups: {
      "font-size": [
        {
          text: [
            "eyebrow",
            "label",
            "body-sm",
            "body",
            "h1",
            "h2",
            "h3",
            "display-sm",
            "display-md",
            "display-lg",
            "display-xl",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}

// ─── Currency & Number Formatting ────────────────────────────

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyCompactFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

const numberFmt = new Intl.NumberFormat("en-US");

const numberCompactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(value: number, compact = false): string {
  const v = Number.isFinite(value) ? value : 0;
  return compact ? currencyCompactFmt.format(v) : currencyFmt.format(v);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  if (Math.abs(value) < 0.005) return "0.00%";
  return percentFmt.format(value / 100);
}

export function formatNumber(value: number, compact = false): string {
  const v = Number.isFinite(value) ? value : 0;
  return compact ? numberCompactFmt.format(v) : numberFmt.format(v);
}

/**
 * Format greek values: +0.35 for delta, -0.02 for theta, etc.
 */
export function formatGreek(value: number, decimals = 4): string {
  const sign = (value ?? 0) >= 0 ? "+" : "";
  return `${sign}${(value ?? 0).toFixed(decimals)}`;
}

/**
 * Returns the appropriate color class based on the value's sign.
 */
export function getChangeColor(value: number): string {
  if (value > 0) return "profit";
  if (value < 0) return "loss";
  return "neutral";
}

/**
 * Returns the appropriate text color class for Tailwind.
 */
export function getChangeTextClass(value: number): string {
  if (value > 0) return "text-[var(--profit)]";
  if (value < 0) return "text-[var(--loss)]";
  return "text-[var(--neutral)]";
}

export function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts)) return "--:--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatChangeWithSign(value: number, decimals = 2): string {
  const sign = (value ?? 0) >= 0 ? "+" : "";
  return `${sign}${(value ?? 0).toFixed(decimals)}`;
}

/**
 * Parse a string to a finite number, returning `fallback` for empty / NaN /
 * Infinity inputs. Unlike `parseFloat(s) || fallback`, this preserves
 * legitimate `0` entries — critical for position-sizing / stop-loss /
 * take-profit inputs where `0` is a user-meaningful value (disable /
 * no-TP), not "missing".
 *
 * NOTE: If you need a value strictly greater than zero, add a separate
 * validation step downstream — do not bake the "treat 0 as 1" rule into
 * the parse.
 */
export function safeNum(s: string, fallback = 0): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}
