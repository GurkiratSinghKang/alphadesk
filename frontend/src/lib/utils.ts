import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  if (Math.abs(value) < 0.005) return "0.00%";
  return percentFmt.format(value / 100);
}

export function formatNumber(value: number, compact = false): string {
  return compact ? numberCompactFmt.format(value) : numberFmt.format(value);
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
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatChangeWithSign(value: number, decimals = 2): string {
  const sign = (value ?? 0) >= 0 ? "+" : "";
  return `${sign}${(value ?? 0).toFixed(decimals)}`;
}
