/**
 * AlphaDesk primitives — Layer 1
 * ──────────────────────────────
 * Atoms that form the foundation for composites and layouts.
 * A primitive never reaches into a store, fetcher, or composite.
 */

export { default as StatusDot } from "./StatusDot";
export type { StatusDotProps, StatusDotTone } from "./StatusDot";

export { default as PnLNumber } from "./PnLNumber";
export type { PnLNumberProps, PnLFormat } from "./PnLNumber";

export { default as RegimePill } from "./RegimePill";
export type { RegimePillProps, Regime, RegimeVol } from "./RegimePill";

export { default as NumericChip } from "./NumericChip";
export type { NumericChipProps, NumericChipTone } from "./NumericChip";

export { default as Sparkline } from "./Sparkline";
export type { SparklineProps, SparklineTone } from "./Sparkline";
