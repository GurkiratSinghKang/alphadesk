/**
 * AlphaDesk composites — shared prop types (Layer 2)
 * ──────────────────────────────────────────────────
 * These interfaces are the contract between Layer-2 composites and the
 * Layer-3 layouts / Layer-4 pages that will wire them to real data in F3.
 *
 * Composites are presentation-only: they receive rendered data via props,
 * never fetch, never read from stores. Keep these types narrow — they
 * describe display-ready data, not domain models.
 */
import type { Regime, RegimeVol } from "@/components/primitives/RegimePill";

/* ─── Top bar ──────────────────────────────────────────────── */

export interface NavRoute {
  label: string;
  href: string;
  active?: boolean;
}

export interface RegimeProps {
  regime: Regime;
  vol?: RegimeVol;
  /** Optional override body text; falls back to "{regime} · {vol}". */
  label?: string;
}

/* ─── Context bar ──────────────────────────────────────────── */

export interface ContextCell {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "profit" | "loss";
  /** Optional tone for the main value — used by Day P&L so negatives render coral. */
  valueTone?: "profit" | "loss" | "muted";
  /** Hero cell — gold-300 value, slightly larger. */
  emphasis?: boolean;
}

/* ─── Strategy rail ────────────────────────────────────────── */

export interface StrategyRailItem {
  id: string;
  name: string;
  subtitle: string;
  status: "active" | "paused";
  /** null when paused / n/a. */
  returnPct: number | null;
  /** "01", "02", … */
  indexLabel: string;
}

/* ─── Price chart ──────────────────────────────────────────── */

export interface MarketSymbol {
  ticker: string;
  name: string;
  /** "Nasdaq · Semis" etc. */
  venue: string;
}

export interface Quote {
  last: number;
  change: number;
  changePct: number;
}

export interface MetaCells {
  volume: string;
  avgVolume: string;
  range: string;
  iv: string;
  regimeFit: number;
}

export interface ChartPoint {
  time: number;
  value: number;
}

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface RegimeBand {
  /** Unix seconds. */
  fromTime: number;
  toTime: number;
  tone: "bull" | "bear" | "neutral";
}

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

/* ─── Order bar ────────────────────────────────────────────── */

export interface StrategyOption {
  id: string;
  label: string;
}

export type OrderSide = "buy" | "sell";
export type OrderTypeOption = "market" | "limit" | "stop" | "stop_limit";

export interface StagedOrder {
  strategyId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  type: OrderTypeOption;
  price?: number;
  stop?: string;
}

/* ─── Positions list ───────────────────────────────────────── */

export type PositionTab = "positions" | "orders" | "journal";

export interface PositionRow {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  strategyName: string;
  /** -1.0 … +1.0 — drives the progress bar width + tone. */
  progress: number;
  pnl: number;
  pnlPct: number;
}

/* ─── AI memo ──────────────────────────────────────────────── */

export interface AIMemoChip {
  label: string;
  tone: "profit" | "loss" | "ice" | "muted";
}

export interface AIMemo {
  text: string;
  chips: AIMemoChip[];
  /** 0..1 */
  confidence: number;
  model: string;
  latencyMs: number;
  /** ISO or display time "14:32:08". */
  timestamp: string;
}

/* ─── Status bar ───────────────────────────────────────────── */

export interface StatusPill {
  label: string;
  tone: "profit" | "amber" | "muted";
  /** Optional remediation link — rendered as an inline "→ Configure"
   *  anchor after the label. Used by the broker-offline pill (persona-94
   *  #1) so a first-time user sees a fix path, not a dead state. */
  href?: string;
  /** Optional short call-to-action label for the `href`. Defaults to
   *  "Fix". Kept terse so the 22px status rail doesn't blow its height. */
  hrefLabel?: string;
  /** Optional native-tooltip text surfaced via `title`. Useful when the
   *  label itself is already terse but readers need more detail on hover. */
  title?: string;
}

/* ─── Ticker strip ─────────────────────────────────────────── */

export interface TickerEntry {
  symbol: string;
  price: string;
  deltaPct: number;
}
