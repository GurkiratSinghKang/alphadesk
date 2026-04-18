/**
 * AlphaDesk layouts — Layer 3
 * ───────────────────────────
 * Route-level shells that compose Layer-2 composites into a surface.
 * Layouts take no data — they are pure slot compositions. The page
 * (Layer 4) is responsible for wiring stores/queries to composite props.
 */

export { default as DeskLayout } from "./DeskLayout";
export type { DeskLayoutProps } from "./DeskLayout";

export { default as MarketingShell } from "./MarketingShell";
export { default as StaticArticle } from "./StaticArticle";
export { EditorialBullet, EditorialP, MailA, ExternalA } from "./editorial";
