/**
 * MOCK_CONTROLS — fixture for the v2 Admin Control Center registry.
 *
 * Per v2-plan §1.6, the Admin Control Center IS a flat list of
 * `<ControlModule>` cards tagged by category. The registry below
 * stands in for the eventual `GET /api/v1/admin/runtime-controls`
 * endpoint until backend B.1/B.2/B.6/B.8 land.
 *
 * Categories cover the runtime surfaces called out in v2-plan §1.6(g):
 *   - keys     · provider API key rotation (B.16 backend)
 *   - layout   · dashboard section composer (B.6)
 *   - trade    · halt + order rate limits
 *   - pipeline · per-stage pause/resume (B.1)
 *   - ai       · per-agent pause + spend cap (B.2)
 *   - risk     · global risk gates (max position, sector cap, VaR…)
 *   - data     · provider rails health
 *   - deploy   · deploy dispatch per env/service/branch
 *   - flags    · runtime feature flags (B.8)
 *   - features · admin-only product feature toggles
 *
 * Each ControlSpec maps directly to the props of `<ControlModule>`
 * plus a small bag of `extra` for control-specific config (units,
 * value-shape) that the page composes.
 */

export type ControlCategory =
  | "keys"
  | "layout"
  | "trade"
  | "pipeline"
  | "ai"
  | "risk"
  | "data"
  | "deploy"
  | "flags"
  | "features"
  | "agents"
  | "strategies";

export type ControlSurface =
  | "switch"
  | "input-text"
  | "input-number"
  | "input-secret"
  | "segmented"
  | "select"
  | "slider"
  | "button"
  | "danger-button";

export interface ControlSpec {
  id: string;
  category: ControlCategory;
  /** Display name. */
  name: string;
  /** One-line description. */
  desc: string;
  /** What kind of control surface to render. */
  surface: ControlSurface;
  /** Current value — shape depends on surface. */
  value: unknown;
  /** Optional unit string (e.g. "USD", "%", "bps"). */
  unit?: string;
  /** When true, ControlModule renders critical styling. */
  critical?: boolean;
  /** When true, the action is destructive (paired with DangerConfirm). */
  dangerous?: boolean;
  /** Permission required. Defaults to "toggle". */
  permission?: "read" | "toggle" | "write-secret" | "dispatch";
  /** Last actor that changed this. */
  lastBy?: string;
  /** ISO timestamp. */
  lastAt?: string;
  /** Optional select/segmented options. */
  options?: { label: string; value: string }[];
  /** Numeric min/max for input-number / slider. */
  min?: number;
  max?: number;
  /** Optional ENV var name (used by keys category). */
  envVar?: string;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const MOCK_CONTROLS: ControlSpec[] = [
  // ─── Keys ────────────────────────────────────────────
  {
    id: "key-anthropic",
    category: "keys",
    name: "Anthropic key",
    desc: "Anthropic API key. Used by every Claude-backed agent. UI never reads plaintext after submit.",
    surface: "input-secret",
    value: "**** rotated 12d ago",
    permission: "write-secret",
    envVar: "ANTHROPIC_API_KEY",
    lastBy: "operator",
    lastAt: ago(12 * DAY),
    dangerous: true,
  },
  {
    id: "key-fmp",
    category: "keys",
    name: "FMP key",
    desc: "Financial Modeling Prep — fundamentals, earnings calendar, dividends.",
    surface: "input-secret",
    value: "**** rotated 4d ago",
    permission: "write-secret",
    envVar: "FMP_API_KEY",
    lastBy: "operator",
    lastAt: ago(4 * DAY),
    dangerous: true,
  },
  {
    id: "key-alpaca",
    category: "keys",
    name: "Alpaca key",
    desc: "Alpaca brokerage API key. Paper + live URLs are configured per BrokerConnection.",
    surface: "input-secret",
    value: "not set",
    critical: true,
    permission: "write-secret",
    envVar: "ALPACA_API_KEY",
    lastBy: "operator",
    lastAt: ago(60 * DAY),
    dangerous: true,
  },
  {
    id: "key-alpaca-secret",
    category: "keys",
    name: "Alpaca secret",
    desc: "Alpaca brokerage API secret. Paired with ALPACA_API_KEY.",
    surface: "input-secret",
    value: "not set",
    critical: true,
    permission: "write-secret",
    envVar: "ALPACA_SECRET_KEY",
    dangerous: true,
  },
  {
    id: "key-openai",
    category: "keys",
    name: "OpenAI key",
    desc: "OpenAI API key. Optional fallback for agents.",
    surface: "input-secret",
    value: "**** rotated 30d ago",
    permission: "write-secret",
    envVar: "OPENAI_API_KEY",
    lastBy: "operator",
    lastAt: ago(30 * DAY),
    dangerous: true,
  },
  {
    id: "key-polygon",
    category: "keys",
    name: "Polygon key",
    desc: "Polygon market data — quotes, bars, options chains.",
    surface: "input-secret",
    value: "**** rotated 8d ago",
    permission: "write-secret",
    envVar: "POLYGON_API_KEY",
    lastBy: "operator",
    lastAt: ago(8 * DAY),
    dangerous: true,
  },

  // ─── Trade ───────────────────────────────────────────
  {
    id: "trade-halt",
    category: "trade",
    name: "Trade halt",
    desc: "Stop the order flow at the gate. Existing live orders queue or cancel per scope.",
    surface: "danger-button",
    value: false,
    dangerous: true,
    lastBy: "operator",
    lastAt: ago(2 * DAY),
  },
  {
    id: "trade-order-rate-broker",
    category: "trade",
    name: "Order rate per broker",
    desc: "Maximum new orders per second per broker. Hard cap before backend rejects.",
    surface: "input-number",
    value: 8,
    unit: "orders/s",
    min: 1,
    max: 50,
    lastBy: "operator",
    lastAt: ago(7 * DAY),
  },
  {
    id: "trade-order-rate-strategy",
    category: "trade",
    name: "Order rate per strategy",
    desc: "Maximum new orders per minute per strategy id.",
    surface: "input-number",
    value: 24,
    unit: "orders/min",
    min: 1,
    max: 200,
  },
  {
    id: "trade-order-rate-symbol",
    category: "trade",
    name: "Order rate per symbol",
    desc: "Maximum new orders per minute per symbol.",
    surface: "input-number",
    value: 12,
    unit: "orders/min",
    min: 1,
    max: 100,
  },

  // ─── Pipeline ────────────────────────────────────────
  {
    id: "pipeline-stage-ingest",
    category: "pipeline",
    name: "Ingest stage",
    desc: "Pulls fresh OHLCV + options snapshots from providers into Postgres.",
    surface: "switch",
    value: true,
    lastBy: "system",
    lastAt: ago(45 * 60 * 1000),
  },
  {
    id: "pipeline-stage-enrich",
    category: "pipeline",
    name: "Enrich stage",
    desc: "Computes indicators, regime score, sector aggregates.",
    surface: "switch",
    value: true,
    lastBy: "system",
    lastAt: ago(30 * 60 * 1000),
  },
  {
    id: "pipeline-stage-score",
    category: "pipeline",
    name: "Score stage",
    desc: "Strategy-level scoring on every active strategy.",
    surface: "switch",
    value: true,
    lastBy: "system",
    lastAt: ago(15 * 60 * 1000),
  },
  {
    id: "pipeline-stage-risk",
    category: "pipeline",
    name: "Risk stage",
    desc: "Pre-trade risk gates (max position, sector cap, drawdown).",
    surface: "switch",
    value: true,
    lastBy: "system",
    lastAt: ago(8 * 60 * 1000),
  },
  {
    id: "pipeline-stage-execute",
    category: "pipeline",
    name: "Execute stage",
    desc: "Routes accepted orders to broker. Pauses immediately on Trade halt.",
    surface: "switch",
    value: true,
    lastBy: "system",
    lastAt: ago(5 * 60 * 1000),
  },

  // ─── AI / Agents ─────────────────────────────────────
  {
    id: "ai-archetype-research",
    category: "ai",
    name: "Research agents",
    desc: "Pause / resume all Research-archetype agents. Disables Regime + Earnings + News.",
    surface: "switch",
    value: true,
  },
  {
    id: "ai-archetype-signal",
    category: "ai",
    name: "Signal agents",
    desc: "Pause / resume all Signal-archetype agents.",
    surface: "switch",
    value: true,
  },
  {
    id: "ai-archetype-risk",
    category: "ai",
    name: "Risk agents",
    desc: "Pause / resume all Risk-archetype agents. Order flow continues.",
    surface: "switch",
    value: true,
  },
  {
    id: "ai-archetype-exec",
    category: "ai",
    name: "Exec agents",
    desc: "Pause / resume Exec-archetype agents (router, options builder).",
    surface: "switch",
    value: true,
  },
  {
    id: "ai-spend-claude-daily",
    category: "ai",
    name: "Claude daily spend cap",
    desc: "Hard cap on Anthropic spend per day. Reset 00:00 UTC.",
    surface: "input-number",
    value: 200,
    unit: "USD",
    min: 5,
    max: 5000,
    lastBy: "operator",
    lastAt: ago(2 * DAY),
  },
  {
    id: "ai-spend-openai-daily",
    category: "ai",
    name: "OpenAI daily spend cap",
    desc: "Hard cap on OpenAI spend per day. Reset 00:00 UTC.",
    surface: "input-number",
    value: 25,
    unit: "USD",
    min: 0,
    max: 1000,
  },

  // ─── Risk gates ──────────────────────────────────────
  {
    id: "risk-max-position",
    category: "risk",
    name: "Max position size",
    desc: "Largest single name as a percent of NAV.",
    surface: "input-number",
    value: 8,
    unit: "%",
    min: 1,
    max: 25,
  },
  {
    id: "risk-sector-cap",
    category: "risk",
    name: "Sector cap",
    desc: "Maximum exposure per GICS sector.",
    surface: "input-number",
    value: 35,
    unit: "%",
    min: 10,
    max: 60,
    critical: true,
    lastBy: "system",
    lastAt: ago(2 * HOUR),
  },
  {
    id: "risk-drawdown-stop",
    category: "risk",
    name: "Drawdown stop",
    desc: "Trading halts automatically if rolling 5d drawdown exceeds this.",
    surface: "input-number",
    value: 6,
    unit: "%",
    min: 1,
    max: 20,
  },
  {
    id: "risk-var-limit",
    category: "risk",
    name: "VaR 1d 95 limit",
    desc: "Hard cap on 1d 95% Value at Risk as percent of NAV.",
    surface: "input-number",
    value: 2.5,
    unit: "%",
    min: 0.5,
    max: 10,
  },
  {
    id: "risk-beta-cap",
    category: "risk",
    name: "Portfolio beta cap",
    desc: "Maximum portfolio beta vs SPY.",
    surface: "input-number",
    value: 1.4,
    min: 0.2,
    max: 2.5,
  },
  {
    id: "risk-concentration-cap",
    category: "risk",
    name: "Concentration cap",
    desc: "Maximum single-strategy exposure as percent of NAV.",
    surface: "input-number",
    value: 25,
    unit: "%",
    min: 5,
    max: 60,
  },

  // ─── Provider rails ──────────────────────────────────
  {
    id: "data-rail-alpaca",
    category: "data",
    name: "Alpaca rail",
    desc: "Order routing + market data for equities. Health probed every 30s.",
    surface: "switch",
    value: true,
  },
  {
    id: "data-rail-polygon",
    category: "data",
    name: "Polygon rail",
    desc: "Real-time quotes + options chains.",
    surface: "switch",
    value: true,
  },
  {
    id: "data-rail-fmp",
    category: "data",
    name: "FMP rail",
    desc: "Fundamentals, earnings calendar, dividends.",
    surface: "switch",
    value: true,
  },
  {
    id: "data-rail-anthropic",
    category: "data",
    name: "Anthropic rail",
    desc: "Claude API. All Research/Signal/Risk/Exec archetypes consume.",
    surface: "switch",
    value: true,
  },

  // ─── Deploy ──────────────────────────────────────────
  {
    id: "deploy-prod-frontend",
    category: "deploy",
    name: "Deploy frontend (prod)",
    desc: "Trigger GitHub Actions workflow_dispatch on feature/deployment.",
    surface: "danger-button",
    value: null,
    dangerous: true,
    permission: "dispatch",
  },
  {
    id: "deploy-prod-backend",
    category: "deploy",
    name: "Deploy backend (prod)",
    desc: "Trigger GitHub Actions workflow_dispatch for the backend service.",
    surface: "danger-button",
    value: null,
    dangerous: true,
    permission: "dispatch",
  },
  {
    id: "deploy-staging-all",
    category: "deploy",
    name: "Deploy staging (all)",
    desc: "Trigger staging deployment for both frontend and backend services.",
    surface: "danger-button",
    value: null,
    permission: "dispatch",
  },

  // ─── Feature flags ───────────────────────────────────
  {
    id: "flag-dashboard-live-ticker",
    category: "flags",
    name: "dashboard.live_ticker",
    desc: "Hero equity ticker live-tick animation. Off ⇒ static value.",
    surface: "switch",
    value: true,
  },
  {
    id: "flag-trade-options-chain",
    category: "flags",
    name: "trade.options_chain",
    desc: "Show full options chain panel on Trade page.",
    surface: "switch",
    value: true,
  },
  {
    id: "flag-symbol-ai-thesis",
    category: "flags",
    name: "symbol.ai_thesis",
    desc: "Render AI thesis card on Symbol page Overview tab.",
    surface: "switch",
    value: true,
  },
  {
    id: "flag-jarvis-bar",
    category: "flags",
    name: "command.jarvis",
    desc: "⌘⇧J Jarvis conversational command bar. Phase 0 ships fuzzy-search-only.",
    surface: "switch",
    value: true,
  },
  {
    id: "flag-impersonation",
    category: "flags",
    name: "admin.impersonation",
    desc: "Operator impersonation. Default OFF until consent flow ships.",
    surface: "switch",
    value: false,
  },

  // ─── Strategies ──────────────────────────────────────
  {
    id: "strategy-momentum-quality",
    category: "strategies",
    name: "Momentum + Quality",
    desc: "Trend-follow on quality screened by ROIC + low debt.",
    surface: "switch",
    value: true,
  },
  {
    id: "strategy-pead",
    category: "strategies",
    name: "Post-earnings drift (PEAD)",
    desc: "Long names with positive earnings surprise + sustained drift.",
    surface: "switch",
    value: true,
  },
  {
    id: "strategy-earnings-options",
    category: "strategies",
    name: "Earnings options play",
    desc: "Defined-risk options structures around earnings prints.",
    surface: "switch",
    value: false,
  },
];

/** Number of distinct module categories — used by Admin sub-rail. */
export function controlCategories(): ControlCategory[] {
  return Array.from(new Set(MOCK_CONTROLS.map((c) => c.category)));
}

/** Filter helper used by `useControls({category})`. */
export function controlsByCategory(category: ControlCategory): ControlSpec[] {
  return MOCK_CONTROLS.filter((c) => c.category === category);
}
