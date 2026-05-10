/**
 * MOCK_ARCH_NODES — fixture for the Admin Control Center
 * Architecture Explorer (per v2-plan §1.6d).
 *
 * Each node is a pill-shaped card on the master map graph canvas;
 * groups drive filter chips (All · Ops · Frontend · Backend · Data
 * · Trading · AI · External). Clicking a node loads its detail in
 * the right-panel.
 */

export type ArchGroup =
  | "frontend"
  | "backend"
  | "data"
  | "trading"
  | "ai"
  | "external"
  | "ops";

export type ArchStatus = "ok" | "watch" | "critical" | "deep";

export interface ArchNode {
  id: string;
  name: string;
  group: ArchGroup;
  status: ArchStatus;
  /** One-line caption rendered below the name on the pill. */
  caption: string;
  /** Source-of-truth file paths that this node owns (read in detail panel). */
  reads?: string[];
  writes?: string[];
  controls?: string[];
  state?: string[];
  /** Optional operator-notes callout for this node. */
  operatorNote?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
}

export const MOCK_ARCH_NODES: ArchNode[] = [
  {
    id: "arch-frontend",
    name: "Frontend",
    group: "frontend",
    status: "ok",
    caption: "Next.js 16 / React 19 — dashboard, trade, admin",
    reads: ["frontend/src/app/**"],
    writes: [],
  },
  {
    id: "arch-api",
    name: "API",
    group: "backend",
    status: "ok",
    caption: "FastAPI 0.115 — REST + WebSocket",
    reads: ["backend/api/**"],
    writes: [],
  },
  {
    id: "arch-auth",
    name: "Auth",
    group: "backend",
    status: "ok",
    caption: "JWT + 2FA + magic-link + sessions",
    reads: ["backend/api/routes/auth.py"],
    writes: [],
  },
  {
    id: "arch-pipeline",
    name: "Pipeline",
    group: "backend",
    status: "ok",
    caption: "Ingest → Enrich → Score → Risk → Execute",
    reads: ["backend/data/ingestion/daily_pipeline.py"],
  },
  {
    id: "arch-agents",
    name: "Agents",
    group: "ai",
    status: "ok",
    caption: "Research / Signal / Risk / Exec — AI-backed",
    reads: ["backend/agents/**"],
    operatorNote:
      "Per-agent pause + spend cap will land in B.2; Phase 0 surfaces the controls behind the existing global toggle.",
  },
  {
    id: "arch-broker",
    name: "Broker",
    group: "trading",
    status: "watch",
    caption: "Alpaca paper green, live disabled (no key)",
    reads: ["backend/data/providers/alpaca*.py"],
  },
  {
    id: "arch-marketdata",
    name: "Market data",
    group: "data",
    status: "ok",
    caption: "Polygon quotes + chains + OHLCV",
    reads: ["backend/data/providers/polygon*.py"],
  },
  {
    id: "arch-fundamentals",
    name: "Fundamentals",
    group: "data",
    status: "ok",
    caption: "FMP — earnings, ratios, dividends",
    reads: ["backend/data/providers/fmp*.py"],
  },
  {
    id: "arch-llm",
    name: "LLM",
    group: "external",
    status: "ok",
    caption: "Primary AI provider — daily spend $14.20 / $200",
    reads: ["backend/agents/claude_client.py"],
  },
  {
    id: "arch-postgres",
    name: "Postgres",
    group: "ops",
    status: "ok",
    caption: "TimescaleDB hypertables + alembic 0023",
    reads: ["backend/alembic/**"],
  },
  {
    id: "arch-redis",
    name: "Redis",
    group: "ops",
    status: "ok",
    caption: "Cache + pub/sub + streams + rate limits",
    reads: ["backend/core/redis.py"],
  },
  {
    id: "arch-audit",
    name: "Audit",
    group: "ops",
    status: "ok",
    caption: "Compliance trail — 90d retention sweep weekly",
    reads: ["backend/core/audit.py"],
  },
];

export const MOCK_ARCH_EDGES: ArchEdge[] = [
  { from: "arch-frontend", to: "arch-api" },
  { from: "arch-api", to: "arch-auth" },
  { from: "arch-api", to: "arch-pipeline" },
  { from: "arch-api", to: "arch-agents" },
  { from: "arch-api", to: "arch-broker" },
  { from: "arch-api", to: "arch-marketdata" },
  { from: "arch-pipeline", to: "arch-broker" },
  { from: "arch-pipeline", to: "arch-marketdata" },
  { from: "arch-pipeline", to: "arch-fundamentals" },
  { from: "arch-agents", to: "arch-llm" },
  { from: "arch-broker", to: "arch-postgres" },
  { from: "arch-pipeline", to: "arch-postgres" },
  { from: "arch-api", to: "arch-redis" },
  { from: "arch-api", to: "arch-audit" },
];
