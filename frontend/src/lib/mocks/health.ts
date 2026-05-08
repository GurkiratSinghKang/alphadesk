/**
 * MOCK_HEALTH_TILES — fixture for the Admin Control Center top
 * health tile row (per v2-plan §1.6c, 9 tiles wide).
 *
 * Each tile is at-a-glance system health with a key fact + caption +
 * tone. Critical tone gets a coral-tinted background; watch tone a
 * faint gold tint; clear stays neutral. Click → scrolls to / focuses
 * the related component in the architecture map.
 */

export type HealthTone = "ok" | "watch" | "critical";

export interface HealthTile {
  id: string;
  /** Display name on the tile. */
  name: string;
  /** The "big-status value" — the key fact, mono. */
  value: string;
  /** One-line caption underneath. */
  caption: string;
  tone: HealthTone;
  /** Optional anchor to scroll to in the master map / explorer. */
  anchor?: string;
}

export const MOCK_HEALTH_TILES: HealthTile[] = [
  {
    id: "live-probes",
    name: "Live probes",
    value: "✓ synced",
    caption: "DB + Redis healthy. Last /readyz 4s ago.",
    tone: "ok",
    anchor: "arch-postgres",
  },
  {
    id: "provider-keys",
    name: "Provider keys",
    value: "4 / 6 set",
    caption: "Alpaca key + secret missing. Trading rail blocked.",
    tone: "critical",
    anchor: "keys-alpaca",
  },
  {
    id: "trading-safety",
    name: "Trading safety",
    value: "armed",
    caption: "No halt active. Rate limits within range.",
    tone: "ok",
    anchor: "trade-halt",
  },
  {
    id: "risk-gates",
    name: "Risk gates",
    value: "1 watch",
    caption: "Sector cap at 38.4 / 35%. AI risk-agent flagged.",
    tone: "watch",
    anchor: "risk-sector-cap",
  },
  {
    id: "pipeline",
    name: "Pipeline",
    value: "5 / 5 running",
    caption: "Last cycle 8m ago. Score queue 0.",
    tone: "ok",
    anchor: "pipeline-stages",
  },
  {
    id: "broker-rails",
    name: "Broker rails",
    value: "1 / 2 up",
    caption: "Alpaca paper green. Live blocked (no key).",
    tone: "watch",
    anchor: "data-rail-alpaca",
  },
  {
    id: "ai-research",
    name: "AI research",
    value: "running",
    caption: "Claude spend $14.20 / $200 daily cap (7%).",
    tone: "ok",
    anchor: "ai-archetype-research",
  },
  {
    id: "strategies",
    name: "Strategies",
    value: "2 / 3 active",
    caption: "Earnings options paused. Operator stop.",
    tone: "watch",
    anchor: "strategy-earnings-options",
  },
  {
    id: "deploy-rail",
    name: "Deploy rail",
    value: "main green",
    caption: "Last prod deploy 4h ago by operator. Staging idle.",
    tone: "ok",
    anchor: "deploy-prod-frontend",
  },
];
