/**
 * AlphaDesk layouts — Layer 3
 * ───────────────────────────
 * Route-level shells that compose Layer-2 composites into a surface.
 * Layouts take no data — they are pure slot compositions. The page
 * (Layer 4) is responsible for wiring stores/queries to composite props.
 */

export { default as DeskLayout } from "./DeskLayout";
export type { DeskLayoutProps } from "./DeskLayout";

// 2026-04-20 dashboard redesign shell. Two-column (no left rail) — the
// strategies rail was removed from `/` per owner feedback since it
// duplicates `/strategies`. New shell hosts ChartPane + Watchlist +
// Book + optional AI memo in a denser pro-grade layout.
export { default as DashboardLayout } from "./DashboardLayout";
export type { DashboardLayoutProps } from "./DashboardLayout";

export { default as MarketingShell } from "./MarketingShell";
export { default as StaticArticle } from "./StaticArticle";
export { default as DashboardPageLayout } from "./DashboardPageLayout";
export type { DashboardPageLayoutProps } from "./DashboardPageLayout";
export { EditorialBullet, EditorialP, MailA, ExternalA } from "./editorial";
