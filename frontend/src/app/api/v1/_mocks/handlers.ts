/**
 * v2 mock handlers — visual-regression bridge.
 *
 * Local dev has no backend, so every `/api/v1/*` call 404s and the dashboard
 * paints a "DATA UNAVAILABLE" banner that pollutes every screenshot. These
 * handlers return the minimum-viable shape per endpoint so the chrome looks
 * like the v2 design comp, not a degraded-state warning.
 *
 * Gated by `NEXT_PUBLIC_ENABLE_MOCKS=1` (or absence of a real backend) at
 * the catch-all route layer; production never sees these — the gate
 * short-circuits before the handler runs.
 *
 * Each handler returns the leanest payload that satisfies its consumer; the
 * goal is design parity, not feature simulation.
 */

export type MockHandler = (req: Request, params: Record<string, string>) => unknown;

/* ────────────────────────────────────────────────────────────────────────
 *  Lookup table: path → handler
 *  ----------------------------------------------------------------------
 *  Paths support `:param` capture (matched in `dispatch`). Order matters
 *  only when two paths could match — most specific first.
 * ──────────────────────────────────────────────────────────────────────── */

const NOW_ISO = () => new Date().toISOString();

// Symbol → realistic seed price. Keeps quote responses stable across reloads
// so visual snapshots aren't flaky on randomly-generated last prices.
const SEED_PRICES: Record<string, number> = {
  AAPL: 196.42, MSFT: 442.15, NVDA: 134.82, AMZN: 186.91, GOOGL: 172.33,
  META: 518.04, AVGO: 139.22, TSLA: 182.61, AMD: 142.87, SPY: 537.21,
  QQQ: 463.18, IWM: 218.04, VIX: 13.84, DXY: 104.62, NFLX: 642.10,
};

function quoteFor(symbol: string) {
  const sym = symbol.toUpperCase();
  const last = SEED_PRICES[sym] ?? 100;
  const change = +(last * 0.014).toFixed(2);
  return {
    symbol: sym,
    last,
    bid: +(last - 0.02).toFixed(2),
    ask: +(last + 0.02).toFixed(2),
    bidSize: 100,
    askSize: 100,
    change,
    changePct: +((change / last) * 100).toFixed(2),
    volume: 24_500_000,
    high: +(last * 1.018).toFixed(2),
    low: +(last * 0.992).toFixed(2),
    open: +(last * 0.998).toFixed(2),
    close: last,
    timestamp: Date.now(),
    avg_daily_volume_20d: 31_000_000,
    relative_volume: 0.79,
    session: "regular" as const,
  };
}

const HANDLERS: Record<string, MockHandler> = {
  // ─── Auth / user ──────────────────────────────────────────────────
  "GET /auth/session": () => ({ user: { email: "operator@local.dev", id: "op_1", role: "operator" }, expires_at: NOW_ISO() }),

  // ─── Notifications / news / watchlists / CSP-report ──────────────
  // These endpoints don't carry useful mock-mode payloads (no real
  // events to surface) but the FE polls them on every dashboard route.
  // Without stubs they'd 404 and the "DATA UNAVAILABLE" banner would
  // light up with phantom backend failures that the operator can't act
  // on. Each shape mirrors what the real api.ts wrapper expects:
  // - getNotifications → `NotificationV2[]` (raw array)
  // - getMarketNews    → `{articles: [...]}` (the wrapper returns `.articles`)
  // - getWatchlistsV2  → `WatchlistV2[]` (raw array)
  // - getUserWatchlist → `{symbols, as_of}` (mapped to camelCase by the wrapper)
  // Returning the wrong shape crashes the FE consumer and silently
  // wipes the live quote / portfolio state, so we mirror the wire
  // contract carefully here.
  "GET /notifications": () => [],
  "GET /news/market": () => ({ articles: [] }),
  "GET /news/symbol/:symbol": () => ({ articles: [] }),
  "GET /watchlists": () => [],
  "GET /user/watchlist": () => ({ symbols: ["NVDA", "AAPL", "MSFT", "SPY"], as_of: NOW_ISO() }),
  // CSP-report is a write-only endpoint; the browser POSTs violation
  // reports here per the `report-uri` directive in the proxy. Accept
  // and discard so the page isn't peppered with 404s from policy
  // checks the operator never sees.
  "POST /security/csp-report": () => ({ ok: true }),
  "GET /user/me": () => ({
    id: "op_1",
    email: "operator@local.dev",
    name: "Operator",
    role: "operator",
    plan: "desk",
    paper: true,
    timezone: "America/New_York",
  }),

  // ─── Portfolio ────────────────────────────────────────────────────
  // The api.ts `getPortfolioSummary` wrapper maps snake_case wire keys
  // (`buying_power`, `total_market_value`, etc.) into camelCase FE
  // shape. The earlier mock returned camelCase directly, so every
  // wrapped field came back undefined — Dashboard read "Buy pwr $0"
  // and the realized-P&L cell was em-dashed.
  "GET /portfolio/summary": () => ({
    equity: 284_512.41,
    cash: 87_320.10,
    buying_power: 174_640.20,
    total_market_value: 197_192.31,
    unrealized_pnl: 12_840.18,
    unrealized_pnl_pct: 6.96,
    realized_pnl_today: -1_840.22,
    positions_count: 8,
    day_pnl: -1_840.22,
    last_updated: NOW_ISO(),
    source: "alpaca",
    is_demo: false,
  }),
  "GET /portfolio/greeks": () => ({
    netDelta: 124.6, netGamma: 0.18, netTheta: -84.10, netVega: 312.40,
    betaWeightedDelta: 142.3, byPosition: [],
  }),

  // ─── Risk dashboard ──────────────────────────────────────────────
  // LiveDataProvider polls /risk/dashboard on every authenticated
  // route (it's outside the `shouldLoadRiskExtras` gate). Without a
  // stub the trade page reports a phantom 404 in the DATA UNAVAILABLE
  // banner even though nothing on the page consumes the response.
  "GET /risk/dashboard": () => ({
    portfolio_beta: 1.12,
    sharpe_ratio: 1.34,
    sortino_ratio: 1.82,
    current_drawdown_pct: -2.4,
    max_drawdown_pct: -8.1,
    var_95: -3240.12,
    var_99: -5_018.40,
    total_portfolio_value: 284_512.41,
    total_invested: 197_192.31,
    daily_pnl: -1_840.22,
    weekly_pnl: 4_120.55,
    monthly_pnl: 9_240.10,
    position_count: 8,
    as_of: NOW_ISO(),
    estimated: false,
  }),
  "GET /portfolio/performance": () => ({
    period: "30d",
    points: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
      equity: 280_000 + Math.sin(i / 4) * 4_000 + i * 200,
      pnl: Math.sin(i / 4) * 800 + i * 40,
    })),
  }),

  // ─── Trades / orders / positions ──────────────────────────────────
  "GET /halt-status": () => ({ halted: false, scope: "global", halted_by: null, halted_at: null, reason: null }),
  "GET /trades/halt-status": () => ({ halted: false, scope: "global", halted_by: null, halted_at: null, reason: null }),
  "GET /trades/positions": () => [
    // api.ts#getPositions expects snake_case backend shape (avg_cost,
    // current_price, market_value, unrealized_pnl) with the v2 strategy
    // slug for archetype attribution on /positions/[symbol].
    {
      symbol: "NVDA", side: "long", quantity: 250,
      avg_cost: 128.40, current_price: 134.82,
      unrealized_pnl: 1605, market_value: 33_705,
      stop_loss: 122.85, take_profit: 142.50,
      sector: "Information technology",
      strategy: "momentum-quality",
    },
    {
      symbol: "META", side: "long", quantity: 80,
      avg_cost: 502.10, current_price: 518.04,
      unrealized_pnl: 1275.20, market_value: 41_443.20,
      sector: "Communication services",
      strategy: "momentum-quality",
    },
    {
      symbol: "MSFT", side: "long", quantity: 120,
      avg_cost: 432.80, current_price: 442.15,
      unrealized_pnl: 1122.00, market_value: 53_058,
      sector: "Information technology",
      strategy: "regime-adaptive",
    },
  ],
  "GET /trades/orders": () => [],
  // Order preview + place — these are the POST endpoints the stage-
  // order pill hits. Mock-mode returns a synthetic "all checks
  // passed" preview with a freshly minted review_id; placing then
  // echoes back a mock order id. Without these the staging button
  // 404s and the operator never sees the success state.
  "POST /trades/orders/preview": () => ({
    review_id: `mock-review-${Math.random().toString(16).slice(2, 10)}`,
    can_submit: true,
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    checks: [
      { code: "ticket_shape",       label: "Ticket parses cleanly",            passed: true,  detail: "All fields present" },
      { code: "quote_fresh",        label: "Quote fresh (< 5s)",               passed: true,  detail: "Spread within $0.05 of NBBO" },
      { code: "risk_under_cap",     label: "Risk under 1% account cap",         passed: true,  detail: "Position sized inside policy" },
      { code: "halt_status",        label: "No trading halt",                   passed: true },
      { code: "policy_strategy",    label: "Strategy policy",                   passed: true,  detail: "Manual ticket — bypass allowed" },
    ],
  }),
  "POST /trades/orders": () => ({
    id: `mock-${Math.random().toString(16).slice(2, 10)}`,
    status: "accepted",
    submitted_at: NOW_ISO(),
  }),
  "GET /trades/alerts": () => [],
  "GET /trades/history": () => [],
  "POST /halt": () => ({ halted: true, scope: "global", halted_at: NOW_ISO(), reason: "manual halt" }),
  "POST /halt/resume": () => ({ halted: false, message: "Trading resumed." }),
  "POST /trades/flatten_all": () => ({ liquidated: 0, errors: [] }),

  // ─── Account (broker-level rollup) ────────────────────────────────
  "GET /account": () => ({
    equity: 284_512.41,
    cash: 87_320.10,
    buying_power: 174_640.20,
    daytrade_buying_power: 698_561.00,
    pattern_day_trader: false,
    portfolio_value: 284_512.41,
    initial_margin: 124_852.10,
    maintenance_margin: 51_204.80,
    last_equity: 286_352.63,
    status: "ACTIVE",
    currency: "USD",
    as_of: NOW_ISO(),
  }),

  // ─── User settings ────────────────────────────────────────────────
  // Drives the Settings → Preferences tab; the FE expects a flat
  // record with toggles + thresholds. Shape mirrors backend
  // user_settings table.
  "GET /user/settings": () => ({
    theme: "dark",
    density: "dense",
    default_broker_connection_id: 1,
    default_lot_size: 1,
    risk_alert_threshold_pct: 1.0,
    daily_loss_limit_pct: 2.0,
    confirm_before_submit: true,
    show_extended_hours: true,
    chart_indicators_default: ["SMA", "VWAP", "Volume"],
    chart_timeframe_default: "1H",
    as_of: NOW_ISO(),
  }),

  // ─── Pipeline ─────────────────────────────────────────────────────
  "GET /pipeline/status": () => ({ state: "idle", lastRun: NOW_ISO(), nextRun: null, queueDepth: 0 }),
  "GET /pipeline/positions": () => [],
  "GET /pipeline/history": () => [],
  "GET /pipeline/history/:date": () => ({ date: "", runs: [] }),
  "GET /pipeline/scheduler_state": () => ({ enabled: false, paused: false, nextRunAt: null }),
  "GET /pipeline/schedule": () => ({ cron: "*/15 9-16 * * 1-5", timezone: "America/New_York", enabled: true, last_run_at: NOW_ISO(), next_run_at: new Date(Date.now() + 900_000).toISOString() }),
  "GET /pipeline/stages": () => ({
    stages: [
      { name: "ingest",   status: "ok", last_run_at: NOW_ISO(), error: null, paused: false, duration_ms: 940 },
      { name: "screen",   status: "ok", last_run_at: NOW_ISO(), error: null, paused: false, duration_ms: 2_140 },
      { name: "rank",     status: "ok", last_run_at: NOW_ISO(), error: null, paused: false, duration_ms: 612 },
      { name: "stage",    status: "ok", last_run_at: NOW_ISO(), error: null, paused: false, duration_ms: 318 },
      { name: "execute",  status: "idle", last_run_at: null, error: null, paused: false, duration_ms: 0 },
    ],
  }),
  "GET /pipeline/summary": () => ({
    daily_runs: 32,
    success_rate: 0.96,
    last_failure_at: null,
    setups_staged_today: 3,
    setups_executed_today: 0,
    avg_run_ms: 3_840,
  }),
  "GET /pipeline/realtime": () => ({ setups: [] }),
  "GET /pipeline/staged": () => ({ candidates: [] }),
  "GET /pipeline/universe": () => ({ symbols: ["AAPL", "MSFT", "NVDA", "META", "GOOGL", "AMZN", "SPY", "QQQ"] }),
  "POST /pipeline/cancel": () => ({ ok: true }),
  "POST /pipeline/stages/:stage/pause": (_, { stage }) => ({ stage, paused: true }),
  "POST /pipeline/stages/:stage/resume": (_, { stage }) => ({ stage, paused: false }),

  // ─── Broker connections & reconciliation ──────────────────────────
  // The user explicitly asked: "none of the broker integrations work".
  // Provide complete mocks for every broker endpoint the Settings →
  // Brokers tab + Reports reconciliation banner reach for, so the
  // UI flows work end-to-end in mock mode and the operator can rehearse
  // connect / disconnect / reconcile without hitting 404s.
  "GET /broker/providers": () => ([
    { provider: "alpaca",   label: "Alpaca",              auth_model: "key_secret", account_envs: ["paper", "live"], trading_enabled: true,  reconciliation_enabled: true,  fields: ["api_key", "secret_key"] },
    { provider: "ibkr",     label: "Interactive Brokers", auth_model: "host_port",  account_envs: ["live"],          trading_enabled: true,  reconciliation_enabled: true,  fields: ["host", "port", "client_id", "account_id"] },
    { provider: "schwab",   label: "Charles Schwab",      auth_model: "oauth",      account_envs: ["live"],          trading_enabled: true,  reconciliation_enabled: true,  fields: [] },
    { provider: "etrade",   label: "E*TRADE",             auth_model: "oauth",      account_envs: ["live"],          trading_enabled: true,  reconciliation_enabled: false, fields: [] },
    { provider: "robinhood",label: "Robinhood",           auth_model: "unsupported",account_envs: [],                trading_enabled: false, reconciliation_enabled: false, fields: [] },
  ]),
  "GET /broker/connections": () => ([
    {
      id: 1,
      provider: "alpaca",
      account_env: "paper",
      display_name: "Alpaca paper",
      key_last4: "DEFG",
      status: "verified",
      is_default: true,
      verified_at: NOW_ISO(),
      last_sync_at: NOW_ISO(),
      last_error: null,
      broker_account_id: "PA3X8K7M9QZ",
      metadata: { paper_url: "https://paper-api.alpaca.markets", live_configured: true },
    },
  ]),
  "POST /broker/connections/:provider": (req, { provider }) => ({
    id: Math.floor(Math.random() * 1000) + 10,
    provider,
    account_env: "paper",
    display_name: `${provider} (mock)`,
    key_last4: "XXXX",
    status: "verified",
    is_default: false,
    verified_at: NOW_ISO(),
    last_sync_at: NOW_ISO(),
    last_error: null,
    broker_account_id: `MOCK-${provider.toUpperCase()}-${Math.random().toString(16).slice(2, 8)}`,
    metadata: {},
  }),
  "DELETE /broker/connections/:id": () => ({ ok: true }),
  "POST /broker/connections/:id/default": (_, { id }) => ({ id: Number(id), is_default: true }),
  "POST /broker/connections/:id/test": () => ({ ok: true, latency_ms: 42 + Math.floor(Math.random() * 30), checked_at: NOW_ISO() }),
  "GET /broker/reconciliation/state": () => ({
    last_reconciled_at: NOW_ISO(),
    open_issue_count: 0,
    primary_provider: "alpaca",
    is_clean: true,
  }),
  "GET /broker/reconciliation/issues": () => ([]),
  "POST /broker/reconciliation/run": () => ({ backfilled: 0, orphaned: 0, matched: 8 }),
  "POST /broker/reconciliation/issues/:id/approve": (_, { id }) => ({ id: Number(id), status: "approved", decided_at: NOW_ISO() }),
  "POST /broker/reconciliation/issues/:id/reject":  (_, { id }) => ({ id: Number(id), status: "rejected", decided_at: NOW_ISO() }),

  // ─── Strategies ────────────────────────────────────────────────────
  "GET /strategies/admin/risk-monitor": () => ({ status: "ok", breaches: [], lastCheckedAt: NOW_ISO() }),
  "POST /strategies/admin/risk-monitor": () => ({ status: "ok" }),
  "GET /strategies/leaderboard": () => ({
    leaders: [
      { strategy_id: "momentum-quality", label: "Momentum × Quality", return_pct: 14.2,  sharpe: 1.82, win_rate: 0.62 },
      { strategy_id: "vrp-harvest",      label: "VRP harvest",         return_pct: 9.8,  sharpe: 2.41, win_rate: 0.71 },
      { strategy_id: "earnings-options", label: "Earnings IV crush",   return_pct: 7.6,  sharpe: 1.55, win_rate: 0.58 },
    ],
    worst: [
      { strategy_id: "pairs-trading",    label: "Pairs trading",       return_pct: -3.4, sharpe: -0.42, win_rate: 0.39 },
    ],
    as_of: NOW_ISO(),
  }),
  "GET /strategies/admin/leaderboard": () => ({
    rows: [
      { strategy_id: "momentum-quality", live_pnl_30d: 4_120.55, paper_pnl_30d: 4_320.18, divergence_pct: -4.6, kill_switch_armed: false },
      { strategy_id: "vrp-harvest",      live_pnl_30d: 1_840.20, paper_pnl_30d: 1_902.40, divergence_pct: -3.3, kill_switch_armed: false },
    ],
    as_of: NOW_ISO(),
  }),
  "GET /strategies/contribution": () => ({
    as_of: NOW_ISO(),
    total_today: -1_840.22,
    total_mtd: 9_240.10,
    total_lifetime: 28_410.55,
    contributions: [
      { strategy_id: "momentum-quality", strategy_name: "Momentum × Quality", today_pnl: -940.50, mtd_pnl: 4_120.55, total_pnl: 12_840.18, invested: 99_420.00, closed_count: 38 },
      { strategy_id: "vrp-harvest",      strategy_name: "VRP harvest",         today_pnl: -312.00, mtd_pnl: 1_840.20, total_pnl:  5_120.40, invested: 28_540.00, closed_count: 22 },
      { strategy_id: "earnings-options", strategy_name: "Earnings IV crush",   today_pnl:  187.40, mtd_pnl:   980.10, total_pnl:  4_240.55, invested: 11_840.00, closed_count: 17 },
      { strategy_id: "pairs-trading",    strategy_name: "Pairs trading",       today_pnl: -812.12, mtd_pnl:  -612.40, total_pnl: -3_420.50, invested: 32_410.00, closed_count: 12 },
    ],
  }),
  "GET /strategies/admin/alloc-capital": () => ({ allocations: [] }),
  "PATCH /strategies/admin/alloc-capital": () => ({ ok: true }),
  "GET /strategies/admin/kill-switch-thresholds": () => ({
    daily_loss_pct: 2.0,
    weekly_loss_pct: 4.0,
    max_drawdown_pct: 8.0,
    breach_action: "halt_strategy",
  }),
  "PATCH /strategies/admin/kill-switch-thresholds": () => ({ ok: true }),
  "GET /strategies/:id/disabled-events": () => ({ events: [] }),
  "POST /strategies/:id/emergency-disable": (_, { id }) => ({ id, disabled: true, reason: "manual" }),
  "POST /strategies/:id/re-enable":          (_, { id }) => ({ id, disabled: false }),

  // ─── Agents ────────────────────────────────────────────────────────
  "GET /agents/controls": () => ([
    { id: 1, agent: "researcher", paused: false, daily_spend_cap_usd: 25.00, today_spend_usd: 3.21 },
    { id: 2, agent: "memo-writer", paused: false, daily_spend_cap_usd: 15.00, today_spend_usd: 1.05 },
    { id: 3, agent: "screener",    paused: false, daily_spend_cap_usd: 30.00, today_spend_usd: 4.80 },
  ]),
  "PATCH /agents/controls/:id": (_, { id }) => ({ id: Number(id), updated: true }),
  "POST /agents/chat": () => ({ messages: [], finish_reason: "stop" }),
  "POST /agents/refine-strategy": () => ({ ok: true, draft: null }),

  // ─── Risk dashboard extras (gate-loaded on /risk route) ───────────
  "GET /risk/var": () => ({
    var_95: -3_240.12,
    var_99: -5_018.40,
    es_95: -4_120.85,
    methodology: "historical_parametric",
    as_of: NOW_ISO(),
  }),
  "GET /risk/correlation": () => ({ rows: [], matrix: [], as_of: NOW_ISO() }),
  "GET /risk/drawdown": () => ({ points: [], peak_at: null, trough_at: null, max_dd_pct: 0 }),
  "GET /risk/drawdown/series": () => ({ points: [] }),
  "GET /risk/exposure": () => ({
    by_sector: [
      { sector: "Information technology", weight_pct: 38.4, beta_weighted: 42.1 },
      { sector: "Communication services", weight_pct: 19.1, beta_weighted: 17.8 },
      { sector: "Consumer discretionary", weight_pct: 14.2, beta_weighted: 13.0 },
    ],
    by_factor: [
      { factor: "Momentum", exposure: 0.84 },
      { factor: "Quality",  exposure: 0.41 },
      { factor: "Low vol",  exposure: -0.12 },
    ],
    as_of: NOW_ISO(),
  }),
  "GET /risk/crowding": () => ({ symbols: [], notes: "Crowding data unavailable in mock mode." }),
  "POST /risk/recompute": () => ({ ok: true, recomputed_at: NOW_ISO() }),

  // ─── Portfolio extras ──────────────────────────────────────────────
  "GET /portfolio/journal": () => ({ entries: [] }),
  "GET /portfolio/calendar": () => ({
    month: new Date().getUTCMonth() + 1, year: new Date().getUTCFullYear(),
    days: [], month_total: 0, trading_days: 0, winning_days: 0, losing_days: 0, best_day: null, worst_day: null,
  }),
  "GET /portfolio/contribution": () => ({ rows: [], total_pnl: 0 }),

  // ─── Analytics / slippage ──────────────────────────────────────────
  "GET /slippage/summary": () => ({
    rows: [
      { strategy: "momentum-quality", avg_slippage_bps:  4.2, sample_n: 142 },
      { strategy: "vrp-harvest",      avg_slippage_bps:  2.1, sample_n: 38 },
    ],
    overall_bps: 3.6,
    as_of: NOW_ISO(),
  }),

  // ─── Symbol analysis (per-ticker) ──────────────────────────────────
  "GET /analysis/analysis/:symbol": (_, { symbol }) => ({
    symbol: symbol.toUpperCase(),
    recommendation: "HOLD",
    composite_score: 0.62,
    advisory_disclaimer: "Mock advisory — for QA only.",
    strategy_live_status: null,
    agents: [],
    technicals: {},
  }),
  "POST /analysis/analyze/:symbol": (_, { symbol }) => ({
    symbol: symbol.toUpperCase(),
    queued: true,
    job_id: `mock-job-${Math.random().toString(16).slice(2, 8)}`,
  }),

  // ─── Earnings calendar (dashboard widget) ─────────────────────────
  "GET /earnings/calendar": () => ({
    upcoming: [
      { symbol: "NVDA", report_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10), time_of_day: "amc", consensus_eps: 3.87, implied_move_pct: 5.1, historical_post_move_pct: 4.2 },
      { symbol: "AAPL", report_date: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10), time_of_day: "amc", consensus_eps: 1.92, implied_move_pct: 3.6, historical_post_move_pct: 3.2 },
      { symbol: "MSFT", report_date: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10), time_of_day: "amc", consensus_eps: 3.14, implied_move_pct: 3.9, historical_post_move_pct: 3.5 },
    ],
    as_of: NOW_ISO(),
  }),

  // ─── Feature flags + admin ────────────────────────────────────────
  "GET /feature-flags": () => ({ flags: { dark_mode: true, advanced_options: true, beta_panels: true } }),
  "GET /admin/feature-flags": () => ({ flags: { dark_mode: true, advanced_options: true, beta_panels: true }, last_updated: NOW_ISO() }),
  "PATCH /admin/feature-flags/:key": () => ({ ok: true }),
  "GET /admin/control-center/layout": () => ({ layout: { panels: [] }, as_of: NOW_ISO() }),
  "GET /admin/control-center/deploy": () => ({ last_deploy: { sha: "mockdef0", message: "Mock deploy", deployed_at: NOW_ISO(), env: "paper" } }),

  // ─── Options snapshot (per-contract NBBO) ─────────────────────────
  "GET /options/contract-snapshot": (req) => {
    const url = new URL(req.url);
    const sym = (url.searchParams.get("symbol") || "NVDA260526C00134820").toUpperCase();
    return {
      symbol: sym,
      bid: 1.42, ask: 1.48, last: 1.45, bid_size: 12, ask_size: 18,
      open_interest: 1_245, volume: 312, iv: 0.41,
      delta: 0.50, gamma: 0.04, theta: -0.06, vega: 0.18,
      fetched_at: NOW_ISO(), is_demo: false,
    };
  },
  "GET /options/iv/:symbol": () => ({ surface: [], as_of: NOW_ISO() }),

  // ─── Reconcile trade ledger (separate from broker reconciliation) ─
  "POST /reconcile/trades": () => ({ rebuilt: 0, mismatches: 0, ok: true, as_of: NOW_ISO() }),

  // ─── Screener presets ──────────────────────────────────────────────
  "GET /screener/presets": () => ([]),
  "POST /screener/presets": () => ({ id: `mock-${Math.random().toString(16).slice(2, 8)}` }),

  // ─── Misc filler so the DATA UNAVAILABLE banner stays quiet ───────
  "GET /market-overview/sectors": () => ({
    sectors: [
      { sector: "Information technology", change_pct: 1.4, ytd_pct: 18.2, leader: "NVDA",  leader_change_pct: 2.1 },
      { sector: "Communication services", change_pct: 0.8, ytd_pct: 14.0, leader: "META",  leader_change_pct: 1.6 },
      { sector: "Consumer discretionary", change_pct: -0.3, ytd_pct: 4.1,  leader: "AMZN",  leader_change_pct: -0.5 },
      { sector: "Financials",             change_pct: 0.4, ytd_pct: 7.6,  leader: "JPM",   leader_change_pct: 0.9 },
      { sector: "Energy",                 change_pct: -0.9, ytd_pct: -2.4, leader: "XOM",   leader_change_pct: -1.4 },
    ],
    as_of: NOW_ISO(),
  }),
  "GET /notifications/preferences": () => ({ preferences: [] }),
  "PATCH /notifications/preferences/:type": () => ({ ok: true }),
  "POST /notifications/:id/read": () => ({ ok: true }),
  "POST /notifications/read-all": () => ({ ok: true }),
  "POST /auth/refresh": () => ({ ok: true, expires_at: new Date(Date.now() + 3600_000).toISOString() }),
  "POST /auth/2fa/enroll": () => ({ ok: true, secret: "MOCKSECRET" }),
  "POST /auth/2fa/verify": () => ({ ok: true }),
  "POST /auth/2fa/disable": () => ({ ok: true }),
  "POST /auth/change-password": () => ({ ok: true }),
  "POST /auth/logout-all": () => ({ ok: true }),
  "GET /trades/halt": () => ({ halted: false, scope: "global" }),
  "POST /trades/halt": () => ({ halted: true, scope: "global", halted_at: NOW_ISO() }),

  // Watchlists shape v2 — getEnrichedWatchlist consumer
  "GET /watchlists/:id": (_, { id }) => ({
    id: Number(id) || 1,
    name: "Default",
    items: [
      { symbol: "NVDA", note: null },
      { symbol: "AAPL", note: null },
      { symbol: "MSFT", note: null },
      { symbol: "SPY",  note: null },
    ],
  }),

  // ─── Market overview ──────────────────────────────────────────────
  // Shape matches getMarketRegime() in api.ts — nested `regime.{regime,
  // label, confidence, vix_level, description, indicators}`. The old
  // flat shape `{state, confidence, vix, ...}` made the TradeContext
  // rail read em-dashes because `regime.regime?.regime` was undefined.
  "GET /market-overview/regime": () => ({
    regime: {
      regime: "risk_on_trend",
      label: "Risk On · Trend",
      confidence: 0.72,
      vix_level: 13.84,
      description: "Vol compressed, breadth strong, credit firm. Setups gated open.",
      indicators: {
        vix: 13.84,
        breadth_above_50dma: 0.58,
        hy_spread_bps: 312,
        fear_greed: 64,
      },
    },
    as_of: NOW_ISO(),
    is_demo: false,
  }),
  "GET /market-overview/indices/sparklines": () => ({
    spy:  Array.from({ length: 30 }, (_, i) => 535 + Math.sin(i / 4) * 4 + i * 0.05),
    qqq:  Array.from({ length: 30 }, (_, i) => 458 + Math.sin(i / 3.5) * 6 + i * 0.08),
    iwm:  Array.from({ length: 30 }, (_, i) => 215 + Math.sin(i / 5) * 3 - i * 0.02),
    vix:  Array.from({ length: 30 }, (_, i) => 14 + Math.sin(i / 2) * 1.2),
  }),
  // /tickers/context drives the per-symbol envelope the trade page
  // reads for IV rank, expected move, earnings, and the ticker quote
  // freshness chip. Returns the envelope shape `mapTickerContext`
  // expects: each section wrapped in `{value, freshness}`.
  // /tickers/{sym}/fundamentals fills the metric ribbon's 52w range +
  // Volume / ADV + IV cells and TradeHeader's market cap / beta / P/E
  // row. Returns the snake_case wire shape `mapTickerFundamentals`
  // expects.
  "GET /tickers/:symbol/fundamentals": (_, { symbol }) => {
    const sym = symbol.toUpperCase();
    const last = SEED_PRICES[sym] ?? 100;
    return {
      symbol: sym,
      name: sym === "NVDA" ? "Nvidia" : sym === "AAPL" ? "Apple" : sym === "MSFT" ? "Microsoft" : sym,
      sector: "Information technology",
      industry: "Semiconductors",
      market_cap: 3_286_000_000_000,
      shares_outstanding: 24_400_000_000,
      pe_ratio: 34.8,
      eps_ttm: 3.87,
      dividend_yield: 0.0,
      beta: 1.18,
      fifty_two_week_high: +(last * 1.22).toFixed(2),
      fifty_two_week_low: +(last * 0.72).toFixed(2),
      avg_volume_30d: 31_000_000,
      description: null,
      fetched_at: NOW_ISO(),
      is_demo: false,
    };
  },
  "GET /tickers/context": (req) => {
    const url = new URL(req.url);
    const symbols = (url.searchParams.get("symbols") || "")
      .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const freshness = {
      observed_at: NOW_ISO(),
      as_of: NOW_ISO(),
      source_updated_at: NOW_ISO(),
      expires_at: null,
      stale_after_seconds: 60,
      quality: "fresh" as const,
      source: "mock",
      schema_version: 1,
      is_demo: false,
    };
    const out: Record<string, unknown> = {};
    for (const sym of symbols) {
      const seed = SEED_PRICES[sym] ?? 100;
      const ivPct = 30 + ((sym.length * 7) % 25); // deterministic 30–55%
      const ivRank = 35 + ((sym.length * 11) % 50); // deterministic 35–84
      const hv30 = ivPct - 6;
      out[sym] = {
        symbol: sym,
        quote: { value: { ...quoteFor(sym), name: sym }, freshness },
        options_summary: {
          value: {
            current_iv: ivPct / 100,
            iv_rank: ivRank / 100,
            iv_percentile: (ivRank + 5) / 100,
            historical_vol_30d: hv30,
            expected_move: +(seed * 0.025).toFixed(2),
            expected_move_pct: 2.5,
            put_call_skew: 1.18,
            // 2026-05-12 (Trade Intel Panel): vol-surface fields the
            // /trade intel grid renders below the chart. Front/back IV
            // come from the term structure (30d ATM vs 60d ATM); skew
            // is the 25-delta put/call risk reversal (positive = put
            // skew rich). Numbers are deterministic per-symbol so QA
            // snapshots stay stable.
            atm_iv_front: ivPct / 100,
            atm_iv_back:  (ivPct - 1.4) / 100,
            atm_term_sigma: +((Math.sin(sym.length) * 1.6).toFixed(2)),
            put_call_skew_25d_pp: +((Math.sin(sym.length * 1.7) * 4 + 2.1).toFixed(1)),
            iv_history_30d_avg: (ivPct + 4) / 100,
            // Microstructure (Tier 3 / execution data per the trading-IA
            // doc): volume profile, anchored VWAP, cumulative delta,
            // large-print detection. Production wires these from the
            // intraday tape; the mock derives stable values per symbol.
            poc:  +(seed * 0.998).toFixed(2),
            vah:  +(seed * 1.006).toFixed(2),
            val:  +(seed * 0.988).toFixed(2),
            anchored_vwap_prior_close: +(seed * 1.001).toFixed(2),
            cum_delta_today: Math.round(((sym.length * 137) % 9_000_000) - 4_500_000),
            large_print_count_today: 18 + (sym.length % 9),
            large_print_notional_today: 4_120_500 + (sym.length * 84_000),
            relative_volume_today: +((0.6 + ((sym.length * 13) % 70) / 100).toFixed(2)),
            adv_20d: 31_000_000,
          },
          freshness,
        },
        earnings: {
          value: {
            next_earnings_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
            days_until: 14,
            historical_post_move_pct: 4.2,
            implied_move_pct: 5.1,
          },
          freshness,
        },
        warnings: [],
      };
    }
    return { symbols: out, generated_at: NOW_ISO() };
  },
  // Options chain: keeps the Options tab from rendering "API 404: Not
  // Found" in the chain table. Builds a deterministic 7-strike grid
  // around the seeded spot, with plausible bid/ask, iv, oi, and
  // greeks values that the FE mapper (api.ts getOptionsChain) can
  // pass through unchanged.
  "GET /options/chain/:symbol": (req, { symbol }) => {
    const sym = symbol.toUpperCase();
    const spot = SEED_PRICES[sym] ?? 100;
    const url = new URL(req.url);
    const requestedExpiry = url.searchParams.get("expiry");
    const today = new Date();
    const expirations = [14, 42, 70, 105].map((days) =>
      new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10),
    );
    const expiry = requestedExpiry || expirations[0];
    const daysToExp = Math.max(1, Math.round((new Date(expiry).getTime() - today.getTime()) / 86_400_000));
    const tenor = Math.sqrt(daysToExp / 365);
    const strikes = Array.from({ length: 7 }, (_, i) => Math.round((spot - 12 + i * 4) * 100) / 100);
    const contracts: Array<Record<string, unknown>> = [];
    for (const k of strikes) {
      for (const side of ["call", "put"] as const) {
        const inMoney = side === "call" ? spot - k : k - spot;
        const intrinsic = Math.max(0, inMoney);
        const extrinsic = Math.max(0.05, 4.5 * tenor + Math.abs(spot - k) * 0.04 * tenor);
        const mid = +(intrinsic + extrinsic).toFixed(2);
        const halfSpread = Math.max(0.03, mid * 0.012);
        const bid = Math.max(0.01, +(mid - halfSpread).toFixed(2));
        const ask = +(mid + halfSpread).toFixed(2);
        const delta = side === "call"
          ? Math.max(0.02, Math.min(0.98, 0.5 + (spot - k) / (spot * 0.18)))
          : Math.min(-0.02, Math.max(-0.98, -0.5 + (spot - k) / (spot * 0.18)));
        const iv = 0.28 + Math.abs(spot - k) / spot * 0.6 + tenor * 0.05;
        contracts.push({
          symbol: `${sym}${expiry.replace(/-/g, "").slice(2)}${side === "call" ? "C" : "P"}${String(Math.round(k * 1000)).padStart(8, "0")}`,
          underlying: sym,
          option_type: side,
          expiry,
          strike: k,
          bid,
          ask,
          last: mid,
          volume: 80 + Math.round(Math.abs(spot - k) * 12),
          open_interest: 1200 + Math.round(Math.abs(spot - k) * 90),
          iv: +iv.toFixed(4),
          delta: +delta.toFixed(3),
          gamma: +(0.04 / Math.max(0.5, Math.abs(spot - k))).toFixed(4),
          theta: -+(extrinsic / daysToExp).toFixed(4),
          vega: +(spot * 0.01 * tenor).toFixed(4),
        });
      }
    }
    return {
      underlying: sym,
      spot_price: spot,
      expirations,
      contracts,
      fetched_at: NOW_ISO(),
      is_demo: false,
      total_call_volume: contracts.filter(c => c.option_type === "call").reduce((s, c) => s + (c.volume as number), 0),
      total_put_volume: contracts.filter(c => c.option_type === "put").reduce((s, c) => s + (c.volume as number), 0),
      call_put_volume_ratio: 1.05,
      total_call_oi: contracts.filter(c => c.option_type === "call").reduce((s, c) => s + (c.open_interest as number), 0),
      total_put_oi: contracts.filter(c => c.option_type === "put").reduce((s, c) => s + (c.open_interest as number), 0),
    };
  },
  "GET /market/quotes/:symbol": (_, { symbol }) => quoteFor(symbol),
  // Some callers still reach for the singular form; alias both so the
  // mock backend doesn't 404 and pollute the DATA UNAVAILABLE banner.
  "GET /market/quote/:symbol": (_, { symbol }) => quoteFor(symbol),
  // Level-2 ladder for the order-book panel. Returns 10 levels per side
  // around the seeded last price; sizes alternate venue+size so the depth
  // bars render with realistic variance. The shape mirrors backend
  // /market/depth/{symbol} (snake_case) so the FE mapper passes through.
  "GET /market/depth/:symbol": (_, { symbol }) => {
    const sym = symbol.toUpperCase();
    const seed = SEED_PRICES[sym] ?? 100;
    const tick = seed >= 100 ? 0.01 : 0.005;
    const venuesBid = ["IEX", "ARCA", "NYSE", "EDGX", "BATS"];
    const venuesAsk = ["NASDAQ", "BATS", "EDGX", "ARCA", "IEX"];
    const bids = Array.from({ length: 10 }, (_, i) => ({
      price: +(seed - tick * (i + 1)).toFixed(2),
      size: 100 + (i * 65 + ((i * 37) % 80)),
      venue: venuesBid[i % venuesBid.length],
    }));
    const asks = Array.from({ length: 10 }, (_, i) => ({
      price: +(seed + tick * (i + 1)).toFixed(2),
      size: 100 + (i * 55 + ((i * 41) % 70)),
      venue: venuesAsk[i % venuesAsk.length],
    }));
    return {
      symbol: sym,
      kind: "level_2" as const,
      provider: "mock-depth",
      bids,
      asks,
      timestamp: NOW_ISO(),
      is_l2: true,
      is_demo: false,
      notes: ["Local mock depth for QA; not routed to a broker."],
    };
  },
  "GET /market/market-status": () => ({
    state: "regular",
    isOpen: true,
    next_close: new Date(Date.now() + 6 * 3600_000).toISOString(),
    next_open: new Date(Date.now() + 18 * 3600_000).toISOString(),
    session_label: "REGULAR",
  }),
  // Synthetic OHLCV bars. Honors the `?limit=` query param so the
  // Trade page's ALL range (~2k weekly bars) actually paints multi-year
  // history instead of getting clamped at 350. Honors `?timeframe=` to
  // size each bar's interval correctly so the date axis isn't squashed.
  // Wire shape mirrors the backend: snake_case `{timestamp, open, high,
  // low, close, volume}` per bar.
  "GET /market/bars/:symbol": (req, { symbol }) => {
    const sym = symbol.toUpperCase();
    const seed = SEED_PRICES[sym] ?? 100;
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 350, 1), 5000);
    const tf = url.searchParams.get("timeframe") || "1h";
    const intervalMs = (() => {
      switch (tf) {
        case "1min": return 60_000;
        case "5min": return 5 * 60_000;
        case "15min": return 15 * 60_000;
        case "1h": return 3600_000;
        case "4h": return 4 * 3600_000;
        case "1d": return 24 * 3600_000;
        case "1w": return 7 * 24 * 3600_000;
        case "1mo": return 30 * 24 * 3600_000;
        default: return 3600_000;
      }
    })();
    const now = Date.now();
    return Array.from({ length: limit }, (_, i) => {
      const ts = now - (limit - 1 - i) * intervalMs;
      const drift = Math.sin(i / 12) * (seed * 0.04);
      const wobble = Math.sin(i / 3) * (seed * 0.008);
      const o = seed + drift;
      const c = o + wobble;
      const h = Math.max(o, c) + Math.abs(wobble) * 0.4;
      const l = Math.min(o, c) - Math.abs(wobble) * 0.4;
      return {
        timestamp: new Date(ts).toISOString(),
        open: +o.toFixed(2),
        high: +h.toFixed(2),
        low: +l.toFixed(2),
        close: +c.toFixed(2),
        volume: 1_200_000 + Math.round(Math.abs(wobble) * 90_000),
      };
    });
  },

  // ─── Strategies index ─────────────────────────────────────────────
  "GET /strategies": () => [
    { id: "momentum-quality", name: "Momentum + Quality", style: "Fundamental", active: true,  positions: 4, investedAmount: 96400, status: "live" },
    { id: "pead",             name: "PEAD",               style: "Fundamental", active: true,  positions: 1, investedAmount: 42100, status: "live" },
    { id: "regime-adaptive",  name: "Regime Adaptive",    style: "Technical",   active: true,  positions: 3, investedAmount: 51200, status: "live" },
    { id: "sector-rotation",  name: "Sector Rotation",    style: "Macro",       active: true,  positions: 4, investedAmount: 38200, status: "live" },
    { id: "ts-momentum",      name: "TS Momentum",        style: "Technical",   active: true,  positions: 2, investedAmount: 18400, status: "live" },
    { id: "rsi-2-reversal",   name: "RSI-2 Reversal",     style: "Technical",   active: true,  positions: 1, investedAmount: 21800, status: "live" },
    { id: "dual-momentum",    name: "Dual Momentum",      style: "Macro",       active: true,  positions: 2, investedAmount: 14200, status: "live" },
    { id: "pairs-trading",    name: "Pairs Trading",      style: "Quant",       active: true,  positions: 2, investedAmount: 14200, status: "live" },
  ],

  // ─── Analytics ────────────────────────────────────────────────────
  "GET /analytics/slippage": () => ({
    avgSlippageBps: 1.84, medianSlippageBps: 1.20, p95SlippageBps: 5.20,
    sampleSize: 0, byStrategy: [],
  }),

  // ─── Morning brief ────────────────────────────────────────────────
  "GET /portfolio/morning-brief": () => ({
    generatedAt: NOW_ISO(),
    bullets: [
      { time: "06:42 ET", text: "Three new pipeline candidates surfaced overnight; Risk gating is GREEN across all books." },
      { time: "07:10 ET", text: "Earnings tonight: NVDA, CRM, ZS — two are in your watchlists." },
      { time: "07:24 ET", text: "Pairs strategy drift is outside the cointegration band — review queued." },
      { time: "08:01 ET", text: "Your weekly memo is queued and ready for review at 09:30 ET." },
    ],
  }),
};

/* ────────────────────────────────────────────────────────────────────────
 *  Dispatch
 * ──────────────────────────────────────────────────────────────────────── */

interface Match { handler: MockHandler; params: Record<string, string>; }

function matchRoute(method: string, pathname: string): Match | null {
  for (const key of Object.keys(HANDLERS)) {
    const [m, route] = key.split(" ", 2);
    if (m !== method) continue;
    const m1 = matchPath(route, pathname);
    if (m1) return { handler: HANDLERS[key], params: m1 };
  }
  return null;
}

function matchPath(route: string, pathname: string): Record<string, string> | null {
  const a = route.split("/").filter(Boolean);
  const b = pathname.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function dispatch(req: Request, pathname: string): Response | null {
  const m = matchRoute(req.method, pathname);
  if (!m) return null;
  let body: unknown;
  try {
    body = m.handler(req, m.params);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-mock-source": "v2-visual" },
  });
}
