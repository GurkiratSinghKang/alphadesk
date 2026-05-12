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
  "GET /portfolio/summary": () => ({
    equity: 284_512.41,
    cash: 87_320.10,
    buyingPower: 174_640.20,
    totalMarketValue: 197_192.31,
    unrealizedPnl: 12_840.18,
    unrealizedPnlPct: 6.96,
    realizedPnlToday: -1_840.22,
    positionsCount: 8,
    dayPnl: -1_840.22,
    dayPnlPct: -0.64,
    // is_demo + source intentionally NOT set to "demo" — those flags trigger
    // WsStatusBanner's "LIMITED DATA · broker unavailable" pill, which we
    // don't want polluting snapshots. Mocks are demo by definition; no point
    // signalling that to the chrome.
    lastUpdated: NOW_ISO(),
    source: "alpaca",
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
  "GET /trades/alerts": () => [],
  "GET /trades/history": () => [],

  // ─── Pipeline ─────────────────────────────────────────────────────
  "GET /pipeline/status": () => ({ state: "idle", lastRun: NOW_ISO(), nextRun: null, queueDepth: 0 }),
  "GET /pipeline/positions": () => [],
  "GET /pipeline/history": () => [],
  "GET /pipeline/history/:date": () => ({ date: "", runs: [] }),
  "GET /pipeline/scheduler_state": () => ({ enabled: false, paused: false, nextRunAt: null }),

  // ─── Strategies ────────────────────────────────────────────────────
  "GET /strategies/admin/risk-monitor": () => ({ status: "ok", breaches: [], lastCheckedAt: NOW_ISO() }),

  // ─── Market overview ──────────────────────────────────────────────
  "GET /market-overview/regime": () => ({
    state: "bull · low-vol",
    confidence: 0.72,
    vix: 13.84,
    breadth: 0.58,
    fearGreed: 64,
    asOf: NOW_ISO(),
  }),
  "GET /market-overview/indices/sparklines": () => ({
    spy:  Array.from({ length: 30 }, (_, i) => 535 + Math.sin(i / 4) * 4 + i * 0.05),
    qqq:  Array.from({ length: 30 }, (_, i) => 458 + Math.sin(i / 3.5) * 6 + i * 0.08),
    iwm:  Array.from({ length: 30 }, (_, i) => 215 + Math.sin(i / 5) * 3 - i * 0.02),
    vix:  Array.from({ length: 30 }, (_, i) => 14 + Math.sin(i / 2) * 1.2),
  }),
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
  // Synthetic OHLCV bars — 350 of them — keeps the chart engine happy.
  // Wire shape mirrors the backend response: each bar is a top-level object
  // in the response array with snake_case keys (`timestamp`, `open`, `high`,
  // `low`, `close`, `volume`) so api.ts `getBars` can map without coercing
  // single-letter keys. The previous shape `{t,o,h,l,c,v}` produced NaN
  // timestamps and an empty chart on the trade page.
  "GET /market/bars/:symbol": (_, { symbol }) => {
    const sym = symbol.toUpperCase();
    const seed = SEED_PRICES[sym] ?? 100;
    const now = Date.now();
    return Array.from({ length: 350 }, (_, i) => {
      const ts = now - (349 - i) * 3600_000;
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
