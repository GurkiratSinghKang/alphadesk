/**
 * accountEquity.ts
 * ────────────────
 * Single source of truth for "what is the account's current equity?" —
 * used by Analytics to scale returns/drawdowns/monthly heatmap without
 * hardcoding a base of $100,000.
 *
 * Priority order:
 *   1. `usePortfolioStore.summary.equity` (live, fetched by the dashboard
 *      polling pipeline). This is the authoritative value when the
 *      dashboard has already hydrated.
 *   2. A fallback value from the passed-in equity curve: the last point's
 *      `value` field (already the true equity level, emitted by the
 *      backend's `_build_performance_from_pnls`).
 *
 * Returns `null` when neither is available so callers can render a
 * proper loading / empty state instead of scaling by a bogus zero.
 */
import { usePortfolioStore } from "@/stores/portfolio";

export interface EquityCurveLike {
  value?: number | null;
  cumulative_pnl?: number | null;
}

/**
 * React hook: read the live portfolio equity from the Zustand store.
 * Returns `null` if the store hasn't populated yet (initial `equity: 0`
 * default is treated as "not loaded" — a real account is never exactly 0
 * unless liquidated, which is handled as a separate UX concern).
 */
export function useAccountEquity(): number | null {
  const equity = usePortfolioStore((s) => s.summary.equity);
  if (typeof equity !== "number" || !Number.isFinite(equity) || equity <= 0) {
    return null;
  }
  return equity;
}

/**
 * Derive a per-point equity value from an equity-curve point.
 *
 * Important: at time of writing (Wave 12 is still in flight) the backend
 * emits `value === cumulative_pnl`, i.e. `value` is NOT the true equity
 * level yet. To be robust to both the current and the post-Wave-12
 * backend, we detect the current shape: if `value` looks like a raw
 * cumulative P&L (small number relative to `baseEquity`) we treat it as
 * cumulative_pnl; otherwise we trust it as a real equity level.
 *
 * Heuristic: equity ≥ 10% of baseEquity implies the backend is already
 * emitting real equity. If the absolute `value` is much smaller than
 * that (or the curve explicitly carries `cumulative_pnl`), compute
 * `baseEquity + cumulative_pnl`. `baseEquity` should be the account's
 * current or starting equity — never a hardcoded constant.
 */
export function equityAtPoint(
  pt: EquityCurveLike,
  baseEquity: number,
): number {
  const cum = typeof pt.cumulative_pnl === "number" ? pt.cumulative_pnl : 0;
  const v = typeof pt.value === "number" && Number.isFinite(pt.value) ? pt.value : null;

  // When `value` and `cumulative_pnl` agree, the backend is emitting
  // the legacy shape (value === cumulative_pnl). Fall back to
  // baseEquity + cumulative_pnl.
  if (v !== null && v === cum) {
    return baseEquity + cum;
  }
  // If `value` is set and clearly represents the equity level (orders of
  // magnitude larger than cumulative_pnl, or comparable to baseEquity),
  // trust it directly — this matches the intended post-Wave-12 shape.
  if (v !== null && baseEquity > 0 && Math.abs(v) >= baseEquity * 0.1) {
    return v;
  }
  return baseEquity + cum;
}

/**
 * Best-effort starting equity for a curve: use the first point's `value`
 * if present (most accurate — this is what the equity curve started at),
 * otherwise fall back to `currentEquity - totalPnl`.
 */
export function startingEquity(
  curve: EquityCurveLike[],
  currentEquity: number,
): number {
  if (curve.length === 0) return currentEquity;
  const first = curve[0];
  if (typeof first.value === "number" && Number.isFinite(first.value) && first.value > 0) {
    return first.value;
  }
  const last = curve[curve.length - 1];
  const lastCum = typeof last.cumulative_pnl === "number" ? last.cumulative_pnl : 0;
  const firstCum = typeof first.cumulative_pnl === "number" ? first.cumulative_pnl : 0;
  // currentEquity = startingEquity + lastCum. Solve for startingEquity:
  const starting = currentEquity - lastCum + firstCum;
  return starting > 0 ? starting : currentEquity;
}
