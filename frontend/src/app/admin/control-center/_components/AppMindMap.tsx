"use client";

import {
  ArrowSquareOut,
  ArrowsOutCardinal,
  ChartLineUp,
  Code,
  Crosshair,
  Database,
  Files,
  GearSix,
  GitBranch,
  Graph,
  Key,
  ListChecks,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Pulse,
  PlugsConnected,
  Robot,
  ShieldCheck,
  Siren,
  Stack,
  TreeStructure,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  getAdminBackendKeys,
  getBrokerConnections,
  getHaltStatus,
  getLastDeploy,
  getLayoutConfig,
  getPipelineStatus,
  getRiskMonitorState,
  getStrategies,
  getTradingAgentsRuntimeStatus,
  type AdminBackendKey,
  type BrokerConnection,
  type DeployResult,
  type HaltStatus,
  type LayoutConfig,
  type PipelineStatus,
  type RiskMonitorState,
  type TradingAgentsRuntimeStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Domain =
  | "platform"
  | "ops"
  | "frontend"
  | "backend"
  | "data"
  | "trading"
  | "ai"
  | "external";

type NodeKind =
  | "platform"
  | "ops"
  | "frontend"
  | "backend"
  | "data"
  | "trading"
  | "ai"
  | "external"
  | "state"
  | "control";

type Tone = "healthy" | "active" | "watch" | "risk" | "muted";

type PhosphorIcon = ComponentType<{
  className?: string;
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}>;

interface MindLink {
  label: string;
  href: string;
}

interface MindNode {
  id: string;
  label: string;
  domain: Domain;
  kind: NodeKind;
  level: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  width: number;
  height: number;
  minZoom: number;
  maxZoom?: number;
  parentId?: string;
  connectedTo?: string[];
  statusLabel: string;
  health: string;
  tone: Tone;
  metric?: string;
  description: string;
  backlog?: string;
  reads?: string[];
  writes?: string[];
  controls?: string[];
  files?: string[];
  links?: MindLink[];
}

interface TriageItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  nodeId: string;
  icon: PhosphorIcon;
}

type StrategyList = Awaited<ReturnType<typeof getStrategies>>;

interface RuntimeSnapshot {
  loading: boolean;
  updatedAt: string | null;
  errors: string[];
  pipeline?: PipelineStatus;
  riskMonitor?: RiskMonitorState;
  halt?: HaltStatus;
  strategies?: StrategyList;
  brokerConnections?: BrokerConnection[];
  lastDeploy?: DeployResult & { actor?: string | null };
  layout?: LayoutConfig;
  keys?: AdminBackendKey[];
  tradingAgents?: TradingAgentsRuntimeStatus;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

type MapDisplayMode = "detail" | "compact" | "context";

interface RenderedMindNode extends MindNode {
  displayMode: MapDisplayMode;
}

const WORLD = { width: 2200, height: 1500 };
const SCALE = { min: 0.32, max: 2.2 };
const SOURCE_ROOT =
  "https://github.com/GurkiratSinghKang/alphadesk/blob/feature/deployment/";

const ARCHITECTURE_DEPTHS = [
  { id: "overview", label: "Overview", detail: "Platform", scale: 0.42 },
  { id: "systems", label: "Systems", detail: "Domains", scale: 0.82 },
  { id: "services", label: "Services", detail: "Routes", scale: 1.18 },
  { id: "state", label: "State", detail: "Files", scale: 1.62 },
] as const;

const DOMAIN_LABELS: Array<{ id: Domain | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "ops", label: "Ops" },
  { id: "frontend", label: "Frontend" },
  { id: "backend", label: "Backend" },
  { id: "data", label: "Data" },
  { id: "trading", label: "Trading" },
  { id: "ai", label: "AI" },
  { id: "external", label: "External" },
];

const KIND_ICONS: Record<NodeKind, PhosphorIcon> = {
  platform: Graph,
  ops: GearSix,
  frontend: Stack,
  backend: Code,
  data: Database,
  trading: ChartLineUp,
  ai: Robot,
  external: PlugsConnected,
  state: Files,
  control: ShieldCheck,
};

const COMPONENT_NODES: MindNode[] = [
  {
    id: "platform",
    label: "AlphaDesk platform",
    domain: "platform",
    kind: "platform",
    level: 0,
    x: 930,
    y: 630,
    width: 350,
    height: 150,
    minZoom: 0,
    maxZoom: 1.5,
    statusLabel: "Static map ready",
    health: "Live probes pending",
    tone: "active",
    metric: "FastAPI plus Next plus trading engine",
    description:
      "Single-tenant trading terminal spanning browser, API, state stores, strategy orchestration, broker execution, and operator controls.",
    backlog: "Leader election is still required before horizontal backend scaling.",
    reads: ["docs/ARCHITECTURE.md", "README.md", "backend/main.py"],
    writes: ["app_config", "pipeline_logs", "trades", "audit_log", "Redis halt and stream keys"],
    controls: ["/admin/control-center", "/trade halt", "/pipeline run", "GitHub deploy dispatch"],
    files: ["docs/ARCHITECTURE.md", "backend/main.py", "frontend/src/app/layout.tsx"],
    links: [
      { label: "Architecture docs", href: "/docs" },
      { label: "Dashboard", href: "/" },
    ],
    connectedTo: ["frontend", "backend", "data-plane", "trading-engine", "ops-console", "ai-plane", "external-rails"],
  },
  {
    id: "edge-delivery",
    label: "Edge and delivery",
    domain: "ops",
    kind: "ops",
    level: 1,
    x: 890,
    y: 78,
    width: 420,
    height: 128,
    minZoom: 0,
    statusLabel: "TLS, CSP, deploys",
    health: "Mapped from docs",
    tone: "healthy",
    metric: "Caddy, GH Actions, Docker Compose",
    description:
      "Caddy terminates TLS and security headers. GitHub Actions builds and deploys frontend and backend images to the compose host.",
    backlog: "Production rollback remains manual once schema downgrade is involved.",
    reads: ["docker-compose.yml", "infrastructure/*", ".github/workflows/deploy.yml"],
    writes: ["GHCR images", "VPS compose state", "Caddy ACME storage"],
    controls: ["Deploy workflow dispatch", "Rollback workflow_dispatch"],
    files: ["docs/DEPLOYMENT.md", "docs/ROLLBACK.md", "infrastructure/docker-compose.prod.yml"],
    connectedTo: ["frontend", "backend", "deploy-trigger", "github-deploy"],
  },
  {
    id: "frontend",
    label: "Frontend application",
    domain: "frontend",
    kind: "frontend",
    level: 1,
    x: 140,
    y: 330,
    width: 420,
    height: 140,
    minZoom: 0,
    statusLabel: "Next app router",
    health: "Client state plus RSC shell",
    tone: "healthy",
    metric: "Next 16, React 19, Tailwind v4",
    description:
      "The browser command surface: dashboard, trade ticket, pipeline views, strategy pages, symbol research, and admin runtime controls.",
    backlog: "Several dashboard routes still carry large page-level components.",
    reads: ["API JSON", "WebSocket events", "localStorage-backed stores"],
    writes: ["Zustand persisted preferences", "web-vitals beacons", "admin layout PATCH"],
    controls: ["Command palette", "Halt button", "Dashboard layout toggles"],
    files: ["frontend/src/app", "frontend/src/components", "frontend/src/lib/api.ts"],
    connectedTo: ["api-client", "dashboard-shell", "admin-control-center", "websocket-provider"],
  },
  {
    id: "backend",
    label: "Backend application",
    domain: "backend",
    kind: "backend",
    level: 1,
    x: 880,
    y: 330,
    width: 455,
    height: 145,
    minZoom: 0,
    statusLabel: "FastAPI route mesh",
    health: "Singleton worker model",
    tone: "healthy",
    metric: "REST, WS, lifespan services",
    description:
      "FastAPI owns auth, route validation, data access, websocket fan-out, lifespan background jobs, and operational health probes.",
    backlog: "Singleton background jobs need a distributed lock before worker count increases.",
    reads: ["TimescaleDB", "Redis", "env and app_config", "external APIs"],
    writes: ["audit_log", "pipeline_logs", "trades", "Redis streams and locks"],
    controls: ["require_auth", "require_admin", "rate-limit middleware"],
    files: ["backend/main.py", "backend/api/routes", "backend/core"],
    connectedTo: ["rest-routes", "websocket-hub", "auth-rate-limit", "health-probes", "timescale", "redis"],
  },
  {
    id: "data-plane",
    label: "State and memory",
    domain: "data",
    kind: "data",
    level: 1,
    x: 1600,
    y: 330,
    width: 410,
    height: 145,
    minZoom: 0,
    statusLabel: "Durable and hot state",
    health: "Mapped stores",
    tone: "healthy",
    metric: "TimescaleDB, Redis, app_config",
    description:
      "Durable state lives in Timescale/Postgres; hot operational state, idempotency, halt flags, and websocket fan-out live in Redis.",
    backlog: "State ownership is spread across DB tables, Redis keys, env, and local stores.",
    reads: ["SQLAlchemy models", "Redis keys", "Alembic migrations"],
    writes: ["market_bars", "trades", "positions", "pipeline_logs", "app_config"],
    controls: ["Migrations", "retention sweeps", "runtime admin config"],
    files: ["backend/data/storage/models.py", "backend/core/redis.py", "backend/services/app_config.py"],
    connectedTo: ["timescale", "redis", "app-config", "audit-log"],
  },
  {
    id: "ops-console",
    label: "Admin control surface",
    domain: "ops",
    kind: "ops",
    level: 1,
    x: 1420,
    y: 615,
    width: 405,
    height: 140,
    minZoom: 0,
    statusLabel: "Admin gated",
    health: "Runtime controls",
    tone: "active",
    metric: "Keys, layout, halt, risk, deploy",
    description:
      "Operator-facing controls for mutable runtime state: credentials, dashboard composition, deploy trigger, risk monitor, and emergency trading state.",
    backlog: "The architecture map is read-only for now; write controls stay in their existing panels.",
    reads: ["admin control-center endpoints", "trades halt-status", "risk-monitor state"],
    writes: ["app_config", "Redis halt key", "risk monitor overlay", "GitHub workflow_dispatch"],
    controls: ["Backend key rotation", "Dashboard layout PATCH", "Production deploy trigger"],
    files: ["frontend/src/app/admin/control-center/page.tsx", "backend/api/routes/admin_control.py"],
    connectedTo: ["backend-keys", "dashboard-layout", "system-halt", "risk-monitor", "deploy-trigger"],
  },
  {
    id: "trading-engine",
    label: "Trading engine",
    domain: "trading",
    kind: "trading",
    level: 1,
    x: 830,
    y: 968,
    width: 520,
    height: 160,
    minZoom: 0,
    statusLabel: "Master-agent gated",
    health: "Safety critical",
    tone: "watch",
    metric: "Scheduler, strategies, gates, orders",
    description:
      "Scheduled and realtime strategy signals pass through the master agent, risk gates, live-trading gate, broker submission, and reconciliation loops.",
    backlog: "Broker submission safety depends on durable ledger and idempotency boundaries staying intact.",
    reads: ["Strategy registry", "portfolio state", "market data", "risk monitor"],
    writes: ["orders", "trades", "strategy disabled events", "pipeline logs"],
    controls: ["Halt trading", "Strategy kill switches", "Risk monitor toggle"],
    files: ["backend/data/ingestion/master_agent.py", "backend/data/ingestion/daily_pipeline.py", "backend/api/routes/trades.py"],
    connectedTo: ["pipeline-scheduler", "master-agent", "strategy-registry", "risk-gates", "order-management", "reconcilers"],
  },
  {
    id: "ai-plane",
    label: "AI and research",
    domain: "ai",
    kind: "ai",
    level: 1,
    x: 160,
    y: 960,
    width: 430,
    height: 148,
    minZoom: 0,
    statusLabel: "AI assisted",
    health: "Provider dependent",
    tone: "watch",
    metric: "Agents, prompts, TradingAgents",
    description:
      "Research and analysis agents produce symbol theses, strategy refinement, screener context, and optional TradingAgents runs.",
    backlog: "Provider readiness and local runtime bootstrap need to be obvious before operators launch research.",
    reads: ["Provider keys", "symbol data", "strategy context", "prompts"],
    writes: ["research run records", "artifact files", "analysis responses"],
    controls: ["TradingAgents run start", "Agent chat", "Strategy refine"],
    files: ["backend/agents", "backend/services/tradingagents_research.py", "backend/tools/tradingagents"],
    connectedTo: ["analysis-agents", "ai-prompts", "tradingagents-runtime", "pii-scrubber"],
  },
  {
    id: "external-rails",
    label: "External rails",
    domain: "external",
    kind: "external",
    level: 1,
    x: 1575,
    y: 960,
    width: 425,
    height: 148,
    minZoom: 0,
    statusLabel: "Broker and data providers",
    health: "Key dependent",
    tone: "watch",
    metric: "Alpaca, Polygon, FMP, TradingView",
    description:
      "Provider clients supply broker execution, live market data, options chains, fundamentals, earnings data, and webhook entry points.",
    backlog: "Provider outages must degrade loudly without allowing unsafe order paths.",
    reads: ["Runtime backend keys", "broker credentials", "provider caches"],
    writes: ["provider cache", "broker reconciliation issues", "webhook alerts"],
    controls: ["Broker connections", "HMAC webhook secret", "provider key rotation"],
    files: ["backend/data/providers", "backend/services/broker_connections.py", "backend/api/routes/webhooks.py"],
    connectedTo: ["alpaca", "polygon", "fmp", "tradingview", "github-deploy"],
  },
  {
    id: "next-app-router",
    label: "Next app router",
    domain: "frontend",
    kind: "frontend",
    level: 2,
    x: 58,
    y: 510,
    width: 260,
    height: 116,
    minZoom: 0.68,
    parentId: "frontend",
    statusLabel: "Routes and layouts",
    health: "SSR plus client leaves",
    tone: "healthy",
    metric: "app directory",
    description:
      "Route groups separate public pages, dashboard pages, symbol pages, and the admin control center.",
    backlog: "Some large pages need smaller section ownership boundaries.",
    reads: ["Providers", "route params", "API client"],
    writes: ["web-vitals beacon", "client state through leaf components"],
    files: ["frontend/src/app/layout.tsx", "frontend/src/app/(dashboard)", "frontend/src/app/admin/control-center"],
    connectedTo: ["frontend-routes-state", "providers-root"],
  },
  {
    id: "dashboard-shell",
    label: "Dashboard shell",
    domain: "frontend",
    kind: "frontend",
    level: 2,
    x: 342,
    y: 500,
    width: 275,
    height: 128,
    minZoom: 0.68,
    parentId: "frontend",
    statusLabel: "Chrome and overlays",
    health: "Mounted on auth routes",
    tone: "healthy",
    metric: "TopBar, command palette, copilot",
    description:
      "Shared dashboard chrome manages the top bar, websocket banners, session expiry, command palette, AI copilot, and onboarding overlays.",
    reads: ["Keyboard shortcuts", "notifications", "API error events"],
    writes: ["toast state", "banner dismissals", "query invalidations"],
    files: ["frontend/src/app/(dashboard)/layout.tsx", "frontend/src/components/layout"],
    connectedTo: ["websocket-provider", "frontend-stores"],
  },
  {
    id: "admin-control-center",
    label: "Control Center page",
    domain: "ops",
    kind: "control",
    level: 2,
    x: 1140,
    y: 792,
    width: 285,
    height: 128,
    minZoom: 0.72,
    parentId: "ops-console",
    statusLabel: "This screen",
    health: "New mind map mounted",
    tone: "active",
    metric: "/admin/control-center",
    description:
      "Admin page that now combines the architecture mind map with existing runtime key, layout, and deploy panels.",
    backlog: "Next step is wiring write-capable graph actions behind the same admin gates.",
    reads: ["keys", "layout", "deploy/last", "pipeline", "halt", "risk monitor"],
    writes: ["Existing panels write keys, layout, deploy only"],
    files: ["frontend/src/app/admin/control-center/page.tsx", "frontend/src/app/admin/control-center/_components/AppMindMap.tsx"],
    links: [{ label: "Open page", href: "/admin/control-center" }],
  },
  {
    id: "api-client",
    label: "Frontend API client",
    domain: "frontend",
    kind: "frontend",
    level: 2,
    x: 415,
    y: 662,
    width: 280,
    height: 120,
    minZoom: 0.74,
    parentId: "frontend",
    statusLabel: "Typed fetch wrappers",
    health: "Centralized errors",
    tone: "healthy",
    metric: "apiFetch with timeout",
    description:
      "Central request wrapper handles credentials, timeout, retry-after parsing, global API degradation events, and typed endpoint helpers.",
    backlog: "Several legacy helpers still sit in one large file.",
    reads: ["NEXT_PUBLIC_API_URL", "HttpOnly auth cookies", "endpoint JSON"],
    writes: ["Custom browser events for degraded broker/API state"],
    files: ["frontend/src/lib/api.ts", "frontend/src/env.ts"],
    connectedTo: ["api-client-state", "rest-routes"],
  },
  {
    id: "frontend-stores",
    label: "Frontend stores",
    domain: "frontend",
    kind: "state",
    level: 2,
    x: 72,
    y: 682,
    width: 275,
    height: 120,
    minZoom: 0.82,
    parentId: "frontend",
    statusLabel: "Zustand and local state",
    health: "Client only",
    tone: "muted",
    metric: "portfolio, market, UI, prefs",
    description:
      "Persistent and session UI state for preferences, market data, alerts, notifications, portfolio, and options workflows.",
    backlog: "State boundaries need to remain client-only under the RSC app router.",
    reads: ["localStorage", "WebSocket provider", "React Query"],
    writes: ["localStorage", "in-memory store slices"],
    files: ["frontend/src/stores", "frontend/src/hooks/useDataPipeline.ts"],
    connectedTo: ["frontend-stores-state", "websocket-provider"],
  },
  {
    id: "websocket-provider",
    label: "WebSocket provider",
    domain: "frontend",
    kind: "frontend",
    level: 2,
    x: 622,
    y: 520,
    width: 265,
    height: 120,
    minZoom: 0.84,
    parentId: "frontend",
    statusLabel: "Auth route provider",
    health: "Browser only",
    tone: "healthy",
    metric: "market, portfolio, alerts",
    description:
      "Dynamic provider mounts only on authenticated dashboard routes and fans websocket updates into stores and notifications.",
    backlog: "Route detection must include every protected dashboard path that consumes useWs.",
    reads: ["backend WS hub", "navigator/WebSocket"],
    writes: ["WebSocketContext", "data pipeline bridge"],
    files: ["frontend/src/lib/providers.tsx", "frontend/src/lib/providers/WebSocketProvider.tsx"],
    connectedTo: ["websocket-hub"],
  },
  {
    id: "providers-root",
    label: "Provider root",
    domain: "frontend",
    kind: "state",
    level: 3,
    x: 630,
    y: 388,
    width: 230,
    height: 96,
    minZoom: 1.25,
    parentId: "next-app-router",
    statusLabel: "React Query, toasts, tooltips",
    health: "Client provider island",
    tone: "muted",
    metric: "gcTime 10 min",
    description:
      "Root client provider wraps query caching, theme control, toast, tooltip, websocket, and data bridge wiring.",
    files: ["frontend/src/lib/providers.tsx"],
    reads: ["pathname", "localStorage prefs"],
    writes: ["Query cache", "context providers"],
  },
  {
    id: "frontend-routes-state",
    label: "Route inventory",
    domain: "frontend",
    kind: "state",
    level: 3,
    x: 68,
    y: 385,
    width: 230,
    height: 96,
    minZoom: 1.25,
    parentId: "next-app-router",
    statusLabel: "Dashboard, trade, strategies",
    health: "App router state",
    tone: "muted",
    metric: "public plus auth routes",
    description:
      "Important routes include dashboard, trade, pipeline, reports, alerts, settings, strategies, symbols, and admin control.",
    files: ["frontend/src/app/(dashboard)", "frontend/src/app/symbols/[ticker]", "frontend/src/app/admin/control-center"],
    links: [
      { label: "Pipeline", href: "/pipeline" },
      { label: "Trade", href: "/trade" },
    ],
  },
  {
    id: "api-client-state",
    label: "API wire contracts",
    domain: "frontend",
    kind: "state",
    level: 3,
    x: 420,
    y: 818,
    width: 240,
    height: 96,
    minZoom: 1.28,
    parentId: "api-client",
    statusLabel: "Types mirror backend",
    health: "Shared contract file",
    tone: "muted",
    metric: "Timeout, credentials, errors",
    description:
      "TypeScript interfaces mirror backend response models for portfolio, strategies, pipeline, broker, admin, and TradingAgents.",
    files: ["frontend/src/lib/api.ts", "frontend/src/types/index.ts"],
    reads: ["FastAPI JSON"],
    writes: ["Browser custom events"],
  },
  {
    id: "frontend-stores-state",
    label: "Client state files",
    domain: "frontend",
    kind: "state",
    level: 3,
    x: 85,
    y: 830,
    width: 240,
    height: 96,
    minZoom: 1.28,
    parentId: "frontend-stores",
    statusLabel: "Important write surface",
    health: "Local operator state",
    tone: "muted",
    metric: "alerts, options, market, prefs",
    description:
      "The master control view should eventually read which stores are persisted, volatile, or fed by websocket events.",
    files: ["frontend/src/stores/alerts.ts", "frontend/src/stores/preferences.ts", "frontend/src/stores/portfolio.ts"],
    reads: ["WebSocket events", "API responses"],
    writes: ["localStorage", "in-memory store"],
  },
  {
    id: "fastapi-main",
    label: "FastAPI main",
    domain: "backend",
    kind: "backend",
    level: 2,
    x: 835,
    y: 198,
    width: 270,
    height: 118,
    minZoom: 0.66,
    parentId: "backend",
    statusLabel: "Lifespan owner",
    health: "Starts bg services",
    tone: "healthy",
    metric: "backend/main.py",
    description:
      "Creates the app, installs middleware, includes routers, starts singleton background services, and exposes health endpoints.",
    backlog: "Startup failures are logged and degraded, not always surfaced in one operator view.",
    reads: ["settings", "database", "redis", "external clients"],
    writes: ["logs", "lifespan task handles", "health probe responses"],
    files: ["backend/main.py"],
    connectedTo: ["lifespan-state", "rest-routes", "health-probes"],
  },
  {
    id: "rest-routes",
    label: "REST route modules",
    domain: "backend",
    kind: "backend",
    level: 2,
    x: 702,
    y: 505,
    width: 285,
    height: 128,
    minZoom: 0.68,
    parentId: "backend",
    statusLabel: "Domain APIs",
    health: "Auth dependencies",
    tone: "healthy",
    metric: "market, trades, strategies, admin",
    description:
      "Route modules expose portfolio, trades, strategies, market, options, pipeline, risk, broker, user, admin, and webhook APIs.",
    backlog: "Some route files are large and mix orchestration with validation.",
    reads: ["services", "storage models", "Redis", "provider clients"],
    writes: ["DB rows", "Redis state", "audit events", "broker side effects"],
    files: ["backend/api/routes"],
    connectedTo: ["backend-routes-state", "api-client", "auth-rate-limit"],
  },
  {
    id: "websocket-hub",
    label: "WebSocket hub",
    domain: "backend",
    kind: "backend",
    level: 2,
    x: 1095,
    y: 505,
    width: 275,
    height: 124,
    minZoom: 0.72,
    parentId: "backend",
    statusLabel: "Fan-out channel",
    health: "Redis stream backed",
    tone: "healthy",
    metric: "market and alerts",
    description:
      "Backend websocket handler delivers stream backlog and live events to connected browser clients.",
    backlog: "Backlog cursors must stay ordered during reconnects.",
    reads: ["Redis streams", "in-memory caches"],
    writes: ["WS client messages"],
    files: ["backend/api/websocket/handler.py"],
    connectedTo: ["redis", "websocket-provider"],
  },
  {
    id: "auth-rate-limit",
    label: "Auth and rate limits",
    domain: "backend",
    kind: "control",
    level: 2,
    x: 760,
    y: 670,
    width: 285,
    height: 120,
    minZoom: 0.78,
    parentId: "backend",
    statusLabel: "Trust boundary",
    health: "Cookie JWT plus Redis limits",
    tone: "healthy",
    metric: "require_auth, require_admin",
    description:
      "JWT cookies, route dependencies, admin checks, IP allowlist hooks, and Redis-backed rate limits guard state-changing endpoints.",
    backlog: "Admin-only controls need consistent UI affordance and backend enforcement.",
    reads: ["auth cookies", "settings", "Redis counters"],
    writes: ["sessions", "rate-limit counters", "audit_log"],
    files: ["backend/api/routes/auth.py", "backend/api/routes/_rate_limit.py", "backend/core/auth.py"],
    connectedTo: ["audit-log", "redis"],
  },
  {
    id: "health-probes",
    label: "Health probes",
    domain: "backend",
    kind: "backend",
    level: 2,
    x: 1125,
    y: 680,
    width: 260,
    height: 112,
    minZoom: 0.82,
    parentId: "backend",
    statusLabel: "livez, readyz",
    health: "Read-only probes",
    tone: "healthy",
    metric: "/healthz, /readyz-full",
    description:
      "Cheap and deep health probes report process, database, Redis, FMP, AI-provider, cert, and disk readiness.",
    backlog: "Frontend admin map does not yet consume the deep readiness payload.",
    reads: ["database", "Redis", "provider pings", "disk and cert checks"],
    writes: ["HTTP health payloads"],
    files: ["backend/main.py", "backend/scripts/check_disk_usage.py"],
    connectedTo: ["readiness-state"],
  },
  {
    id: "lifespan-state",
    label: "Lifespan services",
    domain: "backend",
    kind: "state",
    level: 3,
    x: 836,
    y: 40,
    width: 245,
    height: 96,
    minZoom: 1.24,
    parentId: "fastapi-main",
    statusLabel: "Scheduler startup list",
    health: "Singleton tasks",
    tone: "watch",
    metric: "stream, scanner, monitor, fills",
    description:
      "Startup starts Alpaca stream, fill reconciler, periodic reconciler, pipeline scheduler, realtime scanner, continuous monitor, audit cleanup, and rate-limit sweep.",
    files: ["backend/main.py", "backend/data/ingestion"],
    reads: ["settings", "Redis lock state"],
    writes: ["task handles", "logs", "Redis locks"],
  },
  {
    id: "backend-routes-state",
    label: "Route contracts",
    domain: "backend",
    kind: "state",
    level: 3,
    x: 650,
    y: 815,
    width: 245,
    height: 96,
    minZoom: 1.28,
    parentId: "rest-routes",
    statusLabel: "Endpoint inventory",
    health: "FastAPI routers",
    tone: "muted",
    metric: "25 route modules",
    description:
      "The route mesh is the control boundary for every state mutation the future master operator should understand.",
    files: ["backend/api/routes/admin_control.py", "backend/api/routes/trades.py", "backend/api/routes/strategies.py"],
    reads: ["Pydantic models", "Depends guards"],
    writes: ["HTTP responses", "database rows"],
  },
  {
    id: "readiness-state",
    label: "Probe payloads",
    domain: "backend",
    kind: "state",
    level: 3,
    x: 1195,
    y: 828,
    width: 245,
    height: 96,
    minZoom: 1.3,
    parentId: "health-probes",
    statusLabel: "Important read surface",
    health: "Not wired here yet",
    tone: "watch",
    metric: "/readyz-full",
    description:
      "A natural next feed for the map: backend readiness, provider latency, cert expiry, and disk pressure per component.",
    files: ["backend/main.py", "backend/tests/test_readyz_full.py"],
    links: [{ label: "Backend health", href: "/api/v1/health" }],
  },
  {
    id: "timescale",
    label: "TimescaleDB",
    domain: "data",
    kind: "data",
    level: 2,
    x: 1510,
    y: 535,
    width: 270,
    height: 122,
    minZoom: 0.7,
    parentId: "data-plane",
    statusLabel: "Durable app state",
    health: "Hypertables plus app schema",
    tone: "healthy",
    metric: "market, trades, positions",
    description:
      "Postgres/Timescale stores market bars, trades, positions, pipeline logs, audit logs, app config, users, broker reconciliation, and exit rules.",
    backlog: "Master map should eventually understand table ownership and retention.",
    reads: ["SQLAlchemy sessions", "Alembic migrations"],
    writes: ["ORM rows", "raw SQL upserts", "continuous aggregates"],
    files: ["backend/data/storage/models.py", "backend/core/database.py", "backend/alembic/versions"],
    connectedTo: ["pipeline-logs-state", "trades-ledger-state", "app-config", "audit-log"],
  },
  {
    id: "redis",
    label: "Redis operational bus",
    domain: "data",
    kind: "data",
    level: 2,
    x: 1815,
    y: 535,
    width: 270,
    height: 122,
    minZoom: 0.7,
    parentId: "data-plane",
    statusLabel: "Hot state and streams",
    health: "Cache, locks, fan-out",
    tone: "healthy",
    metric: "halt, idempotency, WS",
    description:
      "Redis carries response caches, halt flags, idempotency keys, stream fan-out, rate limits, scheduler locks, and outbox queues.",
    backlog: "Redis outages fail closed on sensitive routes and need clear operator visibility.",
    reads: ["stream cursors", "rate counters", "halt flags"],
    writes: ["market streams", "locks", "idempotency keys", "pending flatten queues"],
    files: ["backend/core/redis.py", "backend/core/cache.py", "backend/api/routes/_rate_limit.py"],
    connectedTo: ["redis-state", "system-halt", "websocket-hub"],
  },
  {
    id: "app-config",
    label: "App config store",
    domain: "data",
    kind: "state",
    level: 2,
    x: 1510,
    y: 705,
    width: 270,
    height: 122,
    minZoom: 0.8,
    parentId: "data-plane",
    statusLabel: "Admin mutable config",
    health: "Encrypted keys and layout",
    tone: "active",
    metric: "app_config table",
    description:
      "Admin-controlled runtime key/value store for encrypted backend provider keys and dashboard section layout.",
    backlog: "More master-agent state can move here once ownership and audit semantics are clear.",
    reads: ["app_config table", "in-process cache"],
    writes: ["encrypted provider keys", "dashboard_sections JSON"],
    controls: ["Backend key rotation", "Dashboard layout reorder"],
    files: ["backend/services/app_config.py", "backend/alembic/versions/0017_app_config.py"],
    connectedTo: ["backend-keys", "dashboard-layout", "app-config-state"],
  },
  {
    id: "audit-log",
    label: "Audit log",
    domain: "data",
    kind: "state",
    level: 2,
    x: 1815,
    y: 710,
    width: 270,
    height: 116,
    minZoom: 0.85,
    parentId: "data-plane",
    statusLabel: "Mutation trail",
    health: "400 day retention",
    tone: "healthy",
    metric: "auth and admin events",
    description:
      "Audit rows capture authentication, sensitive mutations, halt/resume events, retention markers, and compliance-relevant state changes.",
    backlog: "Map should link admin controls to their audit events.",
    reads: ["audit_log table"],
    writes: ["auth events", "admin changes", "trading halt events"],
    files: ["backend/core/audit.py", "backend/data/storage/models.py", "backend/scripts/audit_log_cleanup.py"],
    connectedTo: ["audit-log-state"],
  },
  {
    id: "migrations",
    label: "Schema migrations",
    domain: "data",
    kind: "state",
    level: 2,
    x: 1670,
    y: 858,
    width: 270,
    height: 112,
    minZoom: 0.95,
    parentId: "data-plane",
    statusLabel: "Alembic history",
    health: "22 revisions mapped",
    tone: "muted",
    metric: "0017 app_config, 0022 max loss",
    description:
      "Alembic revisions define the durable shape of app state and must be part of any write-capable master operator plan.",
    backlog: "Rollback operations need schema downgrade playbooks.",
    reads: ["migration files"],
    writes: ["database schema"],
    files: ["backend/alembic/versions"],
  },
  {
    id: "app-config-state",
    label: "Important config rows",
    domain: "data",
    kind: "state",
    level: 3,
    x: 1425,
    y: 860,
    width: 250,
    height: 96,
    minZoom: 1.3,
    parentId: "app-config",
    statusLabel: "Keys and layout JSON",
    health: "Encrypted at rest",
    tone: "active",
    metric: "SUPPORTED_BACKEND_KEYS",
    description:
      "Current admin write authority is deliberately allow-listed to known provider keys and supported dashboard section IDs.",
    files: ["backend/services/app_config.py"],
    reads: ["SUPPORTED_BACKEND_KEYS", "SUPPORTED_DASHBOARD_SECTIONS"],
    writes: ["app_config.value_json"],
  },
  {
    id: "redis-state",
    label: "Redis key families",
    domain: "data",
    kind: "state",
    level: 3,
    x: 1965,
    y: 842,
    width: 240,
    height: 96,
    minZoom: 1.32,
    parentId: "redis",
    statusLabel: "Hot operational state",
    health: "Needs key catalog",
    tone: "watch",
    metric: "streams, locks, halt",
    description:
      "The future master view should catalog Redis keys by owner, TTL, fail-open/fail-closed behavior, and write path.",
    files: ["backend/core/redis.py", "backend/data/ingestion/pending_flatten_drain.py"],
    reads: ["Redis streams", "locks"],
    writes: ["halt flags", "stream backlog"],
  },
  {
    id: "pipeline-logs-state",
    label: "Pipeline logs",
    domain: "data",
    kind: "state",
    level: 3,
    x: 1390,
    y: 1018,
    width: 240,
    height: 96,
    minZoom: 1.36,
    parentId: "timescale",
    statusLabel: "Run audit trail",
    health: "Master-agent decisions",
    tone: "muted",
    metric: "screened, analyzed, orders",
    description:
      "Pipeline history is the clearest existing record of how strategies, agents, and risk gates behaved on a run.",
    files: ["backend/data/ingestion/daily_pipeline.py", "backend/api/routes/pipeline.py"],
    links: [{ label: "Pipeline UI", href: "/pipeline" }],
  },
  {
    id: "trades-ledger-state",
    label: "Trade ledger",
    domain: "data",
    kind: "state",
    level: 3,
    x: 1655,
    y: 1018,
    width: 240,
    height: 96,
    minZoom: 1.36,
    parentId: "timescale",
    statusLabel: "Capital record",
    health: "Safety critical",
    tone: "watch",
    metric: "orders, fills, PnL",
    description:
      "Execution state must remain durable across broker accepts, partial fills, reconnects, reconciler repairs, and admin halts.",
    files: ["backend/api/routes/trades.py", "backend/data/ingestion/trade_ledger.py", "backend/data/storage/models.py"],
    links: [{ label: "Trade UI", href: "/trade" }],
  },
  {
    id: "audit-log-state",
    label: "Audit retention",
    domain: "data",
    kind: "state",
    level: 3,
    x: 1908,
    y: 988,
    width: 240,
    height: 96,
    minZoom: 1.36,
    parentId: "audit-log",
    statusLabel: "Compliance state",
    health: "Cleanup task scheduled",
    tone: "muted",
    metric: "400 day retention",
    description:
      "Admin and trading mutations need durable audit rows, even when cleanup and regulatory retention markers run later.",
    files: ["backend/alembic/versions/0005_audit_log.py", "backend/alembic/versions/0006_compliance_retention.py"],
  },
  {
    id: "backend-keys",
    label: "Backend keys",
    domain: "ops",
    kind: "control",
    level: 2,
    x: 1460,
    y: 775,
    width: 260,
    height: 118,
    minZoom: 0.72,
    parentId: "ops-console",
    statusLabel: "Loading key status",
    health: "Admin only",
    tone: "active",
    metric: "AI provider, FMP, Alpaca, OpenAI, Polygon",
    description:
      "Encrypted runtime key rotation for provider credentials that should not require redeploying the backend.",
    backlog: "Key health should connect to provider-specific readiness probes.",
    reads: ["masked key status"],
    writes: ["encrypted app_config rows"],
    controls: ["Set key", "Clear key"],
    files: ["backend/services/app_config.py", "backend/api/routes/admin_control.py"],
  },
  {
    id: "dashboard-layout",
    label: "Dashboard layout",
    domain: "ops",
    kind: "control",
    level: 2,
    x: 1740,
    y: 775,
    width: 260,
    height: 118,
    minZoom: 0.72,
    parentId: "ops-console",
    statusLabel: "Loading layout",
    health: "Admin writable",
    tone: "active",
    metric: "dashboard_sections",
    description:
      "Admin-owned visibility and ordering config for dashboard sections consumed by ConfigurableSection wrappers.",
    backlog: "New dashboard sections must be registered in backend config and wrapped in the page.",
    reads: ["layout config GET"],
    writes: ["layout config PATCH", "alphadesk:layout-config-updated event"],
    controls: ["Toggle section", "Reorder section"],
    files: ["backend/services/app_config.py", "frontend/src/components/layout/ConfigurableSection.tsx"],
  },
  {
    id: "system-halt",
    label: "System halt",
    domain: "trading",
    kind: "control",
    level: 2,
    x: 1335,
    y: 915,
    width: 260,
    height: 118,
    minZoom: 0.78,
    parentId: "ops-console",
    statusLabel: "Loading halt state",
    health: "Emergency stop",
    tone: "watch",
    metric: "Redis halt plus DB record",
    description:
      "Admin halt controls cancel open orders, optionally flatten positions, and block subsequent trading paths.",
    backlog: "Halt state should be first-class in the graph whenever active.",
    reads: ["Redis halt flag", "durable halt record"],
    writes: ["halt flag", "flatten queue", "audit event"],
    controls: ["Halt trading", "Resume trading"],
    files: ["frontend/src/components/layout/HaltTradingButton.tsx", "backend/api/routes/trades.py"],
    links: [{ label: "Trade controls", href: "/trade" }],
  },
  {
    id: "risk-monitor",
    label: "Risk monitor",
    domain: "trading",
    kind: "control",
    level: 2,
    x: 1335,
    y: 1060,
    width: 260,
    height: 118,
    minZoom: 0.82,
    parentId: "ops-console",
    statusLabel: "Loading risk monitor",
    health: "Admin toggle",
    tone: "watch",
    metric: "P1-P4 checks",
    description:
      "Portfolio and strategy risk monitor toggle controls drawdown, sector, regime, and VaR checks inside the master agent.",
    backlog: "The UI should make disabled risk gates impossible to miss.",
    reads: ["risk monitor state"],
    writes: ["risk monitor enabled flag"],
    controls: ["Enable risk monitor", "Disable risk monitor"],
    files: ["backend/core/risk_monitor_state.py", "backend/data/ingestion/master_agent.py", "frontend/src/lib/api.ts"],
  },
  {
    id: "deploy-trigger",
    label: "Deploy trigger",
    domain: "ops",
    kind: "control",
    level: 2,
    x: 1338,
    y: 214,
    width: 265,
    height: 118,
    minZoom: 0.76,
    parentId: "ops-console",
    statusLabel: "Loading deploy state",
    health: "GitHub token required",
    tone: "watch",
    metric: "workflow_dispatch",
    description:
      "Admin action that asks GitHub Actions to deploy the operational branch and returns the latest workflow URL when available.",
    backlog: "Deploy status should show CI, image, migration, and readiness phases together.",
    reads: ["GH_TOKEN", "GH_REPO", "last deploy memory"],
    writes: ["GitHub workflow dispatch", "in-memory last deploy summary"],
    controls: ["Push to prod"],
    files: ["backend/api/routes/admin_control.py", ".github/workflows/deploy.yml"],
    connectedTo: ["github-deploy"],
  },
  {
    id: "pipeline-scheduler",
    label: "Pipeline scheduler",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 710,
    y: 1158,
    width: 280,
    height: 122,
    minZoom: 0.72,
    parentId: "trading-engine",
    statusLabel: "Loading pipeline",
    health: "Scheduled runs",
    tone: "watch",
    metric: "09:35, 11:00, 14:00 ET",
    description:
      "APScheduler-backed runner starts strategy scans, analysis, master-agent decisions, order placement, and log emission.",
    backlog: "Manual run/cancel controls are admin-only server side and need visible feedback.",
    reads: ["strategy registry", "market data", "portfolio snapshot"],
    writes: ["pipeline status", "pipeline logs", "orders"],
    controls: ["Run pipeline", "Cancel run"],
    files: ["backend/data/ingestion/pipeline_runner.py", "backend/api/routes/pipeline.py"],
    connectedTo: ["pipeline-logs-state", "master-agent"],
    links: [{ label: "Pipeline", href: "/pipeline" }],
  },
  {
    id: "master-agent",
    label: "Master Agent",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 1022,
    y: 1150,
    width: 290,
    height: 132,
    minZoom: 0.7,
    parentId: "trading-engine",
    statusLabel: "Allocation governor",
    health: "Central safety brain",
    tone: "watch",
    metric: "caps, duplicates, sector, VaR",
    description:
      "Central coordinator that approves or rejects strategy trade requests before broker side effects occur.",
    backlog: "This is the natural future home for the user-envisioned master app agent.",
    reads: ["equity", "cash", "positions", "strategy metadata", "risk monitor"],
    writes: ["approval/rejection decisions", "strategy halt state", "drawdown persistence"],
    controls: ["Manual strategy halt", "Risk monitor checks"],
    files: ["backend/data/ingestion/master_agent.py"],
    connectedTo: ["master-agent-state", "risk-gates", "order-management"],
  },
  {
    id: "strategy-registry",
    label: "Strategy registry",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 520,
    y: 1305,
    width: 285,
    height: 118,
    minZoom: 0.84,
    parentId: "trading-engine",
    statusLabel: "Loading strategies",
    health: "19 strategy modules found",
    tone: "healthy",
    metric: "implemented plus catalog entries",
    description:
      "Strategy modules expose screen/run behavior and metadata consumed by catalog, pipeline, and the master agent.",
    backlog: "Signal-cache integration is still being actively edited in the current worktree.",
    reads: ["strategy.py modules", "spec.md docs", "OOS artifacts"],
    writes: ["strategy signals", "disabled events", "performance summaries"],
    files: ["backend/strategies", "frontend/src/lib/strategy-content.ts"],
    connectedTo: ["strategy-files-state", "oos-artifacts-state"],
    links: [{ label: "Strategies", href: "/strategies" }],
  },
  {
    id: "risk-gates",
    label: "Risk gates",
    domain: "trading",
    kind: "control",
    level: 2,
    x: 835,
    y: 1328,
    width: 285,
    height: 118,
    minZoom: 0.84,
    parentId: "trading-engine",
    statusLabel: "Loading risk state",
    health: "Fail closed",
    tone: "watch",
    metric: "halt, live, sizing, kill switch",
    description:
      "Shared order safety path checks admin halt, live-trading config, aggregate exposure, strategy state, and order constraints.",
    backlog: "Every new order path must share these gates before touching broker APIs.",
    reads: ["settings", "halt state", "positions", "strategy disabled events"],
    writes: ["rejections", "audit events", "disabled events"],
    files: ["backend/api/routes/_risk_pipeline.py", "backend/core/trading_gate.py", "backend/strategies/_core/kill_switch.py"],
    connectedTo: ["system-halt", "risk-monitor"],
  },
  {
    id: "order-management",
    label: "Order management",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 1142,
    y: 1304,
    width: 292,
    height: 120,
    minZoom: 0.84,
    parentId: "trading-engine",
    statusLabel: "Broker side effects",
    health: "Idempotent submit path",
    tone: "watch",
    metric: "orders, fills, flatten",
    description:
      "Order preview, submit, cancel, history, flatten, alerts, and reconciliation routes bridge UI intent to broker actions.",
    backlog: "Durable intent before broker submission remains the key capital-risk boundary.",
    reads: ["order payloads", "positions", "broker connection", "idempotency key"],
    writes: ["orders", "trades", "broker orders", "alerts"],
    controls: ["Preview order", "Place order", "Cancel order", "Flatten all"],
    files: ["backend/api/routes/trades.py", "backend/services/order_management.py", "frontend/src/app/(dashboard)/trade/page.tsx"],
    connectedTo: ["trades-ledger-state", "alpaca"],
  },
  {
    id: "reconcilers",
    label: "Reconcilers",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 1445,
    y: 1140,
    width: 285,
    height: 118,
    minZoom: 0.86,
    parentId: "trading-engine",
    statusLabel: "Ledger repair loops",
    health: "Boot plus periodic plus fills",
    tone: "healthy",
    metric: "30s fills, 5m broker drift",
    description:
      "Fill and periodic reconcilers repair drift between local ledger, broker orders, broker positions, and queued bracket/flatten work.",
    backlog: "Reconciler issues should appear as graph health on broker and trade ledger nodes.",
    reads: ["Alpaca orders", "local trades", "pending queues"],
    writes: ["trade rows", "broker reconciliation issues", "audit rows"],
    files: ["backend/data/ingestion/fill_reconciler.py", "backend/data/ingestion/periodic_reconciler.py", "backend/api/routes/broker.py"],
    connectedTo: ["broker-connections", "trades-ledger-state"],
  },
  {
    id: "realtime-scanner",
    label: "Realtime scanner",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 420,
    y: 1138,
    width: 260,
    height: 112,
    minZoom: 0.95,
    parentId: "trading-engine",
    statusLabel: "Bar-close scanner",
    health: "Lifespan service",
    tone: "healthy",
    metric: "watchlist setups",
    description:
      "Screens realtime market bars for pending setups and hands triggered work to the master-agent path.",
    files: ["backend/data/ingestion/realtime_scanner.py"],
    reads: ["market bars", "strategy definitions"],
    writes: ["realtime setup state", "pipeline websocket events"],
  },
  {
    id: "continuous-monitor",
    label: "Continuous monitor",
    domain: "trading",
    kind: "trading",
    level: 2,
    x: 1438,
    y: 1295,
    width: 270,
    height: 112,
    minZoom: 0.95,
    parentId: "trading-engine",
    statusLabel: "Open position monitor",
    health: "60s cadence",
    tone: "healthy",
    metric: "news plus proximity alerts",
    description:
      "Monitors held positions for price proximity, news, and alert-worthy changes while the backend lifespan is running.",
    files: ["backend/data/ingestion/continuous_monitor.py"],
    reads: ["open positions", "news providers", "market prices"],
    writes: ["alerts", "notifications"],
  },
  {
    id: "master-agent-state",
    label: "Master-agent state",
    domain: "trading",
    kind: "state",
    level: 3,
    x: 1016,
    y: 1018,
    width: 252,
    height: 96,
    minZoom: 1.28,
    parentId: "master-agent",
    statusLabel: "Important brain file",
    health: "Reads portfolio, writes decisions",
    tone: "watch",
    metric: "backend/data/ingestion/master_agent.py",
    description:
      "Current master agent knows allocation caps, drawdown, sector concentration, regime exposure, VaR, momentum exceptions, and halts.",
    files: ["backend/data/ingestion/master_agent.py"],
    reads: ["strategy registry", "positions", "risk monitor", "Redis halt"],
    writes: ["disabled events", "drawdown persistence", "approval decisions"],
  },
  {
    id: "strategy-files-state",
    label: "Strategy files",
    domain: "trading",
    kind: "state",
    level: 3,
    x: 390,
    y: 1268,
    width: 230,
    height: 96,
    minZoom: 1.32,
    parentId: "strategy-registry",
    statusLabel: "Leaf modules",
    health: "19 strategy.py files",
    tone: "muted",
    metric: "screen and run logic",
    description:
      "Smallest strategy-level implementation units live in per-strategy folders with strategy.py and spec.md files.",
    files: ["backend/strategies/*/strategy.py", "backend/strategies/*/spec.md"],
  },
  {
    id: "oos-artifacts-state",
    label: "OOS artifacts",
    domain: "trading",
    kind: "state",
    level: 3,
    x: 560,
    y: 1445,
    width: 230,
    height: 96,
    minZoom: 1.36,
    parentId: "strategy-registry",
    statusLabel: "Backtest truth set",
    health: "JSON artifacts",
    tone: "muted",
    metric: "phase1-*-oos.json",
    description:
      "Out-of-sample artifacts back the strategy catalog and health narrative for implemented strategy pods.",
    files: ["backend/data/oos", "audit-reports"],
  },
  {
    id: "analysis-agents",
    label: "Analysis agents",
    domain: "ai",
    kind: "ai",
    level: 2,
    x: 64,
    y: 1140,
    width: 265,
    height: 118,
    minZoom: 0.78,
    parentId: "ai-plane",
    statusLabel: "Technical, fundamental, sentiment",
    health: "AI optional",
    tone: "healthy",
    metric: "/analysis/analyze",
    description:
      "Agent route composes technical, fundamental, sentiment, options, and portfolio views into symbol-level analysis responses.",
    backlog: "Fallback/demo paths must not mask provider failures as genuine research.",
    reads: ["market data", "fundamentals", "news", "options"],
    writes: ["analysis response", "agent status"],
    files: ["backend/agents", "backend/api/routes/analysis.py"],
    connectedTo: ["pii-scrubber", "ai-prompts"],
  },
  {
    id: "ai-prompts",
    label: "AI prompts",
    domain: "ai",
    kind: "ai",
    level: 2,
    x: 360,
    y: 1160,
    width: 270,
    height: 118,
    minZoom: 0.82,
    parentId: "ai-plane",
    statusLabel: "Prompt and provider layer",
    health: "Secret scrub required",
    tone: "watch",
    metric: "CLI primary, API fallback",
    description:
      "AI client and prompt services create research narratives and strategy analysis while scrubbing sensitive data first.",
    backlog: "Provider health needs to connect back to key status and runtime errors.",
    reads: ["ANTHROPIC_API_KEY", "prompt context", "symbol data"],
    writes: ["agent output", "logs"],
    files: ["backend/agents/claude_client.py", "backend/agents/base.py", "backend/services/earnings_prompts.py"],
    connectedTo: ["backend-keys"],
  },
  {
    id: "tradingagents-runtime",
    label: "TradingAgents runtime",
    domain: "ai",
    kind: "ai",
    level: 2,
    x: 175,
    y: 1308,
    width: 286,
    height: 122,
    minZoom: 0.88,
    parentId: "ai-plane",
    statusLabel: "Loading runtime",
    health: "External checkout dependent",
    tone: "watch",
    metric: "provider-aware research runs",
    description:
      "Local TradingAgents integration runs multi-agent symbol research through a configured provider and records artifacts.",
    backlog: "Bootstrap state must block action launches until the runtime is actually ready.",
    reads: ["skill home", "runtime python", "provider key", "upstream checkout"],
    writes: ["run records", "artifact files"],
    controls: ["Start research run"],
    files: ["backend/services/tradingagents_research.py", "backend/tools/tradingagents/scripts/run_tradingagents.py"],
    links: [{ label: "TradingAgents", href: "/strategies/trading-agents-research" }],
  },
  {
    id: "pii-scrubber",
    label: "PII scrubber",
    domain: "ai",
    kind: "control",
    level: 2,
    x: 490,
    y: 1310,
    width: 250,
    height: 112,
    minZoom: 0.95,
    parentId: "ai-plane",
    statusLabel: "Outbound trust boundary",
    health: "Security critical",
    tone: "healthy",
    metric: "tokens, keys, IPs, emails",
    description:
      "Scrubs usernames, UUIDs, JWTs, bearer tokens, Alpaca key prefixes, IPs, and emails before prompts leave the process.",
    reads: ["prompt text", "agent context"],
    writes: ["redacted prompt text"],
    files: ["backend/agents/base.py", "backend/agents/tests/test_scrub_pii.py"],
  },
  {
    id: "alpaca",
    label: "Alpaca",
    domain: "external",
    kind: "external",
    level: 2,
    x: 1510,
    y: 1140,
    width: 250,
    height: 116,
    minZoom: 0.75,
    parentId: "external-rails",
    statusLabel: "Loading broker",
    health: "Paper trading enforced",
    tone: "watch",
    metric: "broker, market data, stream",
    description:
      "Broker execution and market-data websocket provider. Live URLs are guarded by the trading gate and config checks.",
    backlog: "Live enablement remains admin-gated and should be visible wherever orders can launch.",
    reads: ["broker credentials", "account state", "market data"],
    writes: ["broker orders", "trade updates", "broker connection status"],
    files: ["backend/data/providers/alpaca.py", "backend/services/broker_connections.py"],
    connectedTo: ["broker-connections", "order-management"],
  },
  {
    id: "polygon",
    label: "Polygon",
    domain: "external",
    kind: "external",
    level: 2,
    x: 1785,
    y: 1140,
    width: 250,
    height: 116,
    minZoom: 0.82,
    parentId: "external-rails",
    statusLabel: "Options and bars",
    health: "Key dependent",
    tone: "watch",
    metric: "chains, aggregates",
    description:
      "Options chain and market aggregate provider used by option workflows, symbol pages, and earnings setup logic.",
    reads: ["POLYGON_API_KEY", "symbol queries"],
    writes: ["provider cache"],
    files: ["backend/data/providers/polygon.py", "backend/data/providers/polygon_options.py"],
    connectedTo: ["backend-keys"],
  },
  {
    id: "fmp",
    label: "FMP",
    domain: "external",
    kind: "external",
    level: 2,
    x: 1660,
    y: 1288,
    width: 245,
    height: 112,
    minZoom: 0.86,
    parentId: "external-rails",
    statusLabel: "Fundamentals and earnings",
    health: "Key dependent",
    tone: "watch",
    metric: "F-Score, earnings, dividends",
    description:
      "Financial Modeling Prep supplies fundamentals, Piotroski inputs, earnings calendar data, and related fundamental context.",
    reads: ["FMP_API_KEY", "ticker universe"],
    writes: ["provider cache", "screener inputs"],
    files: ["backend/data/providers/fmp.py", "backend/data/providers/fmp_earnings.py", "backend/data/providers/fmp_fundamentals.py"],
    connectedTo: ["backend-keys"],
  },
  {
    id: "tradingview",
    label: "TradingView webhooks",
    domain: "external",
    kind: "external",
    level: 2,
    x: 1915,
    y: 1288,
    width: 260,
    height: 112,
    minZoom: 0.9,
    parentId: "external-rails",
    statusLabel: "HMAC signed ingress",
    health: "Replay protected",
    tone: "healthy",
    metric: "120s replay window",
    description:
      "Webhook route verifies timestamped HMAC signatures before parsing alerts and publishing websocket events.",
    reads: ["TRADINGVIEW_WEBHOOK_SECRET", "raw request body", "timestamp header"],
    writes: ["alerts channel", "rate-limit counters"],
    files: ["backend/api/routes/webhooks.py", "backend/api/routes/tests/test_webhooks.py"],
    connectedTo: ["auth-rate-limit"],
  },
  {
    id: "github-deploy",
    label: "GitHub deploy",
    domain: "external",
    kind: "external",
    level: 2,
    x: 1415,
    y: 1288,
    width: 225,
    height: 112,
    minZoom: 0.95,
    parentId: "external-rails",
    statusLabel: "Workflow dispatch",
    health: "Token dependent",
    tone: "watch",
    metric: "deploy.yml",
    description:
      "Deployment rails build, test, scan, push images, run migrations, and verify readiness on the production host.",
    reads: ["GH token", "workflow file", "deploy branch"],
    writes: ["workflow run", "container images", "production compose state"],
    files: [".github/workflows/deploy.yml", "backend/api/routes/admin_control.py"],
    connectedTo: ["deploy-trigger", "edge-delivery"],
  },
  {
    id: "broker-connections",
    label: "Broker connections",
    domain: "external",
    kind: "state",
    level: 3,
    x: 1490,
    y: 1018,
    width: 240,
    height: 96,
    minZoom: 1.3,
    parentId: "alpaca",
    statusLabel: "Loading connections",
    health: "Encrypted credentials",
    tone: "watch",
    metric: "alpaca, ibkr, etrade, schwab",
    description:
      "Saved broker credentials and reconciliation status records for paper/live account environments.",
    files: ["backend/services/broker_connections.py", "backend/api/routes/broker.py"],
    reads: ["broker_credentials", "reconciliation issues"],
    writes: ["encrypted broker secrets", "connection metadata"],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nodeCenter(node: MindNode) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function connectionPath(from: MindNode, to: MindNode) {
  const fromCenter = nodeCenter(from);
  const toCenter = nodeCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const horizontalRoute = Math.abs(dx) >= Math.abs(dy);

  if (horizontalRoute) {
    const startX = dx >= 0 ? from.x + from.width : from.x;
    const endX = dx >= 0 ? to.x : to.x + to.width;
    const startY = fromCenter.y;
    const endY = toCenter.y;
    const elbowX = Math.round((startX + endX) / 2);

    return `M ${startX} ${startY} H ${elbowX} V ${endY} H ${endX}`;
  }

  const startX = fromCenter.x;
  const endX = toCenter.x;
  const startY = dy >= 0 ? from.y + from.height : from.y;
  const endY = dy >= 0 ? to.y : to.y + to.height;
  const elbowY = Math.round((startY + endY) / 2);

  return `M ${startX} ${startY} V ${elbowY} H ${endX} V ${endY}`;
}

function architectureDepth(scale: number) {
  if (scale >= 1.44) return ARCHITECTURE_DEPTHS[3];
  if (scale >= 1.04) return ARCHITECTURE_DEPTHS[2];
  if (scale >= 0.64) return ARCHITECTURE_DEPTHS[1];
  return ARCHITECTURE_DEPTHS[0];
}

function displayModeForNode(
  node: MindNode,
  scale: number,
  selectedId: string,
  hasQuery: boolean,
): MapDisplayMode {
  if (hasQuery) return "detail";
  const selected = node.id === selectedId;
  const depth = architectureDepth(scale);
  const depthIndex = ARCHITECTURE_DEPTHS.findIndex((item) => item.id === depth.id);

  if (depthIndex >= 3 && node.level <= 1) return selected ? "compact" : "context";
  if (depthIndex >= 2 && node.level === 0) return selected ? "compact" : "context";
  if (depthIndex <= 0 && node.level >= 1) return "compact";
  return "detail";
}

function renderNodeForScale(
  node: MindNode,
  scale: number,
  selectedId: string,
  hasQuery: boolean,
): RenderedMindNode {
  const displayMode = displayModeForNode(node, scale, selectedId, hasQuery);
  if (displayMode === "detail") {
    return { ...node, displayMode };
  }

  const width = displayMode === "context" ? Math.min(node.width, 238) : Math.min(node.width, 292);
  const height = displayMode === "context" ? 58 : 76;
  return {
    ...node,
    x: node.x + (node.width - width) / 2,
    y: node.y + (node.height - height) / 2,
    width,
    height,
    displayMode,
  };
}

const DRILL_CENTER = { x: WORLD.width / 2, y: 720 };
const DRILL_COMPACT_HEIGHT = 76;

function drillColumns(total: number) {
  return total <= 6 ? Math.min(2, Math.max(1, total)) : Math.min(3, total);
}

function drillLayoutMetrics(total: number) {
  const columns = drillColumns(total);
  const rowCount = Math.max(1, Math.ceil(total / columns));
  const selectedY = DRILL_CENTER.y - (total <= 6 ? 205 : 292);
  const childStartY = DRILL_CENTER.y + (total <= 6 ? -82 : -115);
  const childGapY = total <= 6 ? 118 : 148;
  return {
    columns,
    selectedY,
    childStartY,
    childGapY,
    focusY:
      total > 0
        ? (selectedY - DRILL_COMPACT_HEIGHT / 2 +
            childStartY +
            (rowCount - 1) * childGapY +
            DRILL_COMPACT_HEIGHT / 2) /
          2
        : DRILL_CENTER.y,
  };
}

function drillFocusCenter(total: number) {
  if (total <= 0) return DRILL_CENTER;
  const metrics = drillLayoutMetrics(total);
  return { x: DRILL_CENTER.x, y: metrics.focusY };
}

function drillChildCenter(index: number, total: number) {
  const metrics = drillLayoutMetrics(total);
  const columns = metrics.columns;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const gapX = 310;
  return {
    x: DRILL_CENTER.x + (column - (columns - 1) / 2) * gapX,
    y: metrics.childStartY + row * metrics.childGapY,
  };
}

function centerRenderedNode(node: RenderedMindNode, centerX: number, centerY: number) {
  return {
    ...node,
    x: centerX - node.width / 2,
    y: centerY - node.height / 2,
  };
}

function contextRenderedNode(node: RenderedMindNode) {
  const width = Math.min(node.width, 238);
  const height = 58;
  return {
    ...node,
    displayMode: "context" as const,
    width,
    height,
  };
}

function compactRenderedNode(node: RenderedMindNode) {
  return {
    ...node,
    displayMode: "compact" as const,
    width: Math.min(node.width, 284),
    height: DRILL_COMPACT_HEIGHT,
  };
}

function isDirectDrillChild(node: MindNode, parent: MindNode) {
  if (node.parentId === parent.id) return true;
  return parent.level === 0 && node.level === 1 && parent.connectedTo?.includes(node.id);
}

function renderSemanticNodesForScale(
  nodes: MindNode[],
  selectedNode: MindNode | undefined,
  scale: number,
  selectedId: string,
  hasQuery: boolean,
): RenderedMindNode[] {
  const rendered = nodes.map((node) => renderNodeForScale(node, scale, selectedId, hasQuery));
  if (hasQuery || scale < 1.04 || !selectedNode) return rendered;

  const selectedIndex = rendered.findIndex((node) => node.id === selectedNode.id);
  if (selectedIndex === -1) return rendered;

  const next = rendered.map((node) => ({ ...node }));

  const directChildren = next
    .filter((node) => isDirectDrillChild(node, selectedNode))
    .sort((a, b) => toneRank(b.tone) - toneRank(a.tone) || a.label.localeCompare(b.label));
  const selectedY = directChildren.length ? drillLayoutMetrics(directChildren.length).selectedY : DRILL_CENTER.y;
  next[selectedIndex] = centerRenderedNode(next[selectedIndex], DRILL_CENTER.x, selectedY);

  directChildren.forEach((child, index) => {
    const position = drillChildCenter(index, directChildren.length);
    const childIndex = next.findIndex((node) => node.id === child.id);
    if (childIndex === -1) return;
    next[childIndex] = centerRenderedNode(compactRenderedNode(child), position.x, position.y);
  });

  const contextNodes = next
    .filter((node) => node.id !== selectedNode.id && !isDirectDrillChild(node, selectedNode))
    .filter((node) => node.level <= selectedNode.level)
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
  contextNodes.forEach((node, index) => {
    const contextNode = contextRenderedNode(node);
    const contextIndex = next.findIndex((item) => item.id === node.id);
    if (contextIndex === -1) return;
    next[contextIndex] = {
      ...contextNode,
      x: DRILL_CENTER.x - 650,
      y: DRILL_CENTER.y - 245 + index * 70,
    };
  });

  return next;
}

function clampViewTransform(next: ViewTransform, viewport: ViewportSize): ViewTransform {
  if (viewport.width <= 0 || viewport.height <= 0) return next;
  const gutter = 96;
  const scaledWidth = WORLD.width * next.scale;
  const scaledHeight = WORLD.height * next.scale;
  const x =
    scaledWidth <= viewport.width - gutter * 2
      ? (viewport.width - scaledWidth) / 2
      : clamp(next.x, viewport.width - scaledWidth - gutter, gutter);
  const y =
    scaledHeight <= viewport.height - gutter * 2
      ? (viewport.height - scaledHeight) / 2
      : clamp(next.y, viewport.height - scaledHeight - gutter, gutter);

  return { ...next, x, y };
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Request failed";
}

function textMatches(node: MindNode, query: string) {
  const haystack = [
    node.label,
    node.statusLabel,
    node.health,
    node.metric,
    node.description,
    node.backlog,
    ...(node.reads ?? []),
    ...(node.writes ?? []),
    ...(node.controls ?? []),
    ...(node.files ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function nodeMatchesDomain(
  node: MindNode,
  domain: Domain | "all",
  nodeById: ReadonlyMap<string, MindNode>,
) {
  return (
    domain === "all" ||
    node.domain === domain ||
    node.domain === "platform" ||
    (node.parentId ? nodeById.get(node.parentId)?.domain === domain : false)
  );
}

function buildNodePath(node: MindNode, nodeById: ReadonlyMap<string, MindNode>) {
  const path: MindNode[] = [node];
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeById.get(parentId);
    if (!parent) break;
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

function sourceHref(item: string) {
  if (/^https?:\/\//.test(item) || item.startsWith("/")) return item;
  if (item.includes("*")) return null;
  return `${SOURCE_ROOT}${item.split("/").map(encodeURIComponent).join("/")}`;
}

function controlHref(item: string) {
  if (!item.startsWith("/")) return null;
  return item.split(/\s+/)[0];
}

function toneRank(tone: Tone) {
  switch (tone) {
    case "risk":
      return 4;
    case "watch":
      return 3;
    case "active":
      return 2;
    case "healthy":
      return 1;
    case "muted":
    default:
      return 0;
  }
}

function highestTone(items: Array<{ tone: Tone }>): Tone {
  return items.reduce<Tone>(
    (current, item) => (toneRank(item.tone) > toneRank(current) ? item.tone : current),
    "muted",
  );
}

function buildEdges(nodes: MindNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const dedup = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];

  for (const node of nodes) {
    const candidates = [
      ...(node.parentId ? [node.parentId] : []),
      ...(node.connectedTo ?? []),
    ];
    for (const target of candidates) {
      if (!ids.has(target)) continue;
      const key = `${node.id}->${target}`;
      const reverseKey = `${target}->${node.id}`;
      if (dedup.has(key) || dedup.has(reverseKey)) continue;
      dedup.add(key);
      edges.push({ from: node.id, to: target });
    }
  }

  return edges;
}

function buildRuntimeOverrides(snapshot: RuntimeSnapshot): Record<string, Partial<MindNode>> {
  const overrides: Record<string, Partial<MindNode>> = {};
  const liveProbeErrors = snapshot.errors.length;

  overrides.platform = {
    statusLabel: snapshot.loading
      ? "Syncing live probes"
      : liveProbeErrors > 0
        ? `${liveProbeErrors} live probes unavailable`
        : "Live probes synced",
    health: snapshot.updatedAt ? `Synced ${timeLabel(snapshot.updatedAt)}` : "Awaiting first sync",
    tone: liveProbeErrors > 0 ? "watch" : "active",
  };

  if (snapshot.pipeline) {
    const status = snapshot.pipeline;
    const failed =
      typeof status.last_result === "string" &&
      /(fail|error|halt|cancel)/i.test(status.last_result);
    overrides["pipeline-scheduler"] = {
      statusLabel: status.running ? "Pipeline running" : "Pipeline idle",
      health: status.running
        ? status.current_strategy
          ? `Current strategy: ${status.current_strategy}`
          : status.stage ?? "Run active"
        : status.last_result
          ? `Last result: ${status.last_result}`
          : "No recent result",
      tone: status.running ? "active" : failed ? "watch" : "healthy",
      metric: status.last_run ? `Last run ${timeLabel(status.last_run)}` : "No run timestamp",
    };
  }

  if (snapshot.riskMonitor) {
    overrides["risk-monitor"] = {
      statusLabel: snapshot.riskMonitor.enabled ? "Risk monitor enabled" : "Risk monitor disabled",
      health: snapshot.riskMonitor.message,
      tone: snapshot.riskMonitor.enabled ? "healthy" : "risk",
    };
    overrides["risk-gates"] = {
      statusLabel: snapshot.riskMonitor.enabled ? "Risk gates enabled" : "Risk gates bypassed",
      health: snapshot.riskMonitor.message,
      tone: snapshot.riskMonitor.enabled ? "healthy" : "risk",
    };
  }

  if (snapshot.halt) {
    overrides["system-halt"] = {
      statusLabel: snapshot.halt.halted ? "Trading halted" : "Trading clear",
      health: snapshot.halt.halted
        ? snapshot.halt.reason ?? "Admin halt active"
        : "No admin halt active",
      tone: snapshot.halt.halted ? "risk" : "healthy",
      metric: snapshot.halt.halted_at ? `Since ${timeLabel(snapshot.halt.halted_at)}` : "Clear",
    };
    overrides["trading-engine"] = {
      statusLabel: snapshot.halt.halted ? "Trading engine halted" : "Trading engine clear",
      tone: snapshot.halt.halted ? "risk" : "watch",
    };
  }

  if (snapshot.strategies) {
    const active = snapshot.strategies.filter((item) => item.status === "active").length;
    const paperOnly = snapshot.strategies.filter((item) => item.paper_only || item.live_disabled).length;
    overrides["strategy-registry"] = {
      statusLabel: `${snapshot.strategies.length} strategies from API`,
      health: `${active} active, ${paperOnly} paper-only or live-disabled`,
      tone: paperOnly > 0 ? "watch" : "healthy",
    };
  }

  if (snapshot.brokerConnections) {
    const total = snapshot.brokerConnections.length;
    const verified = snapshot.brokerConnections.filter((item) => item.verified_at).length;
    const withError = snapshot.brokerConnections.filter((item) => item.last_error).length;
    overrides["broker-connections"] = {
      statusLabel: total > 0 ? `${total} broker connection${total === 1 ? "" : "s"}` : "No broker connections",
      health: total > 0 ? `${verified} verified, ${withError} with last error` : "Connect broker before live operations",
      tone: total === 0 || withError > 0 ? "watch" : "healthy",
    };
    overrides.alpaca = {
      statusLabel: total > 0 ? "Broker connection present" : "Broker not connected",
      tone: total > 0 && withError === 0 ? "healthy" : "watch",
    };
  }

  if (snapshot.lastDeploy) {
    overrides["deploy-trigger"] = {
      statusLabel:
        snapshot.lastDeploy.ok === false
          ? "Last deploy trigger failed"
          : snapshot.lastDeploy.triggered_at
            ? "Last deploy trigger recorded"
            : "No deploy from UI yet",
      health: snapshot.lastDeploy.triggered_at
        ? `${timeLabel(snapshot.lastDeploy.triggered_at)}${snapshot.lastDeploy.actor ? ` by ${snapshot.lastDeploy.actor}` : ""}`
        : "No trigger timestamp",
      tone: snapshot.lastDeploy.ok === false ? "risk" : snapshot.lastDeploy.triggered_at ? "healthy" : "watch",
    };
    overrides["github-deploy"] = {
      statusLabel: snapshot.lastDeploy.ok === false ? "Deploy dispatch failed" : "Deploy rail reachable",
      tone: snapshot.lastDeploy.ok === false ? "risk" : "watch",
    };
  }

  if (snapshot.layout) {
    const sections = snapshot.layout.dashboard_sections ?? [];
    const visible = sections.filter((section) => section.visible).length;
    overrides["dashboard-layout"] = {
      statusLabel: `${visible} of ${sections.length} sections visible`,
      health: snapshot.layout.version ? `Layout version ${snapshot.layout.version}` : "Layout loaded",
      tone: sections.length > 0 ? "healthy" : "watch",
    };
  }

  if (snapshot.keys) {
    const setCount = snapshot.keys.filter((key) => key.set).length;
    overrides["backend-keys"] = {
      statusLabel: `${setCount} of ${snapshot.keys.length} keys set`,
      health: snapshot.keys
        .filter((key) => key.set)
        .map((key) => key.label)
        .slice(0, 3)
        .join(", ") || "No runtime keys set",
      tone: setCount > 0 ? "healthy" : "watch",
    };
  }

  if (snapshot.tradingAgents) {
    overrides["tradingagents-runtime"] = {
      statusLabel: snapshot.tradingAgents.ready ? "TradingAgents ready" : "TradingAgents not ready",
      health: snapshot.tradingAgents.bootstrap_required
        ? "Bootstrap required"
        : snapshot.tradingAgents.warnings.length > 0
          ? snapshot.tradingAgents.warnings[0]
          : `${snapshot.tradingAgents.provider} provider configured`,
      tone: snapshot.tradingAgents.ready ? "healthy" : "watch",
      metric: `${snapshot.tradingAgents.deep_model} / ${snapshot.tradingAgents.quick_model}`,
    };
  }

  return overrides;
}

function buildTriageItems(snapshot: RuntimeSnapshot): TriageItem[] {
  const probeTone: Tone = snapshot.loading ? "active" : snapshot.errors.length ? "watch" : "healthy";
  const keyCount = snapshot.keys?.length ?? 0;
  const setKeys = snapshot.keys?.filter((key) => key.set).length ?? 0;
  const missingKeys = snapshot.keys?.filter((key) => !key.set).map((key) => key.label) ?? [];
  const brokerTotal = snapshot.brokerConnections?.length ?? 0;
  const brokerErrors = snapshot.brokerConnections?.filter((item) => item.last_error).length ?? 0;
  const brokerVerified = snapshot.brokerConnections?.filter((item) => item.verified_at).length ?? 0;
  const strategyCount = snapshot.strategies?.length ?? 0;
  const activeStrategies = snapshot.strategies?.filter((item) => item.status === "active").length ?? 0;

  return [
    {
      id: "probes",
      label: "Live probes",
      value: snapshot.loading ? "Syncing" : snapshot.errors.length ? `${snapshot.errors.length} warning` : "Synced",
      detail: snapshot.updatedAt ? timeLabel(snapshot.updatedAt) : "Awaiting first probe",
      tone: probeTone,
      nodeId: "platform",
      icon: Pulse,
    },
    {
      id: "keys",
      label: "Provider keys",
      value: keyCount ? `${setKeys}/${keyCount} set` : "Loading",
      detail: missingKeys.length ? `Missing ${missingKeys.slice(0, 2).join(", ")}` : "Runtime keys ready",
      tone: keyCount === 0 ? "active" : setKeys === 0 ? "risk" : setKeys < keyCount ? "watch" : "healthy",
      nodeId: "backend-keys",
      icon: Key,
    },
    {
      id: "halt",
      label: "Trading safety",
      value: snapshot.halt ? (snapshot.halt.halted ? "Halted" : "Clear") : "Loading",
      detail: snapshot.halt?.halted
        ? snapshot.halt.reason ?? "Admin halt active"
        : snapshot.halt
          ? "No admin halt active"
          : "Checking halt state",
      tone: snapshot.halt ? (snapshot.halt.halted ? "risk" : "healthy") : "active",
      nodeId: "system-halt",
      icon: Siren,
    },
    {
      id: "risk",
      label: "Risk gates",
      value: snapshot.riskMonitor
        ? snapshot.riskMonitor.enabled
          ? "Enabled"
          : "Disabled"
        : "Loading",
      detail: snapshot.riskMonitor?.message ?? "Checking risk monitor",
      tone: snapshot.riskMonitor ? (snapshot.riskMonitor.enabled ? "healthy" : "risk") : "active",
      nodeId: "risk-monitor",
      icon: ShieldCheck,
    },
    {
      id: "pipeline",
      label: "Pipeline",
      value: snapshot.pipeline ? (snapshot.pipeline.running ? "Running" : "Idle") : "Loading",
      detail: snapshot.pipeline?.running
        ? snapshot.pipeline.current_strategy ?? snapshot.pipeline.stage ?? "Run active"
        : snapshot.pipeline?.last_result ?? "No recent result",
      tone: snapshot.pipeline
        ? snapshot.pipeline.running
          ? "active"
          : snapshot.pipeline.last_result && /(fail|error|halt|cancel)/i.test(snapshot.pipeline.last_result)
            ? "watch"
            : "healthy"
        : "active",
      nodeId: "pipeline-scheduler",
      icon: ListChecks,
    },
    {
      id: "brokers",
      label: "Broker rails",
      value: snapshot.brokerConnections ? `${brokerVerified}/${brokerTotal} verified` : "Loading",
      detail: brokerTotal
        ? brokerErrors
          ? `${brokerErrors} connection with last error`
          : "Execution credentials mapped"
        : "Connect broker before live operations",
      tone: snapshot.brokerConnections
        ? brokerTotal === 0 || brokerErrors > 0
          ? "watch"
          : "healthy"
        : "active",
      nodeId: "broker-connections",
      icon: PlugsConnected,
    },
    {
      id: "agents",
      label: "AI research",
      value: snapshot.tradingAgents
        ? snapshot.tradingAgents.ready
          ? "Ready"
          : "Needs setup"
        : "Loading",
      detail: snapshot.tradingAgents
        ? snapshot.tradingAgents.bootstrap_required
          ? "Bootstrap required"
          : `${snapshot.tradingAgents.provider} provider`
        : "Checking TradingAgents",
      tone: snapshot.tradingAgents ? (snapshot.tradingAgents.ready ? "healthy" : "watch") : "active",
      nodeId: "tradingagents-runtime",
      icon: Robot,
    },
    {
      id: "strategies",
      label: "Strategies",
      value: snapshot.strategies ? `${activeStrategies}/${strategyCount} active` : "Loading",
      detail: snapshot.strategies ? "Registry reachable" : "Checking strategy registry",
      tone: snapshot.strategies ? (activeStrategies > 0 ? "healthy" : "watch") : "active",
      nodeId: "strategy-registry",
      icon: ChartLineUp,
    },
    {
      id: "deploy",
      label: "Deploy rail",
      value: snapshot.lastDeploy
        ? snapshot.lastDeploy.ok === false
          ? "Failed"
          : snapshot.lastDeploy.triggered_at
            ? "Recorded"
            : "Quiet"
        : "Loading",
      detail: snapshot.lastDeploy?.triggered_at
        ? timeLabel(snapshot.lastDeploy.triggered_at)
        : "No deploy from UI yet",
      tone: snapshot.lastDeploy
        ? snapshot.lastDeploy.ok === false
          ? "risk"
          : snapshot.lastDeploy.triggered_at
            ? "healthy"
            : "watch"
        : "active",
      nodeId: "deploy-trigger",
      icon: GitBranch,
    },
  ];
}

function useRuntimeSnapshot() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>({
    loading: true,
    updatedAt: null,
    errors: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const next: RuntimeSnapshot = {
        loading: false,
        updatedAt: new Date().toISOString(),
        errors: [],
      };

      const capture = async <K extends keyof RuntimeSnapshot>(
        key: K,
        label: string,
        promise: Promise<NonNullable<RuntimeSnapshot[K]>>,
      ) => {
        try {
          next[key] = await promise;
        } catch (err) {
          next.errors.push(`${label}: ${errorMessage(err)}`);
        }
      };

      await Promise.all([
        capture("pipeline", "Pipeline", getPipelineStatus()),
        capture("riskMonitor", "Risk monitor", getRiskMonitorState()),
        capture("halt", "Halt state", getHaltStatus()),
        capture("strategies", "Strategies", getStrategies()),
        capture("brokerConnections", "Broker connections", getBrokerConnections()),
        capture("lastDeploy", "Deploy", getLastDeploy()),
        capture("layout", "Layout", getLayoutConfig()),
        capture("keys", "Backend keys", getAdminBackendKeys()),
        capture("tradingAgents", "TradingAgents", getTradingAgentsRuntimeStatus()),
      ]);

      if (!cancelled) setSnapshot(next);
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return snapshot;
}

export function AppMindMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 0.52 });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState("platform");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<Domain | "all">("all");
  const snapshot = useRuntimeSnapshot();

  const runtimeOverrides = useMemo(() => buildRuntimeOverrides(snapshot), [snapshot]);
  const nodes = useMemo(
    () =>
      COMPONENT_NODES.map((node) => ({
        ...node,
        ...(runtimeOverrides[node.id] ?? {}),
      })),
    [runtimeOverrides],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const query = search.trim().toLowerCase();
  const selectedBaseNode = nodeById.get(selectedId) ?? nodeById.get("platform") ?? nodes[0];
  const selectedPathIds = useMemo(() => {
    if (!selectedBaseNode) return new Set<string>();
    return new Set(buildNodePath(selectedBaseNode, nodeById).map((node) => node.id));
  }, [nodeById, selectedBaseNode]);
  const triageItems = useMemo(() => buildTriageItems(snapshot), [snapshot]);
  const topTone = highestTone(triageItems);
  const riskCount = triageItems.filter((item) => item.tone === "risk").length;
  const watchCount = triageItems.filter((item) => item.tone === "watch").length;
  const syncLabel = snapshot.loading
    ? "Syncing"
    : riskCount
      ? "Needs attention"
      : watchCount
        ? "Live with warnings"
        : "Live state synced";

  const matchingNodes = useMemo(() => {
    if (!query) return [];
    return nodes
      .filter((node) => textMatches(node, query) && nodeMatchesDomain(node, domain, nodeById))
      .sort((a, b) => b.level - a.level || a.label.localeCompare(b.label));
  }, [domain, nodeById, nodes, query]);

  const visibleNodes = useMemo(() => {
    const matchingIds = new Set<string>();
    if (query) {
      for (const node of nodes) {
        if (!textMatches(node, query)) continue;
        matchingIds.add(node.id);
        let parentId = node.parentId;
        while (parentId) {
          matchingIds.add(parentId);
          parentId = nodeById.get(parentId)?.parentId;
        }
      }
    }

    const depthIndex = ARCHITECTURE_DEPTHS.findIndex(
      (item) => item.id === architectureDepth(transform.scale).id,
    );
    const selected = selectedBaseNode ?? nodes[0];

    return nodes.filter((node) => {
      const zoomVisible =
        transform.scale >= node.minZoom &&
        (node.maxZoom === undefined || transform.scale <= node.maxZoom);
      const domainVisible = nodeMatchesDomain(node, domain, nodeById);
      const searchVisible = !query || matchingIds.has(node.id);
      if (!domainVisible || !searchVisible) return false;
      if (query) return true;
      if (!zoomVisible) return false;
      if (!selected) return true;
      if (depthIndex <= 1) return node.level <= 1;
      if (selected.level === 0) return node.level <= 1;
      if (selectedPathIds.has(node.id)) return true;

      if (selected.level === 1) {
        if (node.level === 1) return depthIndex <= 2;
        if (node.parentId === selected.id) return true;
        return false;
      }

      if (selected.level >= 2) {
        if (node.parentId === selected.id) return true;
        if (node.parentId && node.parentId === selected.parentId && node.level === selected.level) {
          return depthIndex <= 2;
        }
        return false;
      }

      return true;
    });
  }, [domain, nodeById, nodes, query, selectedBaseNode, selectedPathIds, transform.scale]);

  const renderNodes = useMemo(
    () =>
      renderSemanticNodesForScale(
        visibleNodes,
        selectedBaseNode,
        transform.scale,
        selectedId,
        Boolean(query),
      ),
    [query, selectedBaseNode, selectedId, transform.scale, visibleNodes],
  );
  const renderNodeById = useMemo(
    () => new Map(renderNodes.map((node) => [node.id, node])),
    [renderNodes],
  );
  const visibleIds = useMemo(() => new Set(renderNodes.map((node) => node.id)), [renderNodes]);
  const edges = useMemo(() => buildEdges(nodes), [nodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
    [edges, visibleIds],
  );

  const selectedNode = selectedBaseNode;
  const hoveredNode = hoveredId ? nodeById.get(hoveredId) : undefined;
  const selectedPath = selectedNode ? buildNodePath(selectedNode, nodeById) : [];
  const depth = architectureDepth(transform.scale);

  const fitWorld = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setViewportSize({ width: rect.width, height: rect.height });
    const scale = clamp(
      Math.min((rect.width - 64) / WORLD.width, (rect.height - 64) / WORLD.height, 0.68),
      SCALE.min,
      SCALE.max,
    );
    setTransform(
      clampViewTransform(
        {
          scale,
          x: (rect.width - WORLD.width * scale) / 2,
          y: (rect.height - WORLD.height * scale) / 2,
        },
        { width: rect.width, height: rect.height },
      ),
    );
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fitWorld();
    const observer = new ResizeObserver(() => fitWorld());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWorld]);

  const focusNode = useCallback(
    (node: MindNode, scaleHint?: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nextScale = clamp(
        scaleHint ?? (node.level >= 3 ? 1.62 : node.level >= 2 ? 1.18 : 0.82),
        SCALE.min,
        SCALE.max,
      );
      const directChildCount = nodes.filter((item) => isDirectDrillChild(item, node)).length;
      const center = nextScale >= 1.04 ? drillFocusCenter(directChildCount) : nodeCenter(node);
      setTransform(
        clampViewTransform(
          {
            scale: nextScale,
            x: rect.width / 2 - center.x * nextScale,
            y: rect.height / 2 - center.y * nextScale,
          },
          { width: rect.width, height: rect.height },
        ),
      );
    },
    [nodes],
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, zoomFactor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTransform((current) => {
        const nextScale = clamp(current.scale * zoomFactor, SCALE.min, SCALE.max);
        const pointerX = clientX - rect.left;
        const pointerY = clientY - rect.top;
        const worldX = (pointerX - current.x) / current.scale;
        const worldY = (pointerY - current.y) / current.scale;
        return clampViewTransform(
          {
            scale: nextScale,
            x: pointerX - worldX * nextScale,
            y: pointerY - worldY * nextScale,
          },
          { width: rect.width, height: rect.height },
        );
      });
    },
    [],
  );

  const zoomCenter = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  const focusDepth = useCallback(
    (scale: number) => {
      if (selectedNode) {
        focusNode(selectedNode, scale);
        return;
      }
      setTransform((current) =>
        clampViewTransform(
          { ...current, scale: clamp(scale, SCALE.min, SCALE.max) },
          viewportSize,
        ),
      );
    },
    [focusNode, selectedNode, viewportSize],
  );

  const selectNode = useCallback(
    (node: MindNode, focus = false) => {
      setSelectedId(node.id);
      if (focus) focusNode(node);
    },
    [focusNode],
  );

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.12);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    panRef.current = { ...pan, x: event.clientX, y: event.clientY };
    setTransform((current) =>
      clampViewTransform({ ...current, x: current.x + dx, y: current.y + dy }, viewportSize),
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const visibleDeepCount = visibleNodes.filter((node) => node.level >= 2).length;

  return (
    <section className="overflow-hidden rounded-[28px] border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] shadow-[0_24px_60px_-32px_rgba(5,5,3,0.72)]">
      <div className="grid gap-5 border-b border-[color:var(--border)] bg-[linear-gradient(135deg,rgba(236,230,210,0.04),transparent_42%)] px-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:px-6">
        <div className="max-w-[820px]">
          <p className="t-label u-brand">ADMIN / APPLICATION MIND</p>
          <h2 className="mt-2 font-display text-3xl leading-none text-fg md:text-5xl">
            Master map
          </h2>
          <p className="mt-3 text-body-sm leading-relaxed text-fg-muted">
            Architecture, state ownership, runtime health, and admin write surfaces across the
            browser, API, trading engine, data stores, provider rails, and master-agent boundary.
          </p>
        </div>
        <div className="grid min-w-[220px] gap-2 text-left md:text-right">
          <StatusChip
            label={syncLabel}
            tone={snapshot.loading ? "active" : topTone === "risk" ? "risk" : topTone === "watch" ? "watch" : "healthy"}
          />
          <p className="t-mono text-label text-fg-muted">
            {visibleNodes.length} shown / {COMPONENT_NODES.length} mapped
          </p>
          <p className="t-mono text-label text-fg-muted">
            {riskCount} critical / {watchCount} watch / {visibleDeepCount} deep
          </p>
          <p className="t-mono text-label text-fg-muted">
            {snapshot.updatedAt ? timeLabel(snapshot.updatedAt) : "Awaiting first probe"}
          </p>
        </div>
      </div>

      <TriageRail
        items={triageItems}
        onSelect={(item) => {
          const node = nodeById.get(item.nodeId);
          if (node) selectNode(node, true);
        }}
      />

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0">
          <div className="grid gap-3 border-b border-[color:var(--border)] p-4 lg:grid-cols-[minmax(240px,360px)_1fr_auto] lg:items-end">
            <label className="grid gap-2">
              <span className="t-mono text-label text-fg-muted">Find component</span>
              <span className="relative block">
                <MagnifyingGlass
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                  size={17}
                />
                <input
                  value={search}
                  onChange={(event) => {
                    const nextSearch = event.target.value;
                    const nextQuery = nextSearch.trim().toLowerCase();
                    setSearch(nextSearch);
                    if (!nextQuery) return;
                    const firstMatch = nodes
                      .filter((node) => textMatches(node, nextQuery) && nodeMatchesDomain(node, domain, nodeById))
                      .sort((a, b) => b.level - a.level || a.label.localeCompare(b.label))[0];
                    if (firstMatch) setSelectedId(firstMatch.id);
                  }}
                  placeholder="master agent, Redis, app_config"
                  className="min-h-touch w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] pl-9 pr-3 t-mono text-label text-fg outline-none transition focus:border-[color:var(--brand)] focus:ring-2 focus:ring-[color:var(--focus-ring-soft)]"
                />
              </span>
            </label>

            <div className="flex flex-wrap gap-2" aria-label="Domain filter">
              {DOMAIN_LABELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDomain(item.id)}
                  className={cn(
                    "min-h-touch rounded border px-3 t-mono text-label transition active:scale-[0.98]",
                    domain === item.id
                      ? "border-[color:var(--brand)] bg-[color:var(--brand-tint)] text-brand"
                      : "border-[color:var(--border)] text-fg-muted hover:border-[color:var(--border-strong)] hover:text-fg",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="hidden items-center gap-2 lg:flex lg:justify-end">
              <IconButton label="Zoom out" onClick={() => zoomCenter(0.86)}>
                <MagnifyingGlassMinus size={18} weight="bold" />
              </IconButton>
              <IconButton label="Reset map" onClick={fitWorld}>
                <ArrowsOutCardinal size={18} weight="bold" />
              </IconButton>
              <IconButton label="Zoom in" onClick={() => zoomCenter(1.16)}>
                <MagnifyingGlassPlus size={18} weight="bold" />
              </IconButton>
              <IconButton
                label="Focus selection"
                onClick={() => {
                  if (selectedNode) focusNode(selectedNode);
                }}
              >
                <Crosshair size={18} weight="bold" />
              </IconButton>
            </div>
          </div>

          {query ? (
            <SearchShelf
              matches={matchingNodes}
              query={search.trim()}
              selectedId={selectedId}
              onSelect={(node) => selectNode(node, true)}
            />
          ) : (
            <ArchitectureDepthRail
              currentScale={transform.scale}
              onSelect={(scale) => focusDepth(scale)}
            />
          )}

          <MobileArchitectureExplorer
            nodes={visibleNodes}
            selectedId={selectedId}
            onSelect={(node) => selectNode(node)}
            onFocus={(node) => selectNode(node, true)}
          />

          <div
            ref={containerRef}
            className="relative hidden min-h-[620px] touch-none overflow-hidden bg-[linear-gradient(rgba(236,230,210,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(236,230,210,0.04)_1px,transparent_1px),linear-gradient(135deg,var(--bg),var(--bg-elev-1))] bg-[length:44px_44px,44px_44px,100%_100%] md:block md:min-h-[760px]"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseLeave={() => {
              setHoveredId(null);
            }}
          >
            <div
              className="absolute left-0 top-0"
              style={{
                width: WORLD.width,
                height: WORLD.height,
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                transformOrigin: "0 0",
              }}
            >
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                height={WORLD.height}
                width={WORLD.width}
              >
                {visibleEdges.map((edge) => {
                  const from = renderNodeById.get(edge.from);
                  const to = renderNodeById.get(edge.to);
                  if (!from || !to) return null;
                  const connected = selectedId === edge.from || selectedId === edge.to;
                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      data-mind-edge={`${edge.from}-${edge.to}`}
                      d={connectionPath(from, to)}
                      fill="none"
                      shapeRendering="crispEdges"
                      stroke={edgeStroke(from, to)}
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                      strokeOpacity={connected ? 0.88 : transform.scale >= 1.04 ? 0.18 : 0.34}
                      strokeWidth={connected ? 2.5 : 1.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>

              {visibleNodes.length === 0 ? (
                <div className="absolute left-[820px] top-[650px] w-[520px] rounded-[24px] border border-[color:var(--border)] bg-[color:var(--bg-card)] p-8 shadow-[0_20px_44px_-28px_rgba(5,5,3,0.8)]">
                  <p className="t-label u-brand">NO MATCH</p>
                  <h3 className="mt-2 font-display text-2xl text-fg">No mapped component matched</h3>
                  <p className="mt-3 text-body-sm leading-relaxed text-fg-muted">
                    Clear the search or switch domains to bring the architecture nodes back into view.
                  </p>
                </div>
              ) : null}

              {renderNodes.map((node) => (
                <MapNode
                  key={node.id}
                  node={node}
                  selected={node.id === selectedId}
                  onClick={() => selectNode(node)}
                  onDoubleClick={() => focusNode(node)}
                  onHover={() => setHoveredId(node.id)}
                  onLeave={() => setHoveredId(null)}
                />
              ))}
            </div>

            <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-2">
              <div className="rounded-full border border-white/10 bg-[rgba(17,17,16,0.78)] px-3 py-2 t-mono text-label text-fg-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
                Zoom {Math.round(transform.scale * 100)}% · {depth.label}
              </div>
              {snapshot.errors.length ? (
                <div className="max-w-[520px] rounded-full border border-[color:var(--state-warning-border)] bg-[color:var(--state-warning-bg)] px-3 py-2 t-mono text-label text-[color:var(--state-warning-fg)]">
                  {snapshot.errors.length} live probe issue{snapshot.errors.length === 1 ? "" : "s"}
                </div>
              ) : null}
            </div>

            <MapOverview
              nodes={nodes}
              transform={transform}
              viewportSize={viewportSize}
            />
            <HoverLens node={hoveredNode} />
          </div>
        </div>

        <MindInspector
          node={selectedNode}
          path={selectedPath}
          snapshot={snapshot}
          loading={snapshot.loading}
          errors={snapshot.errors}
          onFocus={() => {
            if (selectedNode) focusNode(selectedNode);
          }}
        />
      </div>
    </section>
  );
}

function TriageRail({
  items,
  onSelect,
}: {
  items: TriageItem[];
  onSelect: (item: TriageItem) => void;
}) {
  return (
    <div className="border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-4 md:px-6">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-9">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "group min-h-[112px] rounded-[18px] border p-3 text-left transition duration-300 active:scale-[0.98]",
                "bg-[linear-gradient(180deg,rgba(236,230,210,0.035),transparent)] hover:-translate-y-0.5",
                tonePanelClass(item.tone),
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded border", toneIconClass(item.tone))}>
                  <Icon size={16} weight="bold" />
                </span>
                <StatusDot tone={item.tone} />
              </div>
              <p className="mt-3 t-mono text-label text-fg-muted">{item.label}</p>
              <p className={cn("mt-2 font-display text-xl leading-none text-fg", toneTextClass(item.tone))}>
                {item.value}
              </p>
              <p className="mt-2 line-clamp-2 text-label leading-relaxed text-fg-muted">{item.detail}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ArchitectureDepthRail({
  currentScale,
  onSelect,
}: {
  currentScale: number;
  onSelect: (scale: number) => void;
}) {
  return (
    <div className="hidden border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-3 md:block">
      <div className="grid gap-2 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded border border-[color:var(--border)] text-fg-muted">
            <TreeStructure size={16} weight="bold" />
          </span>
          <div>
            <p className="t-mono text-label text-fg">Architecture depth</p>
            <p className="t-mono text-label text-fg-muted">Zoom {Math.round(currentScale * 100)}%</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {ARCHITECTURE_DEPTHS.map((depth) => {
            const active = Math.abs(currentScale - depth.scale) < 0.18;
            return (
              <button
                key={depth.id}
                type="button"
                onClick={() => onSelect(depth.scale)}
                className={cn(
                  "min-h-touch rounded border px-3 py-2 text-left transition active:scale-[0.98]",
                  active
                    ? "border-[color:var(--brand)] bg-[color:var(--brand-tint)] text-brand"
                    : "border-[color:var(--border)] text-fg-muted hover:border-[color:var(--border-strong)] hover:text-fg",
                )}
              >
                <span className="block t-mono text-label">{depth.label}</span>
                <span className="mt-1 block text-label">{depth.detail}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchShelf({
  matches,
  query,
  selectedId,
  onSelect,
}: {
  matches: MindNode[];
  query: string;
  selectedId: string;
  onSelect: (node: MindNode) => void;
}) {
  return (
    <div className="border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[color:var(--border)] px-3 t-mono text-label text-fg-muted">
          <MagnifyingGlass size={15} weight="bold" />
          {matches.length} match{matches.length === 1 ? "" : "es"} for {query}
        </span>
        {matches.slice(0, 8).map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node)}
            className={cn(
              "min-h-8 rounded-full border px-3 t-mono text-label transition active:scale-[0.98]",
              selectedId === node.id
                ? "border-[color:var(--brand)] bg-[color:var(--brand-tint)] text-brand"
                : "border-[color:var(--border)] text-fg-muted hover:border-[color:var(--border-strong)] hover:text-fg",
            )}
          >
            {node.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileArchitectureExplorer({
  nodes,
  selectedId,
  onSelect,
  onFocus,
}: {
  nodes: MindNode[];
  selectedId: string;
  onSelect: (node: MindNode) => void;
  onFocus: (node: MindNode) => void;
}) {
  const levels = [0, 1, 2, 3] as const;
  return (
    <div className="border-b border-[color:var(--border)] bg-[color:var(--bg)] p-4 md:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="t-label u-brand">Architecture stack</p>
          <p className="mt-1 t-mono text-label text-fg-muted">{nodes.length} shown</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded border border-[color:var(--border)] text-fg-muted">
          <TreeStructure size={18} weight="bold" />
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {levels.map((level) => {
          const levelNodes = nodes.filter((node) => node.level === level);
          if (!levelNodes.length) return null;
          return (
            <div key={level} className="space-y-2">
              <p className="t-mono text-label text-fg-muted">Level {level}</p>
              <div className="grid gap-2">
                {levelNodes.map((node) => {
                  const Icon = KIND_ICONS[node.kind];
                  const selected = selectedId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => onSelect(node)}
                      onDoubleClick={() => onFocus(node)}
                      className={cn(
                        "rounded-[16px] border p-3 text-left transition active:scale-[0.98]",
                        selected ? "ring-2 ring-[color:var(--brand)]" : "",
                        tonePanelClass(node.tone),
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded border", toneIconClass(node.tone))}>
                          <Icon size={16} weight="bold" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-lg leading-tight text-fg">{node.label}</span>
                          <span className="mt-1 flex items-center gap-2 t-mono text-label text-fg-muted">
                            <StatusDot tone={node.tone} />
                            {node.statusLabel}
                          </span>
                          <span className="mt-2 line-clamp-2 block text-body-sm leading-relaxed text-fg-muted">
                            {node.health}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MapNode({
  node,
  selected,
  onClick,
  onDoubleClick,
  onHover,
  onLeave,
}: {
  node: RenderedMindNode;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  const Icon = KIND_ICONS[node.kind];
  const compact = node.level >= 3 || node.displayMode !== "detail";
  const context = node.displayMode === "context";

  return (
    <button
      type="button"
      data-display-mode={node.displayMode}
      data-mind-node={node.id}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={onHover}
      onPointerMove={onHover}
      onPointerLeave={onLeave}
      className={cn(
        "absolute overflow-hidden rounded-[20px] border p-4 text-left shadow-[0_18px_42px_-30px_rgba(5,5,3,0.82)] transition duration-300 ease-out active:scale-[0.99]",
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--focus-ring-soft)]",
        toneNodeClass(node.tone),
        selected && "ring-2 ring-[color:var(--brand)]",
        compact ? "rounded-[18px] p-3" : "",
        context ? "rounded-[999px] border-dashed bg-[color:var(--bg-card)]/80 shadow-none" : "",
      )}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
    >
      <div className={cn("flex items-start gap-3", context && "items-center")}>
        <span className={cn("grid shrink-0 place-items-center rounded border", compact ? "h-7 w-7" : "mt-0.5 h-8 w-8", toneIconClass(node.tone))}>
          <Icon size={compact ? 15 : 17} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-display text-lg leading-tight text-fg", compact && "text-base")}>
            {node.label}
          </span>
          <span className={cn("mt-1 flex min-w-0 items-center gap-2 t-mono text-label text-fg-muted", context && "hidden")}>
            <StatusDot tone={node.tone} />
            <span className="truncate">{node.statusLabel}</span>
          </span>
        </span>
      </div>
      {!compact ? (
        <p className="mt-3 line-clamp-2 text-body-sm leading-relaxed text-fg-muted">
          {node.health}
        </p>
      ) : null}
      {node.metric && !compact ? (
        <p className="mt-3 truncate t-mono text-label text-brand">{node.metric}</p>
      ) : null}
    </button>
  );
}

function HoverLens({ node }: { node: MindNode | undefined }) {
  if (!node) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-4 w-[320px] max-w-[calc(100%-2rem)] rounded-[18px] border border-white/10 bg-[rgba(17,17,16,0.9)] p-4 shadow-[0_20px_52px_-24px_rgba(5,5,3,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
      <p className="t-label u-brand">INSPECTING</p>
      <p className="mt-2 truncate font-display text-xl leading-tight text-fg">{node.label}</p>
      <div className="mt-3 flex min-w-0 items-center gap-2 t-mono text-label text-fg-muted">
        <StatusDot tone={node.tone} />
        <span className="truncate">{node.statusLabel}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-body-sm leading-relaxed text-fg-muted">{node.health}</p>
      {node.metric ? (
        <p className="mt-3 truncate t-mono text-label text-brand">{node.metric}</p>
      ) : null}
    </div>
  );
}

function MapOverview({
  nodes,
  transform,
  viewportSize,
}: {
  nodes: MindNode[];
  transform: ViewTransform;
  viewportSize: ViewportSize;
}) {
  const width = 154;
  const height = 108;
  const padding = 9;
  const scale = Math.min((width - padding * 2) / WORLD.width, (height - padding * 2) / WORLD.height);
  const viewX = padding + (-transform.x / transform.scale) * scale;
  const viewY = padding + (-transform.y / transform.scale) * scale;
  const viewWidth = (viewportSize.width / transform.scale) * scale;
  const viewHeight = (viewportSize.height / transform.scale) * scale;

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 hidden rounded-[16px] border border-white/10 bg-[rgba(17,17,16,0.78)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur lg:block">
      <svg aria-hidden="true" height={height} width={width}>
        <rect
          x={0.5}
          y={0.5}
          width={width - 1}
          height={height - 1}
          rx={12}
          fill="rgba(236,230,210,0.035)"
          stroke="rgba(236,230,210,0.12)"
        />
        {nodes.map((node) => (
          <rect
            key={node.id}
            x={padding + node.x * scale}
            y={padding + node.y * scale}
            width={Math.max(2, node.width * scale)}
            height={Math.max(2, node.height * scale)}
            rx={2}
            fill={miniToneFill(node.tone)}
            opacity={node.level <= 1 ? 0.7 : 0.42}
          />
        ))}
        <rect
          x={clamp(viewX, padding, width - padding)}
          y={clamp(viewY, padding, height - padding)}
          width={clamp(viewWidth, 8, width - padding * 2)}
          height={clamp(viewHeight, 8, height - padding * 2)}
          rx={4}
          fill="rgba(155,190,206,0.08)"
          stroke="rgba(155,190,206,0.86)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}

function MindInspector({
  node,
  path,
  snapshot,
  loading,
  errors,
  onFocus,
}: {
  node: MindNode | undefined;
  path: MindNode[];
  snapshot: RuntimeSnapshot;
  loading: boolean;
  errors: string[];
  onFocus: () => void;
}) {
  if (!node) {
    return (
      <aside className="border-t border-[color:var(--border)] p-5 xl:border-l xl:border-t-0">
        <InspectorSkeleton />
      </aside>
    );
  }

  const Icon = KIND_ICONS[node.kind];
  const sourceLink = node.files?.map(sourceHref).find((href): href is string => Boolean(href));
  const controlLink = node.controls?.map(controlHref).find((href): href is string => Boolean(href));
  const primaryLink = node.links?.[0]?.href;
  const issueNotes = operationalNotes(node, snapshot, errors);

  return (
    <aside className="border-t border-[color:var(--border)] bg-[color:var(--bg)] p-5 xl:border-l xl:border-t-0">
      <div className="sticky top-4 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="t-label u-brand">SELECTED COMPONENT</p>
            <h3 className="mt-2 font-display text-3xl leading-none text-fg">{node.label}</h3>
          </div>
          <button
            type="button"
            onClick={onFocus}
            aria-label="Focus selected component"
            className="grid min-h-touch w-11 shrink-0 place-items-center rounded border border-[color:var(--border)] text-fg-muted transition hover:border-[color:var(--brand)] hover:text-brand active:scale-[0.98]"
          >
            <Crosshair size={18} weight="bold" />
          </button>
        </div>

        {path.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {path.map((item, index) => (
              <span key={item.id} className="inline-flex items-center gap-1.5 t-mono text-label text-fg-muted">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span className={item.id === node.id ? "text-brand" : ""}>{item.label}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <StatusChip label={node.statusLabel} tone={node.tone} />
          <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[color:var(--border)] px-3 t-mono text-label text-fg-muted">
            <Icon size={15} weight="bold" />
            Level {node.level}
          </span>
        </div>

        <p className="text-body-sm leading-relaxed text-fg-muted">{node.description}</p>

        <div className="grid grid-cols-2 gap-2">
          <ActionLink label="Focus" icon={Crosshair} onClick={onFocus} />
          {sourceLink ? <ActionLink label="Source" icon={Files} href={sourceLink} external /> : null}
          {primaryLink ? <ActionLink label="View" icon={ArrowSquareOut} href={primaryLink} /> : null}
          {controlLink ? <ActionLink label="Control" icon={Wrench} href={controlLink} /> : null}
        </div>

        <div className="grid gap-3 border-y border-[color:var(--border)] py-4">
          <InspectorFact label="Health" value={node.health} tone={node.tone} />
          {node.metric ? <InspectorFact label="Metric" value={node.metric} /> : null}
          {node.backlog ? <InspectorFact label="Backlog" value={node.backlog} tone="watch" /> : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <InspectorMetric label="Reads" value={String(node.reads?.length ?? 0)} />
          <InspectorMetric label="Writes" value={String(node.writes?.length ?? 0)} />
          <InspectorMetric label="Controls" value={String(node.controls?.length ?? 0)} />
          <InspectorMetric label="State paths" value={String(node.files?.length ?? 0)} />
        </div>

        {loading ? <InspectorSkeleton compact /> : null}

        {issueNotes.length ? (
          <div className="rounded-[18px] border border-[color:var(--state-warning-border)] bg-[color:var(--state-warning-bg)] p-4">
            <div className="flex items-center gap-2 text-[color:var(--state-warning-fg)]">
              <Warning size={17} weight="bold" />
              <p className="t-mono text-label">Operator notes</p>
            </div>
            <ul className="mt-3 space-y-2">
              {issueNotes.slice(0, 5).map((note) => (
                <li key={note} className="text-label leading-relaxed text-[color:var(--state-warning-fg-muted)]">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <InfoList title="Reads" items={node.reads} empty="No read surface mapped yet." />
        <InfoList title="Writes" items={node.writes} empty="No write surface mapped yet." />
        <InfoList title="Controls" items={node.controls} empty="No direct control mapped yet." />
        <InfoList title="State files" items={node.files} empty="No code path mapped yet." code />

        {node.links?.length ? (
          <div>
            <p className="t-mono text-label text-fg-muted">Links</p>
            <div className="mt-2 grid gap-2">
              {node.links.map((link) => (
                <a
                  key={`${link.href}-${link.label}`}
                  className="inline-flex min-h-touch items-center justify-between rounded border border-[color:var(--border)] px-3 t-mono text-label text-fg transition hover:border-[color:var(--brand)] hover:text-brand"
                  href={link.href}
                >
                  {link.label}
                  <ArrowSquareOut size={15} weight="bold" />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function operationalNotes(node: MindNode, snapshot: RuntimeSnapshot, errors: string[]) {
  const notes: string[] = [];
  if (node.tone === "risk") notes.push(`${node.label} is in a risk state: ${node.statusLabel}.`);
  if (node.tone === "watch") notes.push(`${node.label} needs attention: ${node.statusLabel}.`);
  if (node.backlog) notes.push(`Backlog: ${node.backlog}`);

  if (node.id === "backend-keys" && snapshot.keys) {
    const missing = snapshot.keys.filter((key) => !key.set).map((key) => key.label);
    if (missing.length) notes.push(`Missing provider keys: ${missing.join(", ")}.`);
  }

  if ((node.id === "platform" || node.id === "backend") && errors.length) {
    notes.push(...errors.slice(0, 3));
  }

  if (node.id === "broker-connections" && snapshot.brokerConnections) {
    const withError = snapshot.brokerConnections.filter((connection) => connection.last_error);
    if (withError.length) notes.push(`${withError.length} broker connection has a recorded error.`);
  }

  if (node.id === "tradingagents-runtime" && snapshot.tradingAgents?.warnings.length) {
    notes.push(snapshot.tradingAgents.warnings[0]);
  }

  return Array.from(new Set(notes));
}

function ActionLink({
  label,
  icon: Icon,
  href,
  external = false,
  onClick,
}: {
  label: string;
  icon: PhosphorIcon;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}) {
  const className =
    "inline-flex min-h-touch items-center justify-between gap-2 rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 t-mono text-label text-fg transition hover:border-[color:var(--brand)] hover:text-brand active:scale-[0.98]";
  const content = (
    <>
      <span className="inline-flex items-center gap-2">
        <Icon size={15} weight="bold" />
        {label}
      </span>
      {href ? <ArrowSquareOut size={14} weight="bold" /> : null}
    </>
  );

  if (href) {
    return (
      <a
        className={className}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] p-3">
      <p className="t-mono text-label text-fg-muted">{label}</p>
      <p className="mt-2 t-mono text-xl leading-none text-fg">{value}</p>
    </div>
  );
}

function InspectorSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("space-y-3", compact && "rounded-[18px] border border-[color:var(--border)] p-4")}>
      <div className="h-3 w-28 animate-pulse rounded bg-[color:var(--border)]" />
      <div className="h-8 w-3/4 animate-pulse rounded bg-[color:var(--bg-elev-2)]" />
      <div className="h-3 w-full animate-pulse rounded bg-[color:var(--border)]" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-[color:var(--border)]" />
    </div>
  );
}

function InspectorFact({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="grid gap-1">
      <p className="t-mono text-label text-fg-muted">{label}</p>
      <p className={cn("text-body-sm leading-relaxed", toneTextClass(tone))}>{value}</p>
    </div>
  );
}

function InfoList({
  title,
  items,
  empty,
  code = false,
}: {
  title: string;
  items?: string[];
  empty: string;
  code?: boolean;
}) {
  return (
    <div>
      <p className="t-mono text-label text-fg-muted">{title}</p>
      {items?.length ? (
        <ul className="mt-2 space-y-2">
          {items.map((item) => {
            const href = code ? sourceHref(item) : null;
            return (
              <li
                key={item}
                className={cn(
                  "rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] text-label leading-relaxed text-fg-muted",
                  code && "font-mono",
                )}
              >
                {href ? (
                  <a
                    className="flex min-h-touch items-center justify-between gap-3 px-3 py-2 transition hover:text-brand"
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel={href.startsWith("http") ? "noreferrer" : undefined}
                  >
                    <span className="min-w-0 break-words">{item}</span>
                    <ArrowSquareOut className="shrink-0" size={14} weight="bold" />
                  </a>
                ) : (
                  <span className="block px-3 py-2">{item}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 rounded border border-[color:var(--border)] px-3 py-2 text-label text-fg-muted">
          {empty}
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid min-h-touch w-11 place-items-center rounded border border-[color:var(--border)] text-fg-muted transition hover:border-[color:var(--brand)] hover:text-brand active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("inline-flex min-h-8 items-center gap-2 rounded-full border px-3 t-mono text-label", tonePillClass(tone))}>
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function StatusDot({ tone }: { tone: Tone }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", toneDotClass(tone))} />;
}

function edgeStroke(from: MindNode, to: MindNode) {
  if (from.tone === "risk" || to.tone === "risk") return "var(--loss)";
  if (from.tone === "active" || to.tone === "active") return "var(--ice-500)";
  if (from.tone === "watch" || to.tone === "watch") return "var(--state-warning)";
  return "var(--border-strong)";
}

function toneNodeClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "border-[color:var(--profit)] bg-[color:var(--profit-tint)]";
    case "active":
      return "border-[color:var(--ice-500)] bg-[color:var(--state-loading-tint)]";
    case "watch":
      return "border-[color:var(--state-warning-border)] bg-[color:var(--state-warning-bg)]";
    case "risk":
      return "border-[color:var(--loss)] bg-[color:var(--loss-tint)]";
    case "muted":
    default:
      return "border-[color:var(--border)] bg-[color:var(--bg-card)]";
  }
}

function tonePanelClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "border-[color:var(--profit)]/45 bg-[color:var(--profit-tint)]";
    case "active":
      return "border-[color:var(--ice-500)]/55 bg-[color:var(--state-loading-tint)]";
    case "watch":
      return "border-[color:var(--state-warning-border)] bg-[color:var(--state-warning-bg)]";
    case "risk":
      return "border-[color:var(--loss)]/65 bg-[color:var(--loss-tint)]";
    case "muted":
    default:
      return "border-[color:var(--border)] bg-[color:var(--bg-card)]";
  }
}

function toneIconClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "border-[color:var(--profit)] text-profit bg-[color:var(--profit-tint)]";
    case "active":
      return "border-[color:var(--ice-500)] text-ice bg-[color:var(--state-loading-tint)]";
    case "watch":
      return "border-[color:var(--state-warning-border)] text-[color:var(--state-warning-fg)] bg-[color:var(--state-warning-bg)]";
    case "risk":
      return "border-[color:var(--loss)] text-loss bg-[color:var(--loss-tint)]";
    case "muted":
    default:
      return "border-[color:var(--border)] text-fg-muted bg-[color:var(--bg-elev-2)]";
  }
}

function tonePillClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "border-[color:var(--profit)] bg-[color:var(--profit-tint)] text-profit";
    case "active":
      return "border-[color:var(--ice-500)] bg-[color:var(--state-loading-tint)] text-ice";
    case "watch":
      return "border-[color:var(--state-warning-border)] bg-[color:var(--state-warning-bg)] text-[color:var(--state-warning-fg)]";
    case "risk":
      return "border-[color:var(--loss)] bg-[color:var(--loss-tint)] text-loss";
    case "muted":
    default:
      return "border-[color:var(--border)] bg-[color:var(--bg-elev-1)] text-fg-muted";
  }
}

function toneDotClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "bg-[color:var(--profit)]";
    case "active":
      return "bg-[color:var(--ice-500)]";
    case "watch":
      return "bg-[color:var(--state-warning)]";
    case "risk":
      return "bg-[color:var(--loss)]";
    case "muted":
    default:
      return "bg-[color:var(--fg-muted)]";
  }
}

function miniToneFill(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "rgba(169,217,74,0.72)";
    case "active":
      return "rgba(155,190,206,0.74)";
    case "watch":
      return "rgba(218,174,69,0.68)";
    case "risk":
      return "rgba(231,111,76,0.72)";
    case "muted":
    default:
      return "rgba(236,230,210,0.34)";
  }
}

function toneTextClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "text-profit";
    case "active":
      return "text-ice";
    case "watch":
      return "text-[color:var(--state-warning-fg)]";
    case "risk":
      return "text-loss";
    case "muted":
    default:
      return "text-fg";
  }
}
