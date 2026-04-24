import { env } from "@/env";
import type {
  Quote,
  OHLCVBar,
  OptionsChain,
  Position,
  Order,
  PortfolioSummary,
  PortfolioGreeks,
  Analysis,
  ScreenerResult,
  TimeFrame,
  CalendarResponse,
  EarningsDetail,
  EarningsCalendarFilters,
  ClaudeFullResearch,
} from "@/types";

// ─── Base Fetch ──────────────────────────────────────────────

// Auth tokens are stored in HttpOnly cookies set by the backend on login.
// JavaScript cannot read HttpOnly cookies, so the browser attaches them
// automatically via `credentials: "include"`. There is no `getAccessToken`
// helper — any prior code that tried to read `document.cookie` was a dead
// path that always returned undefined.

/**
 * Default request timeout. Chrome enforces a 6-per-host socket ceiling and
 * the dashboard polls many endpoints in parallel; without a timeout, one
 * hung TCP socket wedges an entire refresh cycle. 15s covers every routine
 * endpoint; callers can pass `{ timeoutMs: 60_000 }` (or similar) for
 * genuinely long-running endpoints such as backtests.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiFetchOptions extends RequestInit {
  /** Override the default 15s request timeout. */
  timeoutMs?: number;
}

/**
 * Error thrown from `apiFetch` on HTTP 429 Too Many Requests. Carries the
 * parsed `Retry-After` header as a number of seconds (integer) when the
 * server supplied one, so callers can surface a precise "try again in {n}s"
 * toast instead of a generic "rate limited" message (persona-r/ P36, P39).
 *
 * `retryAfter` is `null` when the server returned 429 without a
 * `Retry-After` header (some upstreams do this). UI code should fall back
 * to a generic message in that case.
 */
export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfter: number | null;
  readonly path: string;
  constructor(path: string, retryAfter: number | null, message?: string) {
    const suffix = typeof retryAfter === "number" ? ` (retry in ${retryAfter}s)` : "";
    super(message ?? `API 429: Too Many Requests${suffix}`);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.path = path;
  }
}

/**
 * Error thrown from `apiFetch` on any non-2xx / non-429 response. Carries
 * the HTTP status and the parsed `detail` from a FastAPI error body so UI
 * code can surface a precise toast instead of rendering the raw
 * "API 422: Unprocessable Entity – {...}" string from the base Error.
 *
 * The `detail` field is normalised:
 *   · string  → used verbatim
 *   · array   → joined with "; "  (FastAPI validation errors)
 *   · object  → best-effort string extract
 *   · null    → undefined
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;
  readonly path: string;
  readonly body: string;
  constructor(path: string, status: number, body: string, detail?: string) {
    super(detail ?? `API ${status}: ${body || "Request failed"}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.path = path;
    this.body = body;
  }
}

/**
 * Extract a human-readable error message from a FastAPI error body. FastAPI
 * returns a JSON object with a `detail` field that can be:
 *   · a string (most common — raised via HTTPException(detail="..."))
 *   · an array of Pydantic validation errors: `[{ loc, msg, type }, …]`
 *   · a bare object
 *
 * Returns undefined when the body isn't JSON or has no detail — callers
 * fall back to a generic message in that case.
 */
export function parseApiErrorBody(body: string): string | undefined {
  if (!body) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs: string[] = [];
    for (const item of detail) {
      if (typeof item === "string") { msgs.push(item); continue; }
      if (item && typeof item === "object") {
        const msg = (item as { msg?: unknown }).msg;
        const loc = (item as { loc?: unknown }).loc;
        if (typeof msg === "string") {
          const locStr = Array.isArray(loc) ? loc.filter((p) => typeof p === "string" || typeof p === "number").join(".") : "";
          msgs.push(locStr ? `${locStr}: ${msg}` : msg);
        }
      }
    }
    if (msgs.length) return msgs.join("; ");
  }
  if (detail && typeof detail === "object") {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return undefined;
}

/**
 * Parse the Retry-After HTTP header. Per RFC 7231 the value may be either
 * delta-seconds (integer) or an HTTP-date; both are handled. Returns the
 * seconds remaining as a non-negative integer, or null when the header is
 * missing or unparseable.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  // delta-seconds form. Clamp negative values to 0 so a malformed
  // ``Retry-After: -5`` header doesn't schedule a retry at t=now and
  // hammer the server (B-83).
  const asInt = Number(trimmed);
  if (Number.isFinite(asInt)) return Math.max(0, Math.floor(asInt));
  // HTTP-date form — Date.parse returns NaN for bad input
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
  return Math.max(0, diffSec);
}

/**
 * Centralised `is_demo` dispatcher — the backend tags fallback responses
 * with `is_demo: true` (or `source: "demo"`) when the broker/provider is
 * unavailable and it has to serve synthetic data. We raise a DOM custom
 * event so the dashboard chrome can render a "broker unavailable" banner
 * without every caller site having to branch on the flag.
 *
 * Only fires when the flag is explicitly true — we deliberately do NOT
 * infer degraded mode from missing fields, so a live response missing the
 * tag does not flip the UI into DEMO on a whim.
 */
export function maybeDispatchBrokerDegraded(endpoint: string, flag: unknown): void {
  if (typeof window === "undefined") return;
  if (flag !== true) return;
  try {
    window.dispatchEvent(
      new CustomEvent("alphadesk:broker-degraded", {
        detail: { endpoint, timestamp: Date.now() },
      }),
    );
  } catch {
    // event dispatch is best-effort; silent failure is fine
  }
}

async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const base = typeof window !== "undefined"
    ? (env.API_URL || "")
    : (env.API_URL || "http://localhost:8000");
  const url = `${base}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  const { timeoutMs, signal: callerSignal, ...rest } = init ?? {};
  const effectiveTimeout = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_TIMEOUT_MS;

  // Combine the caller's signal (if any) with our timeout signal so either
  // can abort the request. `AbortSignal.any` is the spec-sanctioned combiner
  // as of baseline 2024; all modern browsers ship it.
  let signal: AbortSignal;
  if (effectiveTimeout > 0 && typeof AbortSignal !== "undefined") {
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    if (callerSignal && typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
      signal = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([
        timeoutSignal,
        callerSignal,
      ]);
    } else {
      signal = callerSignal ?? timeoutSignal;
    }
  } else {
    signal = (callerSignal ?? undefined) as AbortSignal;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      credentials: "include",
      signal,
    });
  } catch (err) {
    // AbortError from a timeout should surface as a legible error so the
    // toast system + React Query can decide how to react. Other network
    // failures propagate unchanged.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
          detail: { status: 0, message: `Request timed out after ${effectiveTimeout}ms`, path },
        }));
      }
      throw new Error(`API timeout: ${path} (> ${effectiveTimeout}ms)`);
    }
    throw err;
  }

  if (res.status === 401 && typeof window !== "undefined") {
    if (window.location.pathname !== "/login") {
      // Single-flight guard: a dashboard page typically has 5-10 React
      // Query widgets polling in parallel. On access-token expiry they
      // all 401 at nearly the same instant and every one of them used to
      // race into this branch — POSTing /auth/logout 10x, dispatching 10
      // broadcast events, and assigning window.location.href 10 times.
      // The extra logout POSTs can trip the server's rate-limiter and
      // leave the session in a half-revoked state. We gate the whole
      // teardown behind a module-level flag and run it exactly once.
      if (!sessionExpiredHandled) {
        sessionExpiredHandled = true;
        // persona-10 #5 — UX hint before silent redirect. We stash a flag
        // in sessionStorage so /login can render a "Your session expired"
        // banner. sessionStorage is per-tab, so the banner only appears in
        // the tab whose request actually 401'd; other tabs find out via
        // the cross-tab logout broadcast (see `broadcastLogout` below).
        try {
          sessionStorage.setItem("alphadesk.session_expired", "1");
        } catch {
          // private mode / quota: redirect still happens, just no banner
        }
        // Drop the in-memory + sessionStorage refresh token so the
        // scheduler stops trying to refresh against a dead cookie.
        clearRefreshToken();
        // Ask the backend to revoke the access token and clear its HttpOnly
        // cookies. `await` before navigating so the POST actually completes —
        // a fire-and-forget fetch is cancelled by `window.location.href =`
        // immediately after. We still redirect on logout failure (rate-limit,
        // Redis blip, network blip) so the user doesn't end up stuck on a
        // broken page.
        try {
          await fetch(`${base}/api/v1/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
        } catch {
          // swallow: redirect happens regardless
        }
        // Broadcast to other tabs so they don't keep polling / showing
        // stale state. They will land on /login the same way this tab did.
        try {
          window.dispatchEvent(new CustomEvent("alphadesk:auth-logout"));
        } catch {
          // event dispatch failure is non-fatal
        }
        broadcastLogout();
        window.location.href = "/login";
      }
    }
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 429 Too Many Requests — parse Retry-After so the UI can render a
    // precise "try again in {n}s" toast (persona-r P36, P39). Keep the
    // toast dispatch generic (handled by the dashboard's api-error listener)
    // but include the computed seconds in the detail for richer copy.
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      const msg = typeof retryAfter === "number"
        ? `Rate-limited. Try again in ${retryAfter}s.`
        : "Rate-limited. Please slow down.";
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
          detail: { status: 429, message: msg, path, retryAfter },
        }));
      }
      throw new RateLimitError(path, retryAfter, msg);
    }
    // Try to extract a FastAPI `detail` so the toast carries the precise
    // reason (e.g. "qty must be > 0") rather than "API 422: Unprocessable
    // Entity – {…}". Fall back to the raw status line when no detail.
    const parsedDetail = parseApiErrorBody(body);
    const friendly = parsedDetail ?? `API ${res.status}: ${res.statusText}`;
    // Dispatch error event for toast system to catch
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
        detail: { status: res.status, message: friendly, path },
      }));
    }
    throw new ApiError(path, res.status, body, parsedDetail);
  }

  // 204 No Content (e.g. DELETE /orders/:id) and any other empty-bodied
  // response shouldn't try to parse JSON. `res.json()` throws on empty
  // bodies in all modern browsers, so branch before calling it.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// ─── Strategies ─────────────────────────────────────────────

export function getStrategies() {
  return apiFetch<{ id: string; name: string; status: string; invested_amount: number; invested_amount_precise?: number; total_return_pct: number; win_rate: number; active_positions_count: number; sparkline: number[] }[]>(
    `/api/v1/strategies/`
  );
}

/**
 * A3#3 / Wave 8 — compact catalog payload used by the strategies list page.
 *
 * Backend: ``GET /api/v1/strategies/catalog`` returns one entry per known
 * strategy with just the flags the list page needs to render the
 * "NOT READY FOR LIVE" / "PAPER-ONLY" pills. Much cheaper than fanning out
 * N per-strategy ``/performance`` calls.
 */
export interface StrategyCatalogEntry {
  id: string;
  slug: string;
  name: string;
  live_disabled: boolean;
  paper_only: boolean;
}

export function getStrategyCatalog() {
  return apiFetch<StrategyCatalogEntry[]>(`/api/v1/strategies/catalog`);
}

export function getIndexSparklines() {
  return apiFetch<{ sparklines: Record<string, number[]>; as_of: string }>(
    `/api/v1/market-overview/indices/sparklines`
  );
}

export interface StrategyPerformance {
  name: string;
  description: string;
  status: string;
  invested_amount: number;
  current_value: number;
  /**
   * Live cumulative return since the strategy first traded. Often 0 on freshly
   * activated strategies — prefer `cagr` (OOS backtest) for the hero CAGR cell
   * when `total_return_pct` is 0 and `cagr` is populated.
   */
  total_return_pct: number;
  /**
   * Live annualized return derived from `total_return_pct`. Mirrors the
   * "always zero on fresh strategies" behaviour of `total_return_pct`. Kept for
   * back-compat; `cagr` is the field to prefer when it's non-null.
   */
  annualized_return_pct: number;
  return_dollars: number;
  win_rate: number;
  sharpe_ratio: number;
  /**
   * Max drawdown as a fraction (e.g. 0.0801 → 8.01%). Sign varies across
   * strategies (some backtests emit a negative fraction, others positive);
   * callers must use `Math.abs` before rendering. Null when no backtest ran.
   */
  max_drawdown: number | null;
  active_positions_count: number;
  equity_curve: { date: string; value: number }[];
  last_trade_date: string;
  /**
   * Out-of-sample CAGR from the strategy's backtest, as a fraction
   * (e.g. 0.362 → 36.2%). Null when no backtest is available. Prefer this
   * over `annualized_return_pct` for the hero CAGR cell.
   */
  cagr?: number | null;
  /**
   * Backtest hit rate as a fraction (e.g. 0.7754 → 77.54% of closed trades
   * are wins). Prefer this over frontend-derived hit rate from live trades,
   * which is empty for strategies that haven't traded yet.
   */
  hit_rate?: number | null;
  /**
   * Profit factor from the backtest (gross wins / gross losses). Null when
   * there are no losing trades in the sample or the backtest wasn't run.
   */
  profit_factor?: number | null;
  /**
   * Wave 4 — routing flags surfaced by the backend strategy catalog.
   *
   * `live_disabled` is true when the strategy is on the live-trading
   * denylist (e.g. `orb`). `paper_only` is true when the strategy is
   * implementation-complete but statistically thin (e.g. `kama_breakout`).
   * Both default to false. Renders a NOT-READY FOR LIVE pill on the
   * disclosure banner when either is set. Defaults for back-compat with
   * older backends that don't emit the fields.
   */
  live_disabled?: boolean;
  paper_only?: boolean;
}

export function getStrategyPerformance(strategyId: string) {
  return apiFetch<StrategyPerformance>(`/api/v1/strategies/${strategyId}/performance`);
}

export interface StrategyTrade {
  id: number;
  symbol: string;
  strategy: string | null;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  entry_time: string;
  exit_time: string | null;
  status: string;
  notes: string | null;
  conviction?: number;
  rationale?: string;
  stop_loss?: number | null;
  take_profit?: number | null;
  exit_reason?: string | null;
}

export function getStrategyTrades(strategyId: string, limit = 100) {
  return apiFetch<StrategyTrade[]>(`/api/v1/trades/history?strategy=${strategyId}&limit=${limit}`);
}

export interface ToggleStrategyResponse {
  /** Strategy identifier. Matches `strategies.py:ToggleResponse.id`. */
  id: string;
  name: string;
  /** One of "active" | "paused" | "backtest" (StrategyStatus enum). */
  previous_status: string;
  new_status: string;
}

export function toggleStrategy(strategyId: string) {
  return apiFetch<ToggleStrategyResponse>(`/api/v1/strategies/${strategyId}/toggle`, { method: "POST" });
}

export interface StrategyAnalytics {
  strategy_id: string;
  sector_exposure: { current: Record<string, number> };
  monthly_returns: { year: number; month: number; return_pct: number }[];
  streaks: { current: { type: string; count: number }; best_win: number; worst_loss: number };
  conviction_distribution: { bucket: string; wins: number; losses: number }[];
  hold_time_stats: { avg_win_days: number; avg_loss_days: number; median_hold_days: number };
  correlations: Record<string, number>;
  rolling_beta: { date: string; beta: number }[];
  best_trade: { symbol: string; pnl: number; pnl_pct: number } | null;
  worst_trade: { symbol: string; pnl: number; pnl_pct: number } | null;
}

export function getStrategyAnalytics(strategyId: string) {
  return apiFetch<StrategyAnalytics>(`/api/v1/strategies/${strategyId}/analytics`);
}

export interface StrategyPositionDetail {
  symbol: string;
  shares: number;
  entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  entry_date: string;
  days_held: number;
  conviction: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string | null;
}

export function getStrategyPositions(strategyId: string) {
  return apiFetch<StrategyPositionDetail[]>(`/api/v1/strategies/${strategyId}/positions`);
}

// ─── Market Overview ────────────────────────────────────────

export function getMarketIndices() {
  return apiFetch<{ indices: { symbol: string; name: string; price: number; change: number; change_pct: number }[] }>(
    `/api/v1/market-overview/indices`
  );
}

// ─── Symbol Search ──────────────────────────────────────────

export async function searchSymbols(query: string, limit = 10) {
  const resp = await apiFetch<{ count: number; results: { symbol: string; name: string; type: string; exchange: string; sector: string }[] }>(
    `/api/v1/symbols/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  return resp.results;
}

// ─── Market Data ─────────────────────────────────────────────

export async function getQuote(symbol: string): Promise<Quote> {
  const resp = await apiFetch<Quote & { is_demo?: boolean; source?: string }>(
    `/api/v1/market/quotes/${symbol}`,
  );
  maybeDispatchBrokerDegraded(
    `/api/v1/market/quotes/${symbol}`,
    resp?.is_demo === true || resp?.source === "demo",
  );
  return resp;
}

export async function getBars(symbol: string, timeframe: TimeFrame = "D", limit = 500): Promise<OHLCVBar[]> {
  // Map frontend timeframe codes to backend Timeframe enum values
  const tfMap: Record<string, string> = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1H": "1h", "4H": "4h",
    "D": "1d", "W": "1w", "M": "1mo",
  };
  const tf = tfMap[timeframe] || "1d";
  interface BackendBar {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap?: number;
  }
  const raw = await apiFetch<BackendBar[]>(
    `/api/v1/market/bars/${symbol}?timeframe=${tf}&limit=${limit}`
  );
  return raw.map((b) => ({
    time: Math.floor(new Date(b.timestamp).getTime() / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/**
 * Fetch snapshots for multiple symbols.
 *
 * TODO(perf-audit-r3 P0 #4): the backend currently exposes only
 * `/api/v1/market/quotes/{symbol}` (per-symbol), not a batched
 * `/api/v1/market/snapshots?symbols=A,B,C` endpoint. This function therefore
 * fires N parallel requests — with a 10-symbol watchlist the first mount
 * triggers 10 Alpaca calls and ~3–5 s of cold-start latency. When the
 * backend batch endpoint lands (screener.py:_fetch_multi_snapshots is the
 * closest existing implementation), migrate callers to `getSnapshots` below
 * and delete this per-symbol fan-out.
 */
export async function getSnapshot(symbols: string[]): Promise<Record<string, Quote>> {
  const results: Record<string, Quote> = {};
  let sawDemo = false;
  const fetches = symbols.map(async (s) => {
    try {
      const quote = await apiFetch<Quote & { is_demo?: boolean; source?: string }>(
        `/api/v1/market/quotes/${s}`,
      );
      if (quote?.is_demo === true || quote?.source === "demo") sawDemo = true;
      results[s] = quote;
    } catch {
      // skip symbols that fail
    }
  });
  await Promise.all(fetches);
  // One aggregate event for the whole fan-out — firing one per symbol would
  // spam the banner listener on a 10-symbol watchlist.
  if (sawDemo) {
    maybeDispatchBrokerDegraded(`/api/v1/market/quotes (batch)`, true);
  }
  return results;
}

/**
 * Batched snapshot fetch using the backend `/api/v1/market/snapshots` endpoint
 * (perf-audit-r3 P0 #4 — shipped alongside this change).
 *
 * The backend returns `{ [symbol]: Snapshot }` where each `Snapshot` wraps a
 * `quote` plus day/prev/minute bars. Callers of this function expect
 * `Record<string, Quote>`, so we unwrap `.quote` (with a backwards-compat
 * fallback in case an older backend still returns a flat Quote map).
 *
 * On upstream failure we fall back to the N-request fan-out in `getSnapshot`
 * so the watchlist stays populated during partial outages; the caller sees
 * the same shape either way.
 */
export async function getSnapshots(symbols: string[]): Promise<Record<string, Quote>> {
  if (!symbols.length) return {};
  const qs = new URLSearchParams({ symbols: symbols.join(",") }).toString();
  try {
    type BackendSnapshot = { quote?: Quote; is_demo?: boolean; source?: string } & Partial<Quote>;
    const raw = await apiFetch<Record<string, BackendSnapshot>>(
      `/api/v1/market/snapshots?${qs}`,
    );
    const out: Record<string, Quote> = {};
    let sawDemo = false;
    for (const [sym, snap] of Object.entries(raw)) {
      if (snap?.is_demo === true || snap?.source === "demo") sawDemo = true;
      // New `{symbol: Snapshot}` shape — unwrap the nested quote.
      if (snap && typeof snap === "object" && "quote" in snap && snap.quote) {
        out[sym] = snap.quote;
      } else if (snap && typeof snap === "object" && "last" in snap) {
        // Defensive fallback: older backend shape returns flat Quote objects.
        out[sym] = snap as Quote;
      }
    }
    if (sawDemo) {
      maybeDispatchBrokerDegraded(`/api/v1/market/snapshots`, true);
    }
    return out;
  } catch {
    // Any network/5xx error: degrade to per-symbol fan-out rather than
    // handing callers an empty map (the UI would otherwise show a mostly-empty
    // watchlist during a Caddy hiccup).
    return getSnapshot(symbols);
  }
}

// ─── Auth token refresh scheduler (long-session-audit-r4 P0 #1) ─
//
// The backend mints an access_token with an 8-hour TTL
// (backend/core/config.py:82). The only client-side logic for 401 is to
// redirect to /login, which silently kicks out users who leave the tab open
// overnight. `ensureTokenRefreshScheduled()` starts a single module-level
// interval (idempotent: calling it twice is a no-op) that POSTs to
// `/api/v1/auth/refresh` ~1 hour before expiry.
//
// APPROACH C (sessionStorage refresh token — persona-9/10 P0):
//   * The refresh_token cookie is HttpOnly (path=/api/v1/auth). The backend
//     refresh handler requires `{"refresh_token": "…"}` in the request body
//     which JS cannot read from the cookie. Instead, the login response JSON
//     includes the refresh_token — we capture it here via
//     `captureRefreshToken(token)` and ALSO mirror it into sessionStorage
//     under "alphadesk.rt".
//   * Why sessionStorage (not module memory, not localStorage):
//       - Module memory loses the token on F5; the user then hits a 401
//         on the next request and gets silently kicked out (persona-9 #2 +
//         persona-10 #2, both P0). The dashboard reload is a normal action,
//         not a session-ending event — losing the token here is a bug.
//       - localStorage survives tab close, which means a stale refresh
//         token can outlive the user's intent. sessionStorage dies when
//         the tab closes, which matches the mental model of "I closed
//         the tab, that's logout."
//       - SECURITY: any XSS-injected script with DOM access can read
//         sessionStorage — same risk as localStorage. An HttpOnly cookie
//         (read server-side on /refresh) would be strictly safer, but the
//         current backend handler reads the token from the JSON body, not
//         the cookie. Making this safer is a backend change tracked
//         separately. sessionStorage is the best practical balance today.
//   * Since LoginForm uses its own `fetch` (not `apiFetch`) we also listen
//     for a DOM event `alphadesk:auth-login-success` with the token in the
//     detail payload so the capture happens even if the login caller never
//     imports `captureRefreshToken`.
//   * We refresh at (expiry - 1 hour) so a brief outage has time to retry.
//
// CROSS-TAB LOGOUT (persona-10 #4):
//   When tab A logs out (or 401s), other open tabs need to know so they
//   stop polling and surface the session-expired banner on their next
//   navigation. We use BroadcastChannel when available (modern browsers,
//   ~baseline 2022), fall back to a localStorage `storage` event ping
//   when not. Both paths converge on the same handler: clear the refresh
//   token, set the session_expired flag, and reload — which naturally
//   trips the 401 path because the cookie is gone.

const SESSION_STORAGE_RT_KEY = "alphadesk.rt";
const LOGOUT_BROADCAST_KEY = "alphadesk.logout_broadcast";
const TOKEN_REFRESH_INTERVAL_MS = 7 * 60 * 60 * 1000; // 7 hours (buffer before 8-hr expiry)
let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
// Single-flight guards, consumed from apiFetch.
// * sessionExpiredHandled: on a 401 fan-out (dashboard with N parallel
//   widgets), make sure we POST /auth/logout, broadcast, and hard-redirect
//   exactly once instead of N times.
// * refreshInFlight: coalesce concurrent refreshAccessToken() calls so
//   two scheduler ticks / multi-tab timers sharing one HttpOnly refresh
//   cookie don't race and mint two token pairs where only the second one
//   sticks in the browser (orphaning the first pair's refresh token).
let sessionExpiredHandled = false;
let refreshInFlight: Promise<boolean> | null = null;
// Module-local refresh token, mirroring sessionStorage so we don't pay the
// storage round-trip on every tick. Initialised on module load from
// sessionStorage so a page reload doesn't kick a logged-in user out.
let refreshToken: string | null = null;
if (typeof window !== "undefined") {
  try {
    refreshToken = sessionStorage.getItem(SESSION_STORAGE_RT_KEY) || null;
  } catch {
    // private mode / sessionStorage disabled — fall back to memory only
  }
}

/**
 * Read the refresh token. Always cross-checks sessionStorage so a
 * cross-tab login (rare) or cleared storage takes effect immediately.
 * Cheap (one synchronous read), but kept internal — callers should not
 * be exposed to the storage layout.
 */
function readRefreshToken(): string | null {
  if (typeof window === "undefined") return refreshToken;
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_RT_KEY);
    refreshToken = stored && stored.length > 0 ? stored : null;
  } catch {
    // sessionStorage may be unavailable; fall back to module memory
  }
  return refreshToken;
}

/**
 * Capture the refresh token after a successful login. The login flow is
 * deliberately not owned by this module (it lives in LoginForm and uses
 * raw `fetch`), so either the caller imports and calls this directly or it
 * dispatches the `alphadesk:auth-login-success` CustomEvent detailed below.
 *
 * Mirrors the token into sessionStorage so a page reload doesn't lose it
 * (persona-9 #2 + persona-10 #2). Safe to call with `null` to clear.
 */
export function captureRefreshToken(token: string | null): void {
  const value = typeof token === "string" && token.length > 0 ? token : null;
  refreshToken = value;
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      sessionStorage.removeItem(SESSION_STORAGE_RT_KEY);
    } else {
      sessionStorage.setItem(SESSION_STORAGE_RT_KEY, value);
    }
  } catch {
    // private mode / quota: keep the in-memory copy
  }
}

/** Clear the refresh token (called on logout or refresh failure). */
export function clearRefreshToken(): void {
  refreshToken = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_RT_KEY);
    } catch {
      // ignore — module memory is cleared above
    }
  }
  if (tokenRefreshTimer !== null) {
    clearInterval(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
}

// ─── Cross-tab logout broadcast (persona-10 #4) ──────────────
//
// BroadcastChannel is the cleanest API but only ~baseline 2022. We feature-
// detect and fall back to a localStorage `storage` event so the UX still
// works on slightly older Safari / niche browsers. Receivers in either case
// react identically: clear local refresh token, mark session expired, and
// hard-redirect (the cookie is gone server-side, so any new request would
// 401 anyway — the redirect is just so the user doesn't see a broken UI).
const logoutChannel: BroadcastChannel | null =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("alphadesk-auth")
    : null;

function handleCrossTabLogout(): void {
  if (typeof window === "undefined") return;
  // Already on /login? nothing to do — let the user finish signing in.
  if (window.location.pathname === "/login") return;
  try {
    sessionStorage.setItem("alphadesk.session_expired", "1");
  } catch {
    // ignore — banner is best-effort
  }
  // Drop our own copy of the refresh token. The backend has already
  // revoked it server-side via the originating tab's logout call.
  clearRefreshToken();
  // Hard redirect — easiest way to ensure no in-flight queries leak past
  // the auth boundary.
  window.location.href = "/login";
}

function broadcastLogout(): void {
  if (typeof window === "undefined") return;
  if (logoutChannel) {
    try {
      logoutChannel.postMessage({ type: "logout", at: Date.now() });
      return;
    } catch {
      // fall through to localStorage path
    }
  }
  // localStorage fallback — writing a unique value triggers the `storage`
  // event in OTHER tabs (not the originating one, which is exactly what
  // we want — the originator handles its own redirect).
  try {
    localStorage.setItem(LOGOUT_BROADCAST_KEY, String(Date.now()));
  } catch {
    // private mode / quota — cross-tab sync degrades gracefully
  }
}

/**
 * Subscribe once (module init) to the login-success DOM event so the
 * refresh token is captured even when LoginForm does not import this
 * module. The event must carry `{ detail: { refresh_token: string } }`.
 */
if (typeof window !== "undefined") {
  window.addEventListener("alphadesk:auth-login-success", (e: Event) => {
    const detail = (e as CustomEvent<{ refresh_token?: string }>).detail;
    if (detail?.refresh_token) {
      captureRefreshToken(detail.refresh_token);
    }
  });
  // On logout, clear the token + interval. Matches ProfileMenu's /auth/logout
  // POST which clears the server-side session. Also broadcast to peer tabs.
  window.addEventListener("alphadesk:auth-logout", () => {
    clearRefreshToken();
    broadcastLogout();
  });
  // Receive cross-tab logout via BroadcastChannel.
  if (logoutChannel) {
    logoutChannel.onmessage = (event) => {
      const data = event?.data as { type?: string } | undefined;
      if (data?.type === "logout") handleCrossTabLogout();
    };
  }
  // Receive cross-tab logout via localStorage `storage` event (fallback path
  // for browsers without BroadcastChannel + as a belt-and-braces second
  // signal in case the channel drops a message).
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== LOGOUT_BROADCAST_KEY) return;
    if (!e.newValue) return; // ignore deletes
    handleCrossTabLogout();
  });
}

export async function refreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Coalesce concurrent callers onto a single in-flight POST. Without
  // this, two simultaneous refresh requests share the one HttpOnly
  // refresh cookie; the backend revokes + rotates for both in parallel
  // and sends two different Set-Cookie headers. The browser keeps
  // whichever arrived last and the losing refresh token is orphaned —
  // still valid (server-side) but unknown to any client, with a 30-day
  // TTL. Realistic trigger: two tabs each running the 7-hour scheduler
  // that fire within the same millisecond.
  if (refreshInFlight !== null) return refreshInFlight;
  // BUG-044: the backend no longer echoes the refresh token in the login
  // body for browser clients — the HttpOnly ``refresh_token`` cookie
  // (path=/api/v1/auth) is now the authoritative source. We still accept
  // a legacy sessionStorage copy for in-flight sessions that logged in
  // before this change, but new sessions rely solely on the cookie which
  // is automatically attached by ``credentials: "include"`` inside
  // ``apiFetch``. That also shrinks the XSS blast radius: a malicious
  // script can no longer scrape the refresh token out of storage.
  const legacyToken = readRefreshToken();
  const work = (async () => {
    try {
      type RefreshResponse = { access_token?: string; refresh_token?: string };
      const resp = await apiFetch<RefreshResponse>("/api/v1/auth/refresh", {
        method: "POST",
        body: legacyToken
          ? JSON.stringify({ refresh_token: legacyToken })
          : JSON.stringify({}),
        // Don't redirect on 401 — the scheduler manages that UX itself.
      });
      if (resp && typeof resp.refresh_token === "string" && resp.refresh_token.length > 0) {
        // Backend is still in CLI mode (shouldn't happen for browsers post
        // BUG-044, but keep the path alive for completeness).
        captureRefreshToken(resp.refresh_token);
      }
      return true;
    } catch {
      return false;
    }
  })();
  refreshInFlight = work;
  try {
    return await work;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Idempotent scheduler for silent access-token refresh.
 * Starts a single `setInterval` at the module level; subsequent calls are
 * no-ops. Intended to be called once on dashboard mount (e.g. from the
 * WebSocket provider in `providers.tsx`). Safe to call on every render.
 *
 * Guards:
 *   * Skip entirely if no refresh_token has been captured yet (user reloaded
 *     or is not logged in) — the interval is left unstarted so we don't
 *     spam 401 calls to the backend. Re-reads sessionStorage on each call
 *     so a cross-tab login or post-reload init still picks up the token.
 *   * Clear the interval on refresh failure to avoid repeated 401 storms;
 *     the next login (or page reload) rearms it.
 */
export function ensureTokenRefreshScheduled(): void {
  if (typeof window === "undefined") return;
  if (tokenRefreshTimer !== null) return;
  // BUG-044: previously we required a sessionStorage refresh token to arm
  // the scheduler. With the HttpOnly cookie path we no longer see the
  // token from JS — so we arm the scheduler unconditionally and let the
  // backend decide whether the cookie is valid. On a logged-out tab the
  // first tick will 401 and the scheduler unsubscribes.
  tokenRefreshTimer = setInterval(() => {
    refreshAccessToken().then((ok) => {
      if (!ok && tokenRefreshTimer !== null) {
        // Refresh failed — stop the scheduler so we don't keep hitting
        // /auth/refresh with a stale or rejected token. The user will hit
        // the 401 redirect on their next normal request, which is the
        // correct UX.
        clearInterval(tokenRefreshTimer);
        tokenRefreshTimer = null;
        // Round 7 Fix 4 (P128): surface a warning banner *before* the
        // hard-redirect fires on the next 401. The refresh tick runs 1
        // hour before the 8-hour expiry (see TOKEN_REFRESH_INTERVAL_MS)
        // so if refresh fails the user has ~60 minutes of usable session
        // left — plenty of time to save unsaved state if we actually
        // tell them about it. Prior behaviour: silent redirect on the
        // next API call, with no warning, losing whatever was in an
        // unsaved order-ticket / strategy editor.
        if (typeof window !== "undefined") {
          try {
            window.dispatchEvent(
              new CustomEvent("alphadesk:session-refresh-failed", {
                detail: {
                  // Hint for the banner copy — 5 min is the floor we
                  // expect to show; actual remaining time depends on
                  // when refresh was attempted vs. the real expiry
                  // claim inside the JWT (which the frontend can't
                  // read because the cookie is HttpOnly).
                  minutesRemainingHint: 5,
                  timestamp: Date.now(),
                },
              })
            );
          } catch {
            // CustomEvent not supported (extremely old browser) —
            // nothing to do, fall back to silent redirect on next 401.
          }
        }
      }
    }).catch(() => undefined);
  }, TOKEN_REFRESH_INTERVAL_MS);
}

// ─── Screener ────────────────────────────────────────────────

export async function screenStocks(preset?: string, filters?: Record<string, unknown>): Promise<ScreenerResult[]> {
  interface BackendResult {
    symbol: string;
    name: string;
    sector: string | null;
    price: number | null;
    change_pct: number | null;
    composite_score: number;
    metrics: Record<string, number>;
  }
  const resp = await apiFetch<{ count: number; results: BackendResult[]; screened_at: string }>(
    `/api/v1/screener/screen`,
    {
      method: "POST",
      body: JSON.stringify({ strategy: preset, ...filters }),
    },
  );
  return resp.results.map((r) => ({
    symbol: r.symbol,
    price: r.price ?? 0,
    change: 0,
    changePct: r.change_pct ?? 0,
    rsScore: r.metrics?.rs_score ?? 0,
    fScore: r.metrics?.f_score ?? 0,
    ivRank: r.metrics?.iv_rank ?? 0,
    ivPctl: r.metrics?.iv_percentile ?? 0,
    mlScore: r.metrics?.ml_score ?? 0,
    composite: r.composite_score ?? 0,
    sector: r.sector ?? "Unknown",
  }));
}

export function getScreenerPresets() {
  // Backend emits ``PresetResponse[]`` (``id, name, filters, created_at``).
  // ``description`` was a FE-invented field — no handler ever set it. Align
  // the FE type to the real wire shape so callers rendering preset cards do
  // not silently surface ``undefined`` as an em-dash.
  return apiFetch<{ id: number; name: string; filters: unknown[]; created_at: string }[]>(
    `/api/v1/screener/presets`,
  );
}

// ─── Analysis ────────────────────────────────────────────────

export async function analyzeSymbol(symbol: string): Promise<Analysis> {
  interface BackendAnalysis {
    symbol: string;
    composite_score: number;
    recommendation: string;
    agent_results: { agent: string; score: number; summary: string; details: Record<string, unknown> }[];
  }
  const resp = await apiFetch<BackendAnalysis>(`/api/v1/analysis/analyze/${symbol}`, {
    method: "POST",
    body: JSON.stringify({ agents: ["technical", "fundamental", "sentiment", "options"] }),
  });
  const findAgent = (name: string) => resp.agent_results?.find((a) => a.agent === name);
  // Surface the real technical indicators computed by the backend
  // (rsi_14, macd_signal, ema_20, ema_50, trend, volume_*). These are read
  // from the `details` bag of the `technical` agent result — no derivation.
  const techDetails = findAgent("technical")?.details ?? null;
  const pickNumeric = (k: string): number | null => {
    const v = techDetails?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const pickString = <T extends string>(k: string, allowed: readonly T[]): T | null => {
    const v = techDetails?.[k];
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  };
  const technicals = techDetails
    ? {
        rsi_14: pickNumeric("rsi_14"),
        ema_20: pickNumeric("ema_20"),
        ema_50: pickNumeric("ema_50"),
        atr_14: pickNumeric("atr_14"),
        support: pickNumeric("support"),
        resistance: pickNumeric("resistance"),
        trend: pickString("trend", ["bullish", "bearish", "neutral"] as const),
        macd_signal: pickString("macd_signal", ["bullish", "bearish", "neutral"] as const),
        volume_ratio: pickNumeric("volume_ratio"),
        volume_trend: pickString("volume_trend", ["above_average", "below_average", "average"] as const),
      }
    : undefined;
  return {
    symbol: resp.symbol,
    technicalScore: findAgent("technical")?.score ?? 0,
    fundamentalScore: findAgent("fundamental")?.score ?? 0,
    sentimentScore: findAgent("sentiment")?.score ?? 0,
    composite: resp.composite_score ?? 0,
    summary: findAgent("technical")?.summary ?? resp.recommendation ?? "",
    signals: [],
    technicals,
  };
}

export function getAnalysis(symbol: string) {
  return apiFetch<Analysis>(`/api/v1/analysis/analysis/${symbol}`);
}

// ─── Options ─────────────────────────────────────────────────

export async function getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChain> {
  const qs = expiration ? `?expiry=${expiration}` : "";
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/options/chain/${symbol}${qs}`);
  // Backend returns { underlying, contracts: [...], expirations, ... }
  // Frontend expects { symbol, calls: [...], puts: [...], expirations }
  const contracts = (raw.contracts ?? []) as Array<Record<string, unknown>>;
  // Greeks are nullable — pass `null` through when the provider omits them
  // rather than collapsing to 0, which would let hardcoded constants hide.
  const pickGreek = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const calls = contracts
    .filter((c) => c.option_type === "call")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: (c.strike as number) ?? 0,
      type: "call" as const,
      bid: (c.bid as number) ?? 0,
      ask: (c.ask as number) ?? 0,
      last: (c.last as number) ?? 0,
      volume: (c.volume as number) ?? 0,
      oi: (c.open_interest as number) ?? 0,
      iv: (c.iv as number) ?? 0,
      delta: (c.delta as number) ?? 0,
      gamma: pickGreek(c.gamma),
      theta: pickGreek(c.theta),
      vega: pickGreek(c.vega),
    }));
  const puts = contracts
    .filter((c) => c.option_type === "put")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: (c.strike as number) ?? 0,
      type: "put" as const,
      bid: (c.bid as number) ?? 0,
      ask: (c.ask as number) ?? 0,
      last: (c.last as number) ?? 0,
      volume: (c.volume as number) ?? 0,
      oi: (c.open_interest as number) ?? 0,
      iv: (c.iv as number) ?? 0,
      delta: (c.delta as number) ?? 0,
      gamma: pickGreek(c.gamma),
      theta: pickGreek(c.theta),
      vega: pickGreek(c.vega),
    }));
  return {
    symbol: (raw.underlying as string) ?? symbol,
    expirations: (raw.expirations as string[]) ?? [],
    calls,
    puts,
  };
}

export async function getIVData(symbol: string) {
  // Backend returns snake_case: iv_rank, iv_percentile, current_iv
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/options/iv/${symbol}`);
  return {
    ivRank: (raw.iv_rank as number) ?? 0,
    ivPctl: (raw.iv_percentile as number) ?? 0,
    currentIV: (raw.current_iv as number) ?? 0,
    hvRatio: ((raw.current_iv as number) ?? 0) / Math.max((raw.hv_20 as number) ?? 1, 0.01),
  };
}

// ─── Orders & Trading ────────────────────────────────────────

export interface PlaceOrderPayload {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  quantity: number;
  price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
  legs?: { symbol: string; side: "buy" | "sell"; quantity: number; price?: number }[];
}

export interface PlaceOrderOptions {
  /**
   * Caller-supplied Idempotency-Key override.  Use this ONLY when retrying
   * a specific previously-submitted request that the user needs the
   * server to deduplicate — e.g. the UI offers a "retry" button after a
   * network timeout and wants the retry to collapse onto the same
   * server-side response.  A fresh user action (new order click) should
   * omit this and let ``placeOrder`` mint a new uuid so the two orders
   * are recognised as distinct.
   */
  idempotencyKey?: string;
}

export function placeOrder(payload: PlaceOrderPayload, options?: PlaceOrderOptions) {
  // Transform frontend payload to backend CreateOrderRequest format
  const isTrailing = payload.type === "trailing_stop";
  const legs = (payload.legs ?? [{ symbol: payload.symbol, side: payload.side, quantity: payload.quantity, price: payload.price }]).map((leg) => ({
    symbol: leg.symbol,
    side: leg.side,
    qty: leg.quantity,
    order_type: payload.type,
    limit_price: payload.type === "limit" || payload.type === "stop_limit" ? (payload.price ?? leg.price ?? null) : null,
    stop_price: payload.type === "stop" || payload.type === "stop_limit" ? (payload.stop_price ?? leg.price ?? null) :
                isTrailing ? null : null,
    trail_price: isTrailing && payload.trail_price ? payload.trail_price : undefined,
    trail_percent: isTrailing && payload.trail_percent ? payload.trail_percent : undefined,
  }));

  // Wave B / persona-72 P0: every POST /trades/orders MUST carry an
  // Idempotency-Key so a mid-POST network blip that triggers a client
  // retry doesn't submit the same order twice.  The backend caches the
  // response JSON keyed on (Idempotency-Key, username) for 10 minutes
  // and returns the original response verbatim on a retry.
  //
  // Default: mint a fresh uuid per call so two clicks on the place-order
  // button produce two distinct orders (the clicks are distinct user
  // intents).  Caller can opt into deduplication by passing
  // options.idempotencyKey — typically wired from the "retry this order"
  // flow, where the UI remembers the key of the original attempt and
  // replays it.
  //
  // crypto.randomUUID is available in all modern browsers and Node >=
  // 19; we still guard against its absence for exotic test runners.
  const idempKey = options?.idempotencyKey
    ?? (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);

  return apiFetch<Order>(`/api/v1/trades/orders`, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempKey,
    },
    body: JSON.stringify({ legs, time_in_force: "day" }),
  });
}

export function cancelOrder(orderId: string) {
  // Backend returns 204 No Content on success (see backend/api/routes/trades.py:361).
  // apiFetch short-circuits on 204 and resolves to `undefined`; no body to parse.
  return apiFetch<void>(`/api/v1/trades/orders/${orderId}`, {
    method: "DELETE",
  });
}

export async function getOrders(status?: string): Promise<Order[]> {
  const qs = status ? `?status=${status}` : "";
  const raw = await apiFetch<Record<string, unknown>[]>(`/api/v1/trades/orders${qs}`);
  return raw.map((o) => {
    const legs = (o.legs as Array<Record<string, unknown>>) ?? [];
    const firstLeg = legs[0] ?? {};
    return {
      id: (o.id as string) ?? "",
      symbol: (firstLeg.symbol as string) ?? (o.symbol as string) ?? "",
      side: ((firstLeg.side as string) ?? (o.side as string) ?? "buy") as "buy" | "sell",
      type: ((firstLeg.order_type as string) ?? (o.type as string) ?? "market") as Order["type"],
      quantity: (firstLeg.qty as number) ?? (o.quantity as number) ?? 0,
      price: (firstLeg.limit_price as number) ?? (o.price as number) ?? undefined,
      status: ((o.status as string) ?? "pending") as Order["status"],
      legs: legs.map((l) => ({
        symbol: (l.symbol as string) ?? "",
        side: ((l.side as string) ?? "buy") as "buy" | "sell",
        quantity: (l.qty as number) ?? 0,
        price: (l.limit_price as number) ?? undefined,
      })),
      filledAt: (o.filled_at as string) ?? undefined,
      createdAt: (o.submitted_at as string) ?? new Date().toISOString(),
    };
  });
}

// ─── Portfolio ───────────────────────────────────────────────

export async function getPositions(): Promise<Position[]> {
  const raw = await apiFetch<Record<string, unknown>[]>(`/api/v1/trades/positions`);
  return raw.map((p) => ({
    symbol: (p.symbol as string) ?? "",
    quantity: (p.quantity as number) ?? (p.qty as number) ?? 0,
    avgCost: (p.avg_cost as number) ?? (p.avgCost as number) ?? 0,
    currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
    unrealizedPnl: (p.unrealized_pnl as number) ?? (p.unrealizedPnl as number) ?? 0,
    marketValue: (p.market_value as number) ?? (p.marketValue as number) ?? 0,
    side: (p.side as "long" | "short") ?? undefined,
  }));
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  interface BackendSummary {
    equity: number;
    cash: number;
    buying_power: number;
    total_market_value: number;
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
    realized_pnl_today: number;
    // Now emitted by ``backend/api/routes/portfolio.py::PortfolioSummary``
    // (previously computed but never surfaced, which forced this file to
    // fall back to ``realized_pnl_today`` and double-count on positions
    // held across trading days).
    day_pnl?: number;
    positions_count: number;
    is_demo?: boolean;
    source?: string;
  }
  // 2026-04-20 — bumped per-call timeout to 30s (was default 15s). Cold-start
  // on this endpoint can exceed 15s because the backend fans out to the
  // Alpaca account+positions+trade-ledger queries sequentially on the first
  // request, and container restarts empty the in-proc caches. Direct curl
  // settled in <1s after warm-up, so this is a first-hit tail, not a real
  // failure — a longer timeout prevents the dashboard from briefly showing
  // em-dashes for equity/P&L.
  const raw = await apiFetch<BackendSummary>(`/api/v1/portfolio/summary`, {
    timeoutMs: 30_000,
  });
  // Use backend-provided day P&L if available; fall back to realized-only to avoid
  // double-counting accumulated unrealized P&L from positions held across days.
  const rawAny = raw as unknown as Record<string, unknown>;
  const dayPnl = (rawAny.day_pnl as number) ?? (rawAny.profit_loss as number) ?? (raw.realized_pnl_today ?? 0);
  const lastEquity = (raw.equity ?? 0) - dayPnl;
  const dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
  const isDemo = raw.is_demo === true || raw.source === "demo";
  // Fire the global event so the dashboard chrome can surface a
  // broker-unavailable banner. Only when the flag is explicitly true —
  // the UI should not flash DEMO on a live response that happened to
  // omit the field.
  maybeDispatchBrokerDegraded(`/api/v1/portfolio/summary`, isDemo);
  return {
    equity: raw.equity,
    cash: raw.cash,
    buyingPower: raw.buying_power,
    totalMarketValue: raw.total_market_value,
    unrealizedPnl: raw.unrealized_pnl,
    unrealizedPnlPct: raw.unrealized_pnl_pct,
    realizedPnlToday: raw.realized_pnl_today,
    positionsCount: raw.positions_count,
    dayPnl,
    dayPnlPct,
    is_demo: isDemo,
  };
}

export async function getPortfolioGreeks(): Promise<PortfolioGreeks> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/portfolio/greeks`);
  return {
    netDelta: (raw.net_delta as number) ?? 0,
    netGamma: (raw.net_gamma as number) ?? 0,
    netTheta: (raw.net_theta as number) ?? 0,
    netVega: (raw.net_vega as number) ?? 0,
    betaWeightedDelta: (raw.beta_weighted_delta as number) ?? 0,
  };
}

// ─── P&L Calendar ───────────────────────────────────────────

export interface CalendarDay {
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
}

export interface CalendarData {
  month: number;
  year: number;
  days: CalendarDay[];
  monthTotal: number;
  tradingDays: number;
  winningDays: number;
  losingDays: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
}

export async function getPnlCalendar(year?: number, month?: number): Promise<CalendarData> {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;
  const resp = await apiFetch<Record<string, unknown>>(`/api/v1/portfolio/calendar?year=${y}&month=${m}`);
  const days = resp.days as Array<Record<string, unknown>> | undefined;
  return {
    month: resp.month as number,
    year: resp.year as number,
    days: (days || []).map((d) => ({
      date: d.date as string,
      pnl: d.pnl as number,
      trades: d.trades as number,
      winRate: d.win_rate as number,
    })),
    monthTotal: resp.month_total as number,
    tradingDays: resp.trading_days as number,
    winningDays: resp.winning_days as number,
    losingDays: resp.losing_days as number,
    bestDay: resp.best_day as { date: string; pnl: number } | null,
    worstDay: resp.worst_day as { date: string; pnl: number } | null,
  };
}

// ─── Market Regime & Sectors ────────────────────────────────

export function getMarketRegime() {
  return apiFetch<{ regime: { regime: string; label: string; confidence: number; vix_level: number; description: string; indicators: Record<string, unknown> }; as_of: string; is_demo?: boolean }>('/api/v1/market-overview/regime');
}

export function getMarketSectors() {
  return apiFetch<{ sectors: { sector: string; change_pct: number; ytd_pct: number; leader: string; leader_change_pct: number }[]; as_of: string }>('/api/v1/market-overview/sectors');
}

// ─── News ───────────────────────────────────────────────────

export async function getMarketNews() {
  const resp = await apiFetch<{ articles: { title: string; source: string; published_at: string; url: string }[] }>('/api/v1/news/market');
  return resp.articles;
}

// ─── Alerts ────────────────────────────────────────────────

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: "above" | "below";
  triggered: boolean;
  triggered_at: string | null;
  created_at: string;
}

export function getPriceAlerts(symbol?: string): Promise<PriceAlert[]> {
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return apiFetch<PriceAlert[]>(`/api/v1/trades/alerts${qs}`);
}

export function createPriceAlert(symbol: string, price: number, condition: "above" | "below") {
  return apiFetch<PriceAlert>(`/api/v1/trades/alerts`, {
    method: "POST",
    body: JSON.stringify({ symbol, price, condition }),
  });
}

export function deletePriceAlert(alertId: string) {
  return apiFetch<{ ok: boolean }>(`/api/v1/trades/alerts/${alertId}`, {
    method: "DELETE",
  });
}

// ─── Portfolio Performance ──────────────────────────────────

/**
 * Drawdown detail nested under `PerformanceMetrics.drawdown_detail`.
 * Matches `backend/api/routes/portfolio.py:DrawdownInfo`.
 */
export interface DrawdownInfo {
  max_drawdown: number;
  max_drawdown_pct: number;
  peak_date: string | null;
  trough_date: string | null;
}

/**
 * Point on the equity curve. Backend returns `value` (synonym for equity
 * level) plus `cumulative_pnl` (running P&L since the curve's epoch). Both
 * are always set; consumers can pick whichever they need.
 * Matches `_build_performance_from_pnls` in `backend/api/routes/portfolio.py`.
 */
export interface EquityCurvePoint {
  date: string;
  value: number;
  cumulative_pnl: number;
}

/**
 * PerformanceMetrics — exact mirror of `backend/api/routes/portfolio.py:41`.
 * Optional fields use `| null` because the backend emits `None` when there
 * is not enough data to compute (e.g. Sharpe with zero variance).
 */
export interface PerformanceMetrics {
  period: string;
  total_return: number;
  total_return_pct: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
  calmar_ratio: number | null;
  drawdown_detail: DrawdownInfo;
  rolling_sharpe_30d: Array<Record<string, unknown>>;
  daily_returns: Array<Record<string, unknown>>;
  win_rate: number | null;
  profit_factor: number | null;
  avg_win: number | null;
  avg_loss: number | null;
  best_trade: number | null;
  worst_trade: number | null;
  total_trades: number;
  equity_curve: EquityCurvePoint[];
  is_demo: boolean;
}

export function getPortfolioPerformance(period: string = "30d") {
  return apiFetch<PerformanceMetrics>(`/api/v1/portfolio/performance?period=${encodeURIComponent(period)}`);
}

// ─── Morning Brief ────────────────────────────────────────────

export interface MorningBriefMover {
  symbol: string;
  change_pct: number;
  impact: number;
}

export interface MorningBriefData {
  date: string;
  portfolio: {
    equity: number;
    overnight_change: number;
    overnight_change_pct: number;
  };
  top_movers: MorningBriefMover[];
  market: {
    regime: string;
    vix: number;
    vix_change: number;
    spy_change_pct: number;
  };
  catalysts: string[];
  ai_summary: string;
  is_demo?: boolean;
}

export function getMorningBrief() {
  return apiFetch<MorningBriefData>(`/api/v1/portfolio/morning-brief`);
}

// ─── Chat / Agents ───────────────────────────────────────────

export interface ChatResponse {
  conversation_id: string;
  message: string;
  // Backend ``agents.py:ChatResponse.actions_taken`` is
  // ``list[dict[str, Any]]``. The prior ``string[]`` was wishful — any caller
  // dereferencing action entries as strings crashed on the .map call.
  actions_taken: Record<string, unknown>[];
  suggestions: string[];
  timestamp: string;
}

export function chatWithAgent(
  message: string,
  symbol?: string,
  context?: string,
  conversationId?: string,
) {
  // Round 7 Fix 6 (P131): pass back the ``conversation_id`` when continuing
  // a thread so the backend can stitch the new turn onto its cached
  // history (``conversation:{user}:{id}`` in Redis). On the very first
  // turn the caller passes undefined and the backend mints a fresh UUID.
  return apiFetch<ChatResponse>(`/api/v1/agents/chat`, {
    method: "POST",
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      context: { symbol, extra: context },
    }),
  });
}

// ─── Strategy Refinement ───────────────────────────────────

export interface RefinedRule {
  condition: string;
  action: string;
  confidence: "high" | "medium" | "low";
}

export interface StrategyRefinement {
  refined_rules: RefinedRule[];
  improvements: string[];
  risks: string[];
  backtest_params: {
    suggested_timeframe?: string;
    lookback_period?: string;
    position_size?: string;
  };
  summary: string;
  error?: boolean;
  message?: string;
}

export function refineStrategy(strategy: string, rules: string[]) {
  return apiFetch<StrategyRefinement>(`/api/v1/agents/refine-strategy`, {
    method: "POST",
    body: JSON.stringify({ strategy, rules }),
  });
}

// ─── Trade History (for export) ────────────────────────────

export interface TradeHistoryEntry {
  id: number;
  symbol: string;
  strategy: string | null;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  entry_time: string;
  exit_time: string | null;
  status: string;
  notes: string | null;
}

export function getTradeHistory(limit = 1000) {
  return apiFetch<TradeHistoryEntry[]>(`/api/v1/trades/history?limit=${limit}`);
}

// ─── Pipeline ──────────────────────────────────────────────

export interface PipelineStatus {
  running: boolean;
  // Backend (``backend/api/routes/pipeline.py:PipelineStatus``) emits
  // snake_case; the camelCase duplicates here never matched the wire shape
  // and read as ``undefined`` on every caller. The dashboard page already
  // reads ``status.last_run`` / ``status.last_result`` directly.
  last_run: string | null;
  last_result: string | null;
  stage?: string | null;
  progress?: Record<string, number> | null;
  started_at?: string | null;
  run_id?: string | null;
  current_strategy?: string | null;
}

export interface PipelineScreenedStock {
  symbol: string;
  name: string;
  price: number;
  compositeScore: number;
  sector: string;
  changePct: number;
}

export interface PipelineAnalysis {
  symbol: string;
  signal: string;
  conviction: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rationale: string;
}

export interface PipelineOrder {
  symbol: string;
  side: string;
  qty: number;
  price: number;
  orderId: string;
  status: string;
  timestamp: string;
}

export interface PipelineRun {
  date: string;
  timestamp: string;
  screened: PipelineScreenedStock[];
  analyzed: PipelineAnalysis[];
  signals: any[];
  ordersPlaced: PipelineOrder[];
  ordersClosed: PipelineOrder[];
  portfolioSnapshot: { equity: number; cash: number; positions: number };
  errors: string[];
  /** Raw per-strategy breakdown from the pipeline log */
  strategies?: Record<string, any>;
  /** Master agent decisions/rejections */
  master_agent?: Record<string, any>;
  /**
   * Numeric counts surfaced when the backend returns aggregate totals
   * without per-row detail. The UI renders these in an editorial empty
   * state rather than synthesizing `stock-0`/`${stratName}-${i}` rows.
   */
  counts?: { screened: number; analyzed: number };
}

export interface PipelinePosition {
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number | null;
  takeProfit: number | null;
  entryDate: string;
  signal: string;
  rationale: string;
}

export function getPipelineStatus() {
  return apiFetch<PipelineStatus>('/api/v1/pipeline/status');
}

/**
 * Kick off a pipeline run.
 *
 * Persona-7 #2 P0 (backend): POST /pipeline/run is now ASYNC — it returns
 * 202 Accepted with `{run_id, status: "started"}` and the caller polls
 * GET /pipeline/status until completion. The old synchronous
 * `{ok, result: PipelineRun}` shape the FE previously typed for no
 * longer exists on the wire; any caller still destructuring `result`
 * would have crashed or rendered em-dashes. Lives alongside
 * `pipeline-api.ts::startPipelineRun` which is the newer, idiomatic API.
 */
export async function triggerPipeline(): Promise<{ run_id: string; status: "started" }> {
  return apiFetch<{ run_id: string; status: "started" }>(
    '/api/v1/pipeline/run',
    { method: 'POST' },
  );
}

export async function getPipelineHistory(): Promise<Record<string, any>[]> {
  return apiFetch<Record<string, any>[]>('/api/v1/pipeline/history');
}

export async function getPipelineRun(date: string): Promise<PipelineRun> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/pipeline/history/${date}`);
  return mapPipelineRun(raw);
}

export function mapPipelineRun(raw: Record<string, unknown>): PipelineRun {
  const r = raw as Record<string, any>;

  // Build screened/analyzed arrays — top-level arrays if available, otherwise
  // aggregate from per-strategy data inside r.strategies
  let screened: PipelineScreenedStock[] = [];
  let analyzed: PipelineAnalysis[] = [];

  if (Array.isArray(r.screened) && r.screened.length > 0) {
    screened = r.screened.map((s: any) => ({
      symbol: s.symbol, name: s.name, price: s.price,
      compositeScore: s.composite_score ?? s.compositeScore ?? 0,
      sector: s.sector ?? "", changePct: s.change_pct ?? s.changePct ?? 0,
    }));
  }
  if (Array.isArray(r.analyzed) && r.analyzed.length > 0) {
    analyzed = r.analyzed.map((a: any) => ({
      symbol: a.symbol, signal: a.signal ?? "hold", conviction: a.conviction ?? 0,
      entryPrice: a.entry_price ?? a.entryPrice ?? null,
      stopLoss: a.stop_loss ?? a.stopLoss ?? null,
      takeProfit: a.take_profit ?? a.takeProfit ?? null,
      rationale: a.rationale ?? "",
    }));
  }

  // Aggregate from per-strategy data when top-level arrays are absent.
  // We NEVER synthesize rows to pad a count — if the backend only gave us a
  // number, the UI renders the count in an editorial empty state instead of
  // fake `stock-0` / `${stratName}-${i}` placeholders.
  const strategies = r.strategies ?? {};
  const screenedCounts = typeof strategies === "object"
    ? Object.values(strategies as Record<string, { screened?: number }>)
        .reduce((acc, s) => acc + (typeof s?.screened === "number" ? s.screened : 0), 0)
    : 0;
  const analyzedCounts = typeof strategies === "object"
    ? Object.values(strategies as Record<string, { analyzed?: number }>)
        .reduce((acc, s) => acc + (typeof s?.analyzed === "number" ? s.analyzed : 0), 0)
    : 0;
  if (analyzed.length === 0 && typeof strategies === "object") {
    // Collect analyses from each strategy's analyses array. A numeric-only
    // `analyzed` count does NOT fabricate rows — it survives as part of
    // `counts` below for the UI's empty state to display.
    for (const [stratName, strat] of Object.entries(strategies) as [string, any][]) {
      if (Array.isArray(strat?.analyses)) {
        for (const a of strat.analyses) {
          analyzed.push({
            symbol: a.symbol ?? stratName, signal: a.signal ?? "hold",
            conviction: a.conviction ?? 0,
            entryPrice: a.entry_price ?? a.entryPrice ?? null,
            stopLoss: a.stop_loss ?? a.stopLoss ?? null,
            takeProfit: a.take_profit ?? a.takeProfit ?? null,
            rationale: a.rationale ?? "",
          });
        }
      }
    }
  }

  return {
    date: r.date ?? "",
    timestamp: r.timestamp ?? "",
    screened,
    analyzed,
    signals: r.signals ?? [],
    ordersPlaced: (r.orders_placed ?? r.ordersPlaced ?? []).map((o: any) => ({
      symbol: o.symbol, side: o.side, qty: o.qty ?? 0, price: o.price ?? 0,
      orderId: o.order_id ?? o.orderId ?? "", status: o.status ?? "",
      timestamp: o.timestamp ?? "",
    })),
    ordersClosed: (r.orders_closed ?? r.ordersClosed ?? []).map((o: any) => ({
      symbol: o.symbol, side: o.side, qty: o.qty ?? 0, price: o.price ?? 0,
      orderId: o.order_id ?? o.orderId ?? "", status: o.status ?? "",
      timestamp: o.timestamp ?? "",
    })),
    portfolioSnapshot: {
      equity: r.portfolio_snapshot?.equity ?? r.portfolioSnapshot?.equity ?? 0,
      cash: r.portfolio_snapshot?.cash ?? r.portfolioSnapshot?.cash ?? 0,
      positions: r.portfolio_snapshot?.positions ?? r.portfolioSnapshot?.positions ?? 0,
    },
    errors: r.errors ?? [],
    strategies: typeof strategies === "object" && strategies ? strategies : undefined,
    master_agent: r.master_agent ?? undefined,
    counts: {
      screened: screened.length > 0 ? screened.length : screenedCounts,
      analyzed: analyzed.length > 0 ? analyzed.length : analyzedCounts,
    },
  };
}

export interface PipelinePerformance {
  totalTrades: number;
  openPositions: number;
  totalPnl: number;
  winRate: number;
  avgPnlPct: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
}

/**
 * Fetch the earnings-options-play calendar for the screener.
 * Backend: GET /api/v1/earnings/calendar
 */
export async function getEarningsCalendar(
  filters: EarningsCalendarFilters = {},
): Promise<CalendarResponse> {
  const params = new URLSearchParams();
  if (filters.window) params.set("window", filters.window);
  if (filters.min_iv_rank !== undefined) params.set("min_iv_rank", String(filters.min_iv_rank));
  if (filters.market_cap) params.set("market_cap", filters.market_cap);
  if (filters.bmo_amc) params.set("bmo_amc", filters.bmo_amc);
  if (filters.watchlist_only) params.set("watchlist_only", "true");
  if (filters.sort) params.set("sort", filters.sort);
  const query = params.toString();
  return apiFetch<CalendarResponse>(`/api/v1/earnings/calendar${query ? `?${query}` : ""}`);
}

/**
 * Fetch the detail panel payload for one symbol's earnings.
 * Backend: GET /api/v1/earnings/{symbol}/detail
 */
export async function getEarningsDetail(symbol: string): Promise<EarningsDetail> {
  return apiFetch<EarningsDetail>(`/api/v1/earnings/${encodeURIComponent(symbol)}/detail`);
}

/**
 * Trigger the on-demand Claude Opus full research note.
 * Backend: POST /api/v1/earnings/{symbol}/full-research
 * Rate-limited per user (~30/5min via backend middleware).
 */
export async function postEarningsFullResearch(symbol: string): Promise<ClaudeFullResearch> {
  return apiFetch<ClaudeFullResearch>(
    `/api/v1/earnings/${encodeURIComponent(symbol)}/full-research`,
    { method: "POST", timeoutMs: 60_000 },
  );
}

export async function getPipelinePositions(): Promise<{ positions: PipelinePosition[]; performance: PipelinePerformance }> {
  const resp = await apiFetch<{ open_positions: Record<string, unknown>[]; performance: Record<string, unknown> }>('/api/v1/pipeline/positions');
  const perf = resp.performance ?? {};
  return {
    positions: (resp.open_positions ?? []).map((p: Record<string, unknown>) => ({
      symbol: (p.symbol as string) ?? "",
      shares: (p.shares as number) ?? (p.qty as number) ?? 0,
      entryPrice: (p.entry_price as number) ?? (p.entryPrice as number) ?? 0,
      currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
      pnl: (p.pnl as number) ?? (p.unrealized_pl as number) ?? 0,
      pnlPct: (p.pnl_pct as number) ?? (p.pnlPct as number) ?? 0,
      stopLoss: (p.stop_loss as number) ?? (p.stopLoss as number) ?? null,
      takeProfit: (p.take_profit as number) ?? (p.takeProfit as number) ?? null,
      entryDate: (p.entry_time as string) ?? (p.entry_date as string) ?? (p.entryDate as string) ?? "",
      signal: (p.signal as string) ?? "hold",
      rationale: (p.rationale as string) ?? "",
    })),
    performance: {
      totalTrades: (perf.total_trades as number) ?? 0,
      openPositions: (perf.open_positions as number) ?? 0,
      totalPnl: (perf.total_pnl as number) ?? 0,
      winRate: (perf.win_rate as number) ?? 0,
      avgPnlPct: (perf.avg_pnl_pct as number) ?? 0,
      bestTrade: perf.best_trade ? { symbol: (perf.best_trade as any).symbol, pnl: (perf.best_trade as any).pnl } : null,
      worstTrade: perf.worst_trade ? { symbol: (perf.worst_trade as any).symbol, pnl: (perf.worst_trade as any).pnl } : null,
    },
  };
}
