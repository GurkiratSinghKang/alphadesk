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
  "GET /portfolio/performance": () => ({
    period: "30d",
    points: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
      equity: 280_000 + Math.sin(i / 4) * 4_000 + i * 200,
      pnl: Math.sin(i / 4) * 800 + i * 40,
    })),
  }),

  // ─── Trades / orders / positions ──────────────────────────────────
  "GET /trades/halt-status": () => ({ halted: false, scope: "global", reason: null, by: null, at: null }),
  "GET /trades/positions": () => [
    { symbol: "NVDA", side: "long", qty: 250, avgPrice: 128.40, lastPrice: 134.82, unrealizedPnl: 1605, strategyId: "momentum-quality" },
    { symbol: "META", side: "long", qty: 80, avgPrice: 502.10, lastPrice: 518.04, unrealizedPnl: 1275, strategyId: "momentum-quality" },
    { symbol: "MSFT", side: "long", qty: 120, avgPrice: 432.80, lastPrice: 442.15, unrealizedPnl: 1122, strategyId: "regime-adaptive" },
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
