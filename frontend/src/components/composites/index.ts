/**
 * AlphaDesk composites — Layer 2
 * ──────────────────────────────
 * Surface-specific assemblies of Layer-1 primitives + shadcn ui.
 * Composites take rendered data via props — they do not read from stores
 * or fetch. Import the shared prop types from `./types`.
 */

// chrome-batch-D P1-02 — composites/TopBar removed in favour of the
// canonical `@/components/layout/TopBar`. There is now exactly one
// TopBar in the codebase; the desk and every other dashboard route
// render the same component.

export { default as ContextBar } from "./ContextBar";
export type { ContextBarProps } from "./ContextBar";

export { default as StrategyRail } from "./StrategyRail";
export type { StrategyRailProps } from "./StrategyRail";

export { default as PriceChartPanel } from "./PriceChartPanel";
export type { PriceChartPanelProps } from "./PriceChartPanel";

export { default as OrderBar } from "./OrderBar";
export type { OrderBarProps } from "./OrderBar";

export { default as PositionsList } from "./PositionsList";
export type { PositionsListProps, OrderRow } from "./PositionsList";

export { default as AIMemoPanel } from "./AIMemoPanel";
export type { AIMemoPanelProps } from "./AIMemoPanel";

export { default as StatusBar } from "./StatusBar";
export type { StatusBarProps } from "./StatusBar";

export { default as TickerStrip } from "./TickerStrip";
export type { TickerStripProps } from "./TickerStrip";

export { default as StrategyCard } from "./StrategyCard";
export type { StrategyCardProps } from "./StrategyCard";

export { default as EditorialNameplate } from "./EditorialNameplate";
export type { EditorialNameplateProps } from "./EditorialNameplate";

export { default as ClaudeStamp } from "./ClaudeStamp";
export type { ClaudeStampProps } from "./ClaudeStamp";

// Dashboard redesign 2026-04-20. Watchlist replaces the StrategyRail on
// `/` — strategies list lives on `/strategies` only. Watchlist also
// appears on a future `/trade` focused single-symbol view.
export { default as Watchlist } from "./Watchlist";
export type { WatchlistProps } from "./Watchlist";

export * from "./types";
