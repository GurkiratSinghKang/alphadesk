import { env } from "@/env";
import { isOccSymbol } from "@/lib/occ";
import { useUIStore } from "@/stores/ui";
import type {
  Quote,
  OHLCVBar,
  MarketDepthCapabilities,
  MarketDepthSnapshot,
  TickerContext,
  TickerContextResponse,
  TickerFactEnvelope,
  TickerFreshnessMeta,
  TickerFundamentals,
  OptionsChain,
  ContractSnapshot,
  RawContractSnapshot,
  Position,
  Order,
  PortfolioSummary,
  PortfolioGreeks,
  Analysis,
  ScreenerResult,
  TimeFrame,
  CalendarResponse,
  CalendarRow,
  EarningsDetail,
  EarningsErrorCode,
  EarningsCalendarFilters,
  EarningsReportTime,
  EarningsTopSetup,
  EarningsVerdict,
  EarningsMetricsBlock,
  EarningsNewsArticle,
  ClaudeStructured,
  ClaudeFullResearch,
  ComparableSetup,
  EarningsBacktestRequest,
  EarningsBacktestResponse,
  EarningsBacktestMetrics,
  EarningsBacktestTrade,
  HistQuarter,
  HistoricalBlock,
  HistoricalStats,
  IVTermPoint,
  SkewBlock,
  LadderRow,
  StrikeLadder,
  ComboFillForecast,
  EarningsSetup,
  EarningsSetupLeg,
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
  /** Caller renders its own error state; do not emit global error toasts. */
  suppressGlobalError?: boolean;
  /** Caller handles 401 locally; do not revoke cookies or redirect. */
  suppressAuthRedirect?: boolean;
}

type DataFetchOptions = Pick<
  ApiFetchOptions,
  "signal" | "suppressAuthRedirect" | "suppressGlobalError" | "timeoutMs"
>;

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
  constructor(path: string, status: number, body: string, detail?: string, message?: string) {
    super(message ?? detail ?? `API ${status}: Request failed`);
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

// BUG-059 + BUG-066/069 partial (audit 2026-05-11, P2-01 / P9-02 /
// F-SCOUT-04): the same admin AVGO position rendered three+ different
// unrealized P&Ls across /dashboard, /analytics, /pipeline inside the
// same minute. Root cause: each page mounts its own data hook and
// fires an independent fetch for `/api/v1/portfolio/summary`,
// `/trades/positions`, `/trades/orders` — the broker returns a fresh
// snapshot each call, so values drift.
//
// Fix: small in-process response cache for a curated allow-list of
// idempotent GETs. Two windows:
//   - in-flight dedup: while a request is in flight, all callers
//     return the same Promise (no extra network roundtrip).
//   - short post-resolve TTL: 5 seconds after resolution, the next
//     caller still gets the cached value. Forces every component
//     mounting within a 5s window to see the SAME numbers, killing
//     the cross-page drift cluster without touching component code.
//
// Conservative scope: only applies to the path allow-list below. Other
// endpoints fall through to `apiFetch` directly. TTL is intentionally
// short (5s) so the next refresh still picks up real broker updates.
const _SHARED_GET_CACHE_TTL_MS = 5_000;
const _SHARED_GET_PATHS = new Set<string>([
  "/api/v1/portfolio/summary",
  "/api/v1/trades/positions",
  "/api/v1/trades/orders",
]);
type _CacheEntry<T> = { value: T; expiresAt: number };
const _inFlightGets = new Map<string, Promise<unknown>>();
const _resolvedGets = new Map<string, _CacheEntry<unknown>>();

async function apiFetchShared<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  // Only dedup/cache pure GETs (no body, no custom method) for the
  // allow-listed paths. Anything else delegates to apiFetch directly.
  const method = (init?.method ?? "GET").toUpperCase();
  const allowlisted = _SHARED_GET_PATHS.has(path);
  if (method !== "GET" || !allowlisted) {
    return apiFetch<T>(path, init);
  }
  const now = Date.now();
  const cached = _resolvedGets.get(path) as _CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const inFlight = _inFlightGets.get(path) as Promise<T> | undefined;
  if (inFlight) {
    return inFlight;
  }
  const p = (async () => {
    try {
      const value = await apiFetch<T>(path, init);
      _resolvedGets.set(path, { value, expiresAt: Date.now() + _SHARED_GET_CACHE_TTL_MS });
      return value;
    } finally {
      _inFlightGets.delete(path);
    }
  })();
  _inFlightGets.set(path, p);
  return p;
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

  const {
    timeoutMs,
    signal: callerSignal,
    suppressGlobalError = false,
    suppressAuthRedirect = false,
    ...rest
  } = init ?? {};
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
      if (typeof window !== "undefined" && !suppressGlobalError) {
        window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
          detail: { status: 0, message: `Request timed out after ${effectiveTimeout}ms`, path },
        }));
      }
      throw new Error(`API timeout: ${path} (> ${effectiveTimeout}ms)`);
    }
    throw err;
  }

  if (res.status === 401 && typeof window !== "undefined" && !suppressAuthRedirect) {
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
        // Cross-user data-leak fix: clear per-user persisted zustand
        // stores so the post-redirect /login render doesn't paint user
        // A's watchlist / unread alerts / preferences. Dynamic import
        // sidesteps the static cycle (api.ts ⇄ stores/market.ts).
        try {
          const { clearPersistedStores } = await import("@/lib/auth/clearPersistedStores");
          clearPersistedStores();
        } catch {
          // chunk load / dynamic import failure: best-effort, redirect
          // still happens. Keeping logout-on-401 functional matters more
          // than achieving a perfect wipe in the rare load-failure case.
        }
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
      if (typeof window !== "undefined" && !suppressGlobalError) {
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
    if (typeof window !== "undefined" && !suppressGlobalError) {
      window.dispatchEvent(new CustomEvent("alphadesk:api-error", {
        detail: { status: res.status, message: friendly, path },
      }));
    }
    throw new ApiError(path, res.status, body, parsedDetail, friendly);
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
  return apiFetch<{ id: string; name: string; description?: string; status: string; invested_amount: number; invested_amount_precise?: number; total_return_pct: number; sharpe_ratio?: number | null; win_rate: number; active_positions_count: number; sparkline: number[]; live_disabled?: boolean; paper_only?: boolean }[]>(
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

// 2026-05-11 (round 12): /api/v1/strategies/leaderboard returns
// strategies ranked by total_return_pct with Sharpe + rank + plus
// best_sharpe / worst_performer convenience ids. Cached 60s on the
// backend; safe to poll.
export interface StrategyLeaderboardEntry {
  id: string;
  name: string;
  return_pct: number;
  sharpe: number;
  rank: number;
}

export interface StrategyLeaderboardResponse {
  leaderboard: StrategyLeaderboardEntry[];
  worst_performer: string | null;
  best_sharpe: string | null;
}

export function getStrategyLeaderboard() {
  return apiFetch<StrategyLeaderboardResponse>(`/api/v1/strategies/leaderboard`);
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

// v2 backend — per-strategy P&L breakdown for the catalog page's
// CUMULATIVE CONTRIBUTION section. Aggregates closed trades into
// today / month-to-date / lifetime buckets per strategy.
export interface StrategyContribution {
  strategy: string;
  today_pnl: number;
  mtd_pnl: number;
  total_pnl: number;
  invested: number;
  closed_count: number;
}

export interface StrategyContributionResponse {
  as_of: string;
  total_today: number;
  total_mtd: number;
  total_lifetime: number;
  contributions: StrategyContribution[];
}

export function getStrategyContribution() {
  return apiFetch<StrategyContributionResponse>(`/api/v1/strategies/contribution`);
}

// v2 backend — Risk dashboard recompute. Frontend's "Recompute" button
// (Risk hero, top-right corner) calls this when an operator wants a
// fresh number after an intraday spike. Body is identical shape to
// GET /api/v1/risk/dashboard.
export interface RiskDashboardResponse {
  portfolio_beta: number | null;
  sharpe_ratio: number;
  sortino_ratio: number;
  current_drawdown_pct: number;
  max_drawdown_pct: number;
  var_95: number | null;
  var_99: number | null;
  total_portfolio_value: number;
  total_invested: number;
  daily_pnl: number;
  weekly_pnl: number;
  monthly_pnl: number;
  position_count: number;
  as_of: string;
  estimated?: boolean;
}

export function getRiskDashboard() {
  return apiFetch<RiskDashboardResponse>(`/api/v1/risk/dashboard`);
}

export function recomputeRiskDashboard() {
  return apiFetch<RiskDashboardResponse>(`/api/v1/risk/recompute`, { method: "POST" });
}

// 2026-05-10 (round 5 backend wiring): the rest of the risk surface.
// The redesigned RiskPage at /risk-dashboard renders only the dashboard
// summary today; with these clients we can populate sector exposure,
// VaR + CVaR, drawdown series, correlation matrix, and crowding.
export interface CorrelationEntry {
  strategy_a: string;
  strategy_b: string;
  correlation: number;
}
export interface CorrelationResponse {
  strategies: string[];
  matrix: number[][];
  pairs: CorrelationEntry[];
}
export function getRiskCorrelation() {
  return apiFetch<CorrelationResponse>(`/api/v1/risk/correlation`);
}

export interface SectorExposure {
  sector: string;
  allocation_pct: number;
  value: number;
  position_count: number;
}
export interface ExposureResponse {
  sector_exposure: SectorExposure[];
  long_exposure_pct: number;
  short_exposure_pct: number;
  net_exposure_pct: number;
  gross_exposure_pct: number;
  cash_pct: number;
}
export function getRiskExposure() {
  return apiFetch<ExposureResponse>(`/api/v1/risk/exposure`);
}

export interface FactorExposure {
  factor: string;
  beta: number;
  contribution_pct: number;
}
export interface VaRResponse {
  var_95_1d: number | null;
  var_99_1d: number | null;
  var_95_10d: number | null;
  var_99_10d: number | null;
  cvar_95_1d: number | null;
  cvar_99_1d: number | null;
  method: string;
  confidence_note: string;
  factor_exposures: FactorExposure[];
  estimated?: boolean;
}
export function getRiskVar() {
  return apiFetch<VaRResponse>(`/api/v1/risk/var`);
}

export interface DrawdownPoint {
  date: string;
  drawdown_pct: number;
  portfolio_value: number;
  peak_value: number;
}
export interface DrawdownResponse {
  current_drawdown_pct: number;
  max_drawdown_pct: number;
  max_drawdown_date: string;
  recovery_days: number | null;
  drawdown_series: DrawdownPoint[];
}
export function getRiskDrawdown() {
  return apiFetch<DrawdownResponse>(`/api/v1/risk/drawdown`);
}

export function getRiskCrowding() {
  return apiFetch<Record<string, unknown>>(`/api/v1/risk/crowding`);
}

// ─── Auth / Security (round 5b backend wiring) ─────────────────────
//
// The Settings → Security tab can wire to these once we wrap them
// in a UI. The auth flow itself (POST /login, /refresh) remains
// owned by LoginForm.tsx.
export function authChangePassword(body: { old_password: string; new_password: string }) {
  return apiFetch<{ success: boolean }>(`/api/v1/auth/change-password`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function authLogoutEverywhere() {
  return apiFetch<{ revoked_count: number }>(`/api/v1/auth/logout-all`, { method: "POST" });
}
export function authStartTotpEnroll() {
  return apiFetch<{ secret: string; otpauth_url: string; qr_data_url?: string }>(`/api/v1/auth/2fa/enroll`, { method: "POST" });
}
export function authVerifyTotpEnroll(body: { code: string }) {
  return apiFetch<{ recovery_codes: string[] }>(`/api/v1/auth/2fa/verify`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function authDisableTotp(body: { code: string }) {
  return apiFetch<{ success: boolean }>(`/api/v1/auth/2fa/disable`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function authSession() {
  return apiFetch<{
    username: string;
    issued_at?: string;
    expires_at?: string;
    totp_enabled?: boolean;
    refresh_token_present?: boolean;
  }>(`/api/v1/auth/session`);
}

export type TradingMode = "paper" | "live";

export interface UserTradingMode {
  mode: TradingMode;
  updated_at?: string | null;
  live_step_up_at?: string | null;
}

export function getUserTradingMode() {
  return apiFetch<UserTradingMode>(`/api/v1/user/trading-mode`);
}

export function commitUserTradingMode(body: { mode: TradingMode; totp_code?: string }) {
  return apiFetch<UserTradingMode>(`/api/v1/user/trading-mode`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── User data export + erase (round 5b) ───────────────────────────
//
// Wires the existing Settings → Danger zone buttons to the real
// /api/v1/user/* endpoints (previously inert). Erase is a 2-step
// flow: GET /erase/preview returns a summary + token, POST /erase
// confirms with the token.
export function getMe() {
  return apiFetch<{
    username: string;
    email?: string | null;
    role?: string;
    created_at?: string;
    last_login_at?: string | null;
    totp_enabled?: boolean;
  }>(`/api/v1/user/me`);
}
export function postUserExport() {
  return apiFetch<{ download_url?: string; export_id?: string; ready?: boolean }>(`/api/v1/user/export`, { method: "POST" });
}
export function previewUserErase() {
  return apiFetch<{
    erase_token: string;
    will_delete: Record<string, number>;
    grace_days?: number;
  }>(`/api/v1/user/erase/preview`);
}
export function confirmUserErase(body: { erase_token: string; confirm_phrase: string }) {
  return apiFetch<{ scheduled_for: string }>(`/api/v1/user/erase`, {
    method: "POST",
    body: JSON.stringify(body),
  });
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

// 2026-05-11 (round 5g): kill-switch clients (getStrategyDisabledEvents
// + emergencyDisableStrategy + reEnableStrategy) already live further
// below in this file (Plan B.5 section). The Strategy Playbook UI now
// consumes them — no new client code needed here. See line ~860.

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

// ── Strategy reverse-lookup by symbol (T11 — symbols-page band) ─────────
//
// Backend: GET /api/v1/strategies/by-symbol/{symbol}. One row per catalogue
// entry; ``current_position`` is populated from the trade ledger when the user
// has an open / partial-fill trade for ``(symbol, strategy)``. MVP scope —
// ``in_universe`` is hardcoded true and ``has_entry_signal`` / ``score`` /
// ``side`` are hardcoded null/false until the per-strategy signal-cache
// integration lands.

interface RawStrategyMatchPosition {
  qty: number;
  entry_price: number;
  unrealized_pnl: number;
}

interface RawStrategyMatch {
  strategy_id: string;
  name: string;
  in_universe: boolean;
  has_entry_signal: boolean;
  current_position: RawStrategyMatchPosition | null;
  score: number | null;
  side: "long" | "short" | null;
  last_evaluated: string;
}

interface RawStrategyMatchesResponse {
  symbol: string;
  matches: RawStrategyMatch[];
  generated_at: string;
}

export async function getStrategiesBySymbol(
  symbol: string,
  options: DataFetchOptions = {},
): Promise<import("@/types").StrategyMatchesResponse> {
  const raw = await apiFetch<RawStrategyMatchesResponse>(
    `/api/v1/strategies/by-symbol/${encodeURIComponent(symbol)}`,
    options,
  );
  return {
    symbol: raw.symbol,
    matches: raw.matches.map((m) => ({
      strategyId: m.strategy_id,
      name: m.name,
      inUniverse: m.in_universe,
      hasEntrySignal: m.has_entry_signal,
      currentPosition: m.current_position
        ? {
            qty: m.current_position.qty,
            entryPrice: m.current_position.entry_price,
            unrealizedPnl: m.current_position.unrealized_pnl,
          }
        : null,
      score: m.score,
      side: m.side,
      lastEvaluated: m.last_evaluated,
    })),
    generatedAt: raw.generated_at,
  };
}

// ── Kill-switch (Plan B.5) ────────────────────────────────────────────────

export interface DisabledEvent {
  id: number;
  strategy: string;
  /** 1 = drawdown, 2 = daily-pnl, 3 = manual */
  layer: 1 | 2 | 3;
  triggered_at: string; // ISO datetime
  reason: string | null;
  manual_actor: string | null;
  peak_nav: number | null;
  current_nav: number | null;
  realized_pnl: number | null;
  alloc_capital: number | null;
  threshold: number | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface EmergencyDisableResponse {
  success: boolean;
  event_id: number | null;
  message: string;
}

export interface ReEnableResponse {
  success: boolean;
  resolved_event_id: number | null;
  message: string;
}

export function getStrategyDisabledEvents(strategyId: string, includeResolved = false) {
  const params = includeResolved ? "?include_resolved=true" : "";
  return apiFetch<DisabledEvent[]>(
    `/api/v1/strategies/${encodeURIComponent(strategyId)}/disabled-events${params}`,
    { suppressGlobalError: true },
  );
}

export function emergencyDisableStrategy(strategyId: string, reason: string) {
  return apiFetch<EmergencyDisableResponse>(
    `/api/v1/strategies/${encodeURIComponent(strategyId)}/emergency-disable`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
}

export function reEnableStrategy(strategyId: string) {
  return apiFetch<ReEnableResponse>(
    `/api/v1/strategies/${encodeURIComponent(strategyId)}/re-enable`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
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

export type TradingAgentsRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface TradingAgentsRunErrorPayload {
  code: string;
  message: string;
}

export interface TradingAgentsRun {
  run_id: string;
  symbol: string;
  trade_date: string;
  status: TradingAgentsRunStatus;
  provider: string;
  deep_model: string;
  quick_model: string;
  analysts: string[];
  research_depth: number;
  progress_message: string | null;
  timeout_s: number;
  summary_lines: string[];
  decision_text: string | null;
  artifact_files: string[];
  error: TradingAgentsRunErrorPayload | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  advisory_disclaimer: string;
}

export interface TradingAgentsRuntimeStatus {
  enabled: boolean;
  ready: boolean;
  script_path: string;
  script_exists: boolean;
  script_runnable: boolean;
  skill_home: string;
  runtime_python_exists: boolean;
  upstream_checkout_exists: boolean;
  installed_ref: string | null;
  bootstrap_required: boolean;
  provider: string;
  provider_env: string | null;
  provider_key_configured: boolean;
  deep_model: string;
  quick_model: string;
  supported_analysts: string[];
  output_language: string;
  timeout_s: number;
  runs_per_hour: number;
  history_limit: number;
  warnings: string[];
}

export interface TradingAgentsRunRequest {
  symbol: string;
  trade_date?: string | null;
  provider?: string | null;
  deep_model?: string | null;
  quick_model?: string | null;
  analysts?: string[] | null;
  research_depth?: number;
  reason?: string | null;
}

export function getTradingAgentsRuntimeStatus() {
  return apiFetch<TradingAgentsRuntimeStatus>(`/api/v1/tradingagents/runtime`);
}

export function startTradingAgentsRun(input: TradingAgentsRunRequest) {
  return apiFetch<TradingAgentsRun>(`/api/v1/tradingagents/runs`, {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

export function getTradingAgentsRuns(limit = 20, options: DataFetchOptions = {}) {
  return apiFetch<TradingAgentsRun[]>(
    `/api/v1/tradingagents/runs?limit=${encodeURIComponent(String(limit))}`,
    options,
  );
}

export function getTradingAgentsRun(runId: string, options: DataFetchOptions = {}) {
  return apiFetch<TradingAgentsRun>(
    `/api/v1/tradingagents/runs/${encodeURIComponent(runId)}`,
    options,
  );
}

// ─── Market Overview ────────────────────────────────────────

export function getMarketIndices() {
  // Round-11 / Y-5 (P3): backend ``IndexData`` declares ``prev_close``
  // (``backend/api/routes/market_overview.py:25``) and ``is_demo`` —
  // the FE used to drop both. ``prev_close`` lets sparkline / hover
  // tooltips render "from $X" without an extra fetch; ``is_demo``
  // lets the indices strip badge demo-mode without re-deriving.
  return apiFetch<{
    indices: {
      symbol: string;
      name: string;
      price: number;
      change: number;
      change_pct: number;
      prev_close?: number;
      is_demo?: boolean;
    }[];
  }>(
    `/api/v1/market-overview/indices`
  );
}

// ─── Symbol Search ──────────────────────────────────────────

export async function searchSymbols(
  query: string,
  limit = 10,
  options: DataFetchOptions = {},
) {
  const resp = await apiFetch<{ count: number; results: { symbol: string; name: string; type: string; exchange: string; sector: string }[] }>(
    `/api/v1/symbols/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    options,
  );
  return resp.results;
}

// ─── Market Data ─────────────────────────────────────────────

function parseTimestampMs(rawTs: unknown): number {
  return typeof rawTs === "number"
    ? rawTs
    : typeof rawTs === "string"
      ? Date.parse(rawTs) || 0
      : 0;
}

function normalizeQuotePayloadTimestamp<T extends Quote>(quote: T): T {
  const rawTs: unknown = (quote as unknown as { timestamp?: unknown })?.timestamp;
  return { ...quote, timestamp: parseTimestampMs(rawTs) };
}

interface RawTickerFreshnessMeta {
  observed_at: string;
  as_of?: string | null;
  source_updated_at?: string | null;
  expires_at?: string | null;
  stale_after_seconds?: number | null;
  quality: TickerFreshnessMeta["quality"];
  source: string;
  schema_version: number;
  is_demo: boolean;
}

interface RawTickerFactEnvelope {
  value: unknown | null;
  freshness: RawTickerFreshnessMeta;
}

interface RawTickerContext {
  symbol: string;
  quote?: RawTickerFactEnvelope | null;
  options_summary?: RawTickerFactEnvelope | null;
  earnings?: RawTickerFactEnvelope | null;
  research?: RawTickerFactEnvelope | null;
  news?: RawTickerFactEnvelope | null;
  market_regime?: RawTickerFactEnvelope | null;
  warnings?: { need: string; code: string; message: string }[];
}

interface RawTickerContextResponse {
  symbols: Record<string, RawTickerContext>;
  generated_at: string;
}

function mapTickerFreshness(raw: RawTickerFreshnessMeta): TickerFreshnessMeta {
  return {
    observedAt: raw.observed_at,
    asOf: raw.as_of ?? null,
    sourceUpdatedAt: raw.source_updated_at ?? null,
    expiresAt: raw.expires_at ?? null,
    staleAfterSeconds: raw.stale_after_seconds ?? null,
    quality: raw.quality,
    source: raw.source,
    schemaVersion: raw.schema_version,
    isDemo: raw.is_demo,
  };
}

function mapTickerEnvelope(raw?: RawTickerFactEnvelope | null): TickerFactEnvelope<Record<string, unknown>> | null {
  if (!raw) return null;
  const value = raw.value && typeof raw.value === "object"
    ? raw.value as Record<string, unknown>
    : raw.value === null
      ? null
      : { value: raw.value };
  return {
    value,
    freshness: mapTickerFreshness(raw.freshness),
  };
}

function mapTickerContext(raw: RawTickerContext): TickerContext {
  return {
    symbol: raw.symbol,
    quote: mapTickerEnvelope(raw.quote),
    optionsSummary: mapTickerEnvelope(raw.options_summary),
    earnings: mapTickerEnvelope(raw.earnings),
    research: mapTickerEnvelope(raw.research),
    news: mapTickerEnvelope(raw.news),
    marketRegime: mapTickerEnvelope(raw.market_regime),
    warnings: raw.warnings ?? [],
  };
}

export interface TickerContextOptions {
  needs?: string[];
  maxAgeSeconds?: number;
  onStale?: "allow" | "refresh" | "reject" | "allow_with_warning";
  signal?: AbortSignal;
  suppressAuthRedirect?: boolean;
  suppressGlobalError?: boolean;
  timeoutMs?: number;
}

export async function getTickerContext(
  symbols: string[],
  options: TickerContextOptions = {},
): Promise<TickerContextResponse> {
  const normalized = symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const params = new URLSearchParams();
  params.set("symbols", Array.from(new Set(normalized)).join(","));
  if (options.needs?.length) params.set("needs", options.needs.join(","));
  if (options.maxAgeSeconds !== undefined) params.set("max_age_seconds", String(options.maxAgeSeconds));
  if (options.onStale) params.set("on_stale", options.onStale);

  const raw = await apiFetch<RawTickerContextResponse>(
    `/api/v1/tickers/context?${params.toString()}`,
    {
      signal: options.signal,
      suppressAuthRedirect: options.suppressAuthRedirect,
      suppressGlobalError: options.suppressGlobalError,
      timeoutMs: options.timeoutMs,
    },
  );
  return {
    symbols: Object.fromEntries(
      Object.entries(raw.symbols ?? {}).map(([symbol, context]) => [symbol, mapTickerContext(context)]),
    ),
    generatedAt: raw.generated_at,
  };
}

interface RawTickerFundamentals {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  pe_ratio: number | null;
  eps_ttm: number | null;
  dividend_yield: number | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  avg_volume_30d: number | null;
  description: string | null;
  fetched_at: string | null;
  is_demo: boolean;
}

function mapTickerFundamentals(raw: RawTickerFundamentals): TickerFundamentals {
  return {
    symbol: raw.symbol,
    name: raw.name,
    sector: raw.sector,
    industry: raw.industry,
    marketCap: raw.market_cap,
    sharesOutstanding: raw.shares_outstanding,
    peRatio: raw.pe_ratio,
    epsTtm: raw.eps_ttm,
    dividendYield: raw.dividend_yield,
    beta: raw.beta,
    fiftyTwoWeekHigh: raw.fifty_two_week_high,
    fiftyTwoWeekLow: raw.fifty_two_week_low,
    avgVolume30d: raw.avg_volume_30d,
    description: raw.description,
    fetchedAt: raw.fetched_at,
    isDemo: raw.is_demo,
  };
}

export async function getTickerFundamentals(
  symbol: string,
  options: DataFetchOptions = {},
): Promise<TickerFundamentals> {
  const raw = await apiFetch<RawTickerFundamentals>(
    `/api/v1/tickers/${encodeURIComponent(symbol)}/fundamentals`,
    options,
  );
  return mapTickerFundamentals(raw);
}

export async function getQuote(symbol: string, options: DataFetchOptions = {}): Promise<Quote> {
  const resp = await apiFetch<Quote & { is_demo?: boolean; source?: string }>(
    `/api/v1/market/quotes/${symbol}`,
    options,
  );
  maybeDispatchBrokerDegraded(
    `/api/v1/market/quotes/${symbol}`,
    resp?.is_demo === true || resp?.source === "demo",
  );
  // Round-11 / Y-2 (P0): backend ``services/market.py:35`` declares
  // ``timestamp: datetime`` which FastAPI serialises as an ISO-8601
  // string ("2026-04-26T17:32:00+00:00"). The FE ``Quote`` type
  // (``types/index.ts:15``) declares it as ``number`` (epoch ms).
  // Any consumer doing ``Date.now() - quote.timestamp`` math gets
  // ``NaN`` and ``formatDistanceToNow(quote.timestamp)`` shows
  // "Invalid Date". Normalise here so every consumer sees a number.
  return normalizeQuotePayloadTimestamp(resp);
}

export interface GetBarsOptions {
  /** ISO YYYY-MM-DD lower bound (inclusive). Maps to backend `start`. */
  start?: string;
  /** ISO YYYY-MM-DD upper bound (inclusive). Maps to backend `end`.
   *  Used to page older bars: pass the timestamp of the earliest
   *  currently-loaded bar to fetch the bars immediately before it. */
  end?: string;
  /** Caller handles auth/data failures locally without a global redirect. */
  suppressAuthRedirect?: boolean;
  /** Caller renders its own failure state; avoid global toasts. */
  suppressGlobalError?: boolean;
  /** Abort in-flight range fetches when React Query cancels them. */
  signal?: AbortSignal;
  /** Override the default request timeout for history pages. */
  timeoutMs?: number;
}

export async function getBars(
  symbol: string,
  timeframe: TimeFrame = "D",
  limit = 500,
  options: GetBarsOptions = {},
): Promise<OHLCVBar[]> {
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
  const params = new URLSearchParams({ timeframe: tf, limit: String(limit) });
  if (options.start) params.set("start", options.start);
  if (options.end) params.set("end", options.end);
  const raw = await apiFetch<BackendBar[]>(
    `/api/v1/market/bars/${symbol}?${params.toString()}`,
    {
      signal: options.signal,
      suppressAuthRedirect: options.suppressAuthRedirect,
      suppressGlobalError: options.suppressGlobalError,
      timeoutMs: options.timeoutMs,
    },
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
 * TODO(perf-audit-r3 P0 #4 / BUG-070): the backend currently exposes
 * only `/api/v1/market/quotes/{symbol}` (per-symbol), not a batched
 * `/api/v1/market/snapshots?symbols=A,B,C` endpoint. This function
 * therefore fires N parallel requests — with a 10-symbol watchlist the
 * first mount triggers 10 Alpaca calls and ~3-5 s of cold-start latency.
 *
 * Audit 2026-05-11 progress: design-v2's `LiveDataProvider` (commit
 * a21a33b2) now reads WS-fed quotes from `useMarketStore` first, so the
 * REST-only callers of `getSnapshot` are limited to the v1 surfaces +
 * the cold-start tail. The full batch-endpoint migration (replace per-
 * symbol with `getSnapshots` below) remains the proper fix and is
 * tracked as a backend follow-up alongside the BUG-070 WS-consume
 * work. `screener.py:_fetch_multi_snapshots` is the closest existing
 * batched implementation; expose it as the public batch endpoint.
 */
export async function getSnapshot(
  symbols: string[],
  options: DataFetchOptions = {},
): Promise<Record<string, Quote>> {
  const results: Record<string, Quote> = {};
  let sawDemo = false;
  const fetches = symbols.map(async (s) => {
    try {
      const quote = await apiFetch<Quote & { is_demo?: boolean; source?: string }>(
        `/api/v1/market/quotes/${s}`,
        options,
      );
      if (quote?.is_demo === true || quote?.source === "demo") sawDemo = true;
      results[s] = normalizeQuotePayloadTimestamp(quote);
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
export async function getSnapshots(
  symbols: string[],
  options: DataFetchOptions = {},
): Promise<Record<string, Quote>> {
  if (!symbols.length) return {};
  if (symbols.some(isOccSymbol)) {
    return getSnapshot(symbols, options);
  }
  const qs = new URLSearchParams({ symbols: symbols.join(",") }).toString();
  try {
    type BackendSnapshot = { quote?: Quote; is_demo?: boolean; source?: string } & Partial<Quote>;
    const raw = await apiFetch<Record<string, BackendSnapshot>>(
      `/api/v1/market/snapshots?${qs}`,
      options,
    );
    const out: Record<string, Quote> = {};
    let sawDemo = false;
    for (const [sym, snap] of Object.entries(raw)) {
      if (snap?.is_demo === true || snap?.source === "demo") sawDemo = true;
      // New `{symbol: Snapshot}` shape — unwrap the nested quote.
      if (snap && typeof snap === "object" && "quote" in snap && snap.quote) {
        out[sym] = normalizeQuotePayloadTimestamp(snap.quote);
      } else if (snap && typeof snap === "object" && "last" in snap) {
        // Defensive fallback: older backend shape returns flat Quote objects.
        out[sym] = normalizeQuotePayloadTimestamp(snap as Quote);
      }
    }
    if (sawDemo) {
      maybeDispatchBrokerDegraded(`/api/v1/market/snapshots`, true);
    }
    return out;
  } catch (err) {
    if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
      return {};
    }
    // Any network/5xx error: degrade to per-symbol fan-out rather than
    // handing callers an empty map (the UI would otherwise show a mostly-empty
    // watchlist during a Caddy hiccup).
    return getSnapshot(symbols, options);
  }
}

interface BackendDepthLevel {
  price?: number;
  size?: number;
  venue?: string | null;
}

interface BackendDepthSnapshot {
  symbol?: string;
  kind?: "top_of_book" | "level_2";
  provider?: string;
  bids?: BackendDepthLevel[];
  asks?: BackendDepthLevel[];
  timestamp?: string | number;
  is_l2?: boolean;
  isL2?: boolean;
  is_demo?: boolean;
  isDemo?: boolean;
  notes?: string[];
}

function normalizeMarketDepth(raw: BackendDepthSnapshot): MarketDepthSnapshot {
  return {
    symbol: String(raw.symbol ?? "").toUpperCase(),
    kind: raw.kind === "level_2" ? "level_2" : "top_of_book",
    provider: raw.provider ?? "unknown",
    bids: (raw.bids ?? []).map((level) => ({
      price: Number(level.price ?? 0),
      size: Number(level.size ?? 0),
      venue: level.venue ?? null,
    })).filter((level) => Number.isFinite(level.price) && level.price > 0),
    asks: (raw.asks ?? []).map((level) => ({
      price: Number(level.price ?? 0),
      size: Number(level.size ?? 0),
      venue: level.venue ?? null,
    })).filter((level) => Number.isFinite(level.price) && level.price > 0),
    timestamp: parseTimestampMs(raw.timestamp),
    isL2: Boolean(raw.is_l2 ?? raw.isL2),
    isDemo: Boolean(raw.is_demo ?? raw.isDemo),
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

export async function getMarketDepth(
  symbol: string,
  levels = 10,
  options: DataFetchOptions = {},
): Promise<MarketDepthSnapshot> {
  const qs = new URLSearchParams({ levels: String(levels) }).toString();
  const raw = await apiFetch<BackendDepthSnapshot>(
    `/api/v1/market/depth/${encodeURIComponent(symbol.toUpperCase())}?${qs}`,
    options,
  );
  maybeDispatchBrokerDegraded(
    `/api/v1/market/depth/${symbol}`,
    raw?.is_demo === true || raw?.isDemo === true,
  );
  return normalizeMarketDepth(raw);
}

interface BackendDepthCapabilities {
  active_kind?: "top_of_book" | "level_2";
  activeKind?: "top_of_book" | "level_2";
  true_l2_available?: boolean;
  trueL2Available?: boolean;
  providers?: MarketDepthCapabilities["providers"];
  notes?: string[];
}

export async function getMarketDepthCapabilities(): Promise<MarketDepthCapabilities> {
  const raw = await apiFetch<BackendDepthCapabilities>("/api/v1/market/depth/capabilities");
  return {
    activeKind: raw.active_kind ?? raw.activeKind ?? "top_of_book",
    trueL2Available: Boolean(raw.true_l2_available ?? raw.trueL2Available),
    providers: Array.isArray(raw.providers) ? raw.providers : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

// ─── Market status (holiday-aware open/closed) ───────────────────
//
// Wraps ``GET /api/v1/market/market-status`` (backend/api/routes/market.py:570).
// The backend proxies Polygon ``/v1/marketstatus/now`` first, falls back to
// Alpaca ``/v2/clock``, and to a demo response only when both providers are
// unreachable. Both upstream sources already honour the NYSE-observed US
// holiday schedule, so a holiday weekday returns ``market: "closed"`` without
// any local calendar logic on our side.
//
// The wire shape (``backend/services/market.py:173``) is:
//
//     {
//       "market": "open" | "closed" | "early_hours" | "late_hours" | …,
//       "server_time": "2026-05-07T14:32:11Z",
//       "exchanges": { "nyse": "open", "nasdaq": "open", … },
//       "is_demo": false
//     }
//
// The backend does NOT currently expose a structured ``is_holiday`` /
// ``holiday_name`` field on this endpoint, so we don't fabricate one in the FE
// type. A holiday on the NYSE simply manifests as ``market: "closed"`` on a
// weekday and is enough to kill the "Market open" lie. If the backend ever
// gains a holiday-name field this type is the right place to extend.
export interface MarketStatusResponse {
  /** True when NYSE regular session is currently open per the upstream provider. */
  isOpen: boolean;
  /** Raw upstream label — "open" / "closed" / "early_hours" / "late_hours" / etc. */
  market: string;
  /** Per-exchange status map (e.g. ``{nyse: "open", nasdaq: "open"}``). */
  exchanges: Record<string, string>;
  /** Server-side timestamp in ISO 8601 UTC. */
  serverTime: string;
  /** True when the response came from the demo fallback (no upstream credentials). */
  isDemo: boolean;
}

interface BackendMarketStatus {
  market?: string;
  server_time?: string;
  serverTime?: string;
  exchanges?: Record<string, string>;
  is_demo?: boolean;
  isDemo?: boolean;
}

/**
 * Fetch the current market status. The returned ``isOpen`` is derived from
 * the upstream provider (Polygon → Alpaca) so it is correct on US holidays
 * unlike the local ``isMarketOpen()`` heuristic.
 */
export async function getMarketStatus(): Promise<MarketStatusResponse> {
  const raw = await apiFetch<BackendMarketStatus>("/api/v1/market/market-status");
  const market = typeof raw?.market === "string" ? raw.market : "unknown";
  const serverTime = typeof raw?.server_time === "string"
    ? raw.server_time
    : typeof raw?.serverTime === "string"
      ? raw.serverTime
      : "";
  return {
    // Polygon and Alpaca both label a closed exchange ``"closed"``; Polygon
    // also emits ``"early_hours"`` / ``"late_hours"`` for extended sessions
    // which we treat as NOT in regular session for trade-gating purposes.
    isOpen: market === "open",
    market,
    exchanges: raw?.exchanges && typeof raw.exchanges === "object" ? raw.exchanges : {},
    serverTime,
    isDemo: Boolean(raw?.is_demo ?? raw?.isDemo),
  };
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
  // Cross-user data-leak fix: clear per-user persisted zustand stores
  // (and their in-memory snapshots) so the post-redirect /login render
  // in this tab doesn't paint the previous user's watchlist /
  // notifications / preferences. Dynamic import sidesteps the static
  // import cycle (api.ts ⇄ stores/market.ts). Fire-and-forget — the
  // hard redirect below tears the page down regardless, but invoking
  // synchronously when the chunk is already cached keeps the wipe
  // applied to the in-memory snapshot before navigation.
  void import("@/lib/auth/clearPersistedStores")
    .then((m) => m.clearPersistedStores())
    .catch(() => {
      // chunk load failure: redirect still happens; the post-load
      // localStorage state is already invalidated by the originating
      // tab's wipe (other tabs share the same storage).
    });
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
        suppressAuthRedirect: true,
        suppressGlobalError: true,
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

type ScreenerFilterOp = "gt" | "gte" | "lt" | "lte" | "eq" | "between" | "in";

interface ScreenerRequestFilter {
  field: string;
  op: ScreenerFilterOp;
  value: number | number[] | string[];
}

type ScreenerFilterInput = object | ScreenerRequestFilter[];

function numericFilter(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeScreenerFilters(filters?: ScreenerFilterInput): ScreenerRequestFilter[] {
  if (!filters) return [];
  if (Array.isArray(filters)) return filters;
  const values = filters as Record<string, unknown>;
  const normalized: ScreenerRequestFilter[] = [];
  const minPrice = numericFilter(values.minPrice);
  const maxPrice = numericFilter(values.maxPrice);
  const minChange = numericFilter(values.minChange);
  const maxChange = numericFilter(values.maxChange);
  const minVolume = numericFilter(values.minVolume);
  const sector = typeof values.sector === "string" ? values.sector.trim() : "";
  const marketCap = typeof values.marketCap === "string" ? values.marketCap.trim() : "";
  const sectorAliases: Record<string, string> = {
    Financials: "Financial Services",
    "Consumer Discretionary": "Consumer Cyclical",
    "Consumer Staples": "Consumer Defensive",
  };

  if (minPrice != null) normalized.push({ field: "price", op: "gte", value: minPrice });
  if (maxPrice != null) normalized.push({ field: "price", op: "lte", value: maxPrice });
  if (minChange != null) normalized.push({ field: "change_pct", op: "gte", value: minChange });
  if (maxChange != null) normalized.push({ field: "change_pct", op: "lte", value: maxChange });
  if (minVolume != null) normalized.push({ field: "volume", op: "gte", value: minVolume });
  if (marketCap === "Mega") normalized.push({ field: "market_cap", op: "gte", value: 200_000_000_000 });
  if (marketCap === "Large") normalized.push({ field: "market_cap", op: "between", value: [10_000_000_000, 200_000_000_000] });
  if (marketCap === "Mid") normalized.push({ field: "market_cap", op: "between", value: [2_000_000_000, 10_000_000_000] });
  if (marketCap === "Small") normalized.push({ field: "market_cap", op: "between", value: [300_000_000, 2_000_000_000] });
  if (marketCap === "Micro") normalized.push({ field: "market_cap", op: "lt", value: 300_000_000 });
  if (sector) normalized.push({ field: "sector", op: "in", value: [sectorAliases[sector] ?? sector] });

  return normalized;
}

export async function screenStocks(preset?: string, filters?: ScreenerFilterInput): Promise<ScreenerResult[]> {
  interface BackendResult {
    symbol: string;
    name: string;
    sector: string | null;
    price: number | null;
    change_pct: number | null;
    volume: number | null;
    composite_score: number;
    metrics: Record<string, number>;
  }
  const resp = await apiFetch<{ count: number; results: BackendResult[]; screened_at: string }>(
    `/api/v1/screener/screen`,
    {
      method: "POST",
      body: JSON.stringify({ strategy: preset, filters: normalizeScreenerFilters(filters) }),
    },
  );
  return resp.results.map((r) => ({
    symbol: r.symbol,
    price: r.price ?? 0,
    // Round-11 / Y-4 — dropped placebo ``change: 0``; backend never
    // emits a $-change field (only ``change_pct``).
    changePct: r.change_pct ?? 0,
    rsScore: r.metrics?.rs_score ?? 0,
    fScore: r.metrics?.f_score ?? 0,
    ivRank: r.metrics?.iv_rank ?? 0,
    ivPctl: r.metrics?.iv_percentile ?? 0,
    mlScore: r.metrics?.ml_score ?? 0,
    composite: r.composite_score ?? 0,
    sector: r.sector ?? "Unknown",
    volume: r.volume ?? 0,
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

// 2026-05-11 (round 5g): backend exposes POST /api/v1/screener/presets
// for saving a screener preset. ``filters`` is the same
// ScreenerFilter[] shape ``POST /screen`` accepts (field/op/value).
// The wire response includes id + created_at so a callsite can render
// the new preset in the picker immediately.
export interface SavedScreenerPreset {
  id: number;
  name: string;
  filters: Array<{ field: string; op: string; value: number | number[] | string[] }>;
  created_at: string;
}

export function saveScreenerPreset(
  name: string,
  filters: Array<{ field: string; op: string; value: number | number[] | string[] }>,
) {
  return apiFetch<SavedScreenerPreset>(`/api/v1/screener/presets`, {
    method: "POST",
    body: JSON.stringify({ name, filters }),
  });
}

export interface RiskMonitorState {
  enabled: boolean;
  message: string;
}

export function getRiskMonitorState() {
  return apiFetch<RiskMonitorState>(`/api/v1/strategies/admin/risk-monitor`);
}

export function setRiskMonitorState(enabled: boolean) {
  return apiFetch<RiskMonitorState>(
    `/api/v1/strategies/admin/risk-monitor?enabled=${encodeURIComponent(String(enabled))}`,
    { method: "POST" },
  );
}

// ─── Analysis ────────────────────────────────────────────────

export async function analyzeSymbol(symbol: string): Promise<Analysis> {
  // Round-11 / Y-9 (P1, regulatory): map ``advisory_disclaimer`` and
  // ``strategy_live_status`` from the backend response so consumers
  // can surface the legally-required caveat alongside the
  // recommendation. The BE emits these on every analyze response.
  interface BackendAnalysis {
    symbol: string;
    composite_score: number;
    recommendation: string;
    agent_results: { agent: string; score: number; summary: string; details: Record<string, unknown> }[];
    advisory_disclaimer?: string;
    strategy_live_status?: "live_disabled" | "paper_only" | null;
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
    // Round-11 / Y-9: surface regulatory caveat + strategy routing
    // status so panels can render them without re-fetching.
    disclaimer: resp.advisory_disclaimer ?? undefined,
    strategyLiveStatus: resp.strategy_live_status ?? null,
  };
}

export function getAnalysis(symbol: string, options: DataFetchOptions = {}) {
  return apiFetch<Analysis>(`/api/v1/analysis/analysis/${symbol}`, options);
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
  const pickNumber = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const pickNullableNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const calls = contracts
    .filter((c) => c.option_type === "call")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: pickNumber(c.strike),
      type: "call" as const,
      bid: pickNumber(c.bid),
      ask: pickNumber(c.ask),
      last: pickNumber(c.last),
      volume: pickNumber(c.volume),
      oi: pickNumber(c.open_interest),
      iv: pickNullableNumber(c.iv),
      delta: pickNullableNumber(c.delta),
      gamma: pickGreek(c.gamma),
      theta: pickGreek(c.theta),
      vega: pickGreek(c.vega),
      // Wave V V1-3: per-contract volume/OI ratio.
      volumeOiRatio: pickNullableNumber(c.volume_oi_ratio),
    }));
  const puts = contracts
    .filter((c) => c.option_type === "put")
    .map((c) => ({
      symbol: (c.symbol as string) ?? "",
      expiry: (c.expiry as string) ?? "",
      strike: pickNumber(c.strike),
      type: "put" as const,
      bid: pickNumber(c.bid),
      ask: pickNumber(c.ask),
      last: pickNumber(c.last),
      volume: pickNumber(c.volume),
      oi: pickNumber(c.open_interest),
      iv: pickNullableNumber(c.iv),
      delta: pickNullableNumber(c.delta),
      gamma: pickGreek(c.gamma),
      theta: pickGreek(c.theta),
      vega: pickGreek(c.vega),
      // Wave V V1-3: per-contract volume/OI ratio.
      volumeOiRatio: pickNullableNumber(c.volume_oi_ratio),
    }));
  // Wave V V1-2: chain-level aggregates. Defaults preserve shape for
  // older fixtures that don't emit the keys.
  const totalCallVolume = pickNumber(raw.total_call_volume);
  const totalPutVolume = pickNumber(raw.total_put_volume);
  const callPutVolumeRatio = pickNullableNumber(raw.call_put_volume_ratio) ?? 1.0;
  const totalCallOi = pickNumber(raw.total_call_oi);
  const totalPutOi = pickNumber(raw.total_put_oi);
  return {
    symbol: (raw.underlying as string) ?? symbol,
    spotPrice: pickNullableNumber(raw.spot_price),
    expirations: (raw.expirations as string[]) ?? [],
    calls,
    puts,
    fetchedAt: (raw.fetched_at as string | null | undefined) ?? null,
    isDemo: raw.is_demo === true,
    totalCallVolume,
    totalPutVolume,
    callPutVolumeRatio,
    totalCallOi,
    totalPutOi,
  };
}

/**
 * Project Maverick (PM-C): per-contract NBBO snapshot fetch. The backend
 * ``GET /api/v1/options/contract-snapshot?symbol=<OCC>`` endpoint returns
 * snake_case (``bid_size``, ``open_interest``, ``is_demo``); this mapper
 * lifts it into the camelCase ``ContractSnapshot`` shape consumed by
 * ``useContractSnapshot`` and ``<ContractNBBO />``.
 *
 * We code defensively: backend may emit nulls for last/IV/exchanges and
 * may omit fields entirely if the provider misbehaves. Sizes coerce to 0,
 * optional fields fall back to ``null`` so the UI shows em-dashes rather
 * than fabricated values.
 */
function mapContractSnapshot(raw: Partial<RawContractSnapshot> & Record<string, unknown>): ContractSnapshot {
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const bid = num(raw.bid);
  const ask = num(raw.ask);
  // Maverick FIX-2.1: when both sides come back 0 or missing, the
  // upstream had no quote — surface as unavailable instead of rendering
  // a fabricated $0/$0 bid/ask pair in green/red.
  const isUnavailable =
    (raw.bid == null && raw.ask == null) || (bid === 0 && ask === 0);
  return {
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
    bid,
    ask,
    bidSize: num(raw.bid_size),
    askSize: num(raw.ask_size),
    bidExchange: strOrNull(raw.bid_exchange),
    askExchange: strOrNull(raw.ask_exchange),
    midpoint: num(raw.midpoint),
    lastPrice: numOrNull(raw.last_price),
    lastTimestamp: strOrNull(raw.last_timestamp),
    volume: num(raw.volume),
    openInterest: num(raw.open_interest),
    impliedVolatility: numOrNull(raw.implied_volatility),
    fetchedAt: typeof raw.fetched_at === "string" ? raw.fetched_at : new Date().toISOString(),
    isDemo: raw.is_demo === true,
    isUnavailable,
    // Wave V V1-3 / V1-4: pass through volume signals.
    volumeOiRatio: numOrNull(raw.volume_oi_ratio),
    liquidityScore: numOrNull(raw.liquidity_score),
  };
}

export async function getContractSnapshot(occSymbol: string): Promise<ContractSnapshot> {
  // Defensive: backend may emit partial bodies on degraded broker; the
  // mapper coerces missing fields. Type the wire as a record so the
  // call site isn't load-bearing on the schema being complete.
  const raw = await apiFetch<Record<string, unknown>>(
    `/api/v1/options/contract-snapshot?symbol=${encodeURIComponent(occSymbol)}`,
  );
  return mapContractSnapshot(raw);
}

export async function getIVData(symbol: string, options: DataFetchOptions = {}) {
  // Backend returns snake_case: iv_rank, iv_percentile, current_iv
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/options/iv/${symbol}`, options);
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const currentIV = numOrNull(raw.current_iv);
  const hv20 = numOrNull(raw.hv_20);
  return {
    ivRank: numOrNull(raw.iv_rank),
    ivPctl: numOrNull(raw.iv_percentile),
    currentIV,
    hvRatio: currentIV != null && hv20 != null ? currentIV / Math.max(hv20, 0.01) : null,
    fetchedAt: (raw.fetched_at as string | null | undefined) ?? null,
    isDemo: raw.is_demo === true,
  };
}

// ─── Orders & Trading ────────────────────────────────────────

export interface PlaceOrderPayload {
  symbol: string;
  side: "buy" | "sell";
  // Round-16 / persona-12 P0: ``trailing_stop`` was in the type union
  // but the backend ``OrderType`` enum (trades.py:152) only accepts
  // market / limit / stop / stop_limit. Every trailing-stop submit
  // 422'd silently. Removed until the backend grows a TRAILING_STOP
  // value and a real broker-side wiring.
  type: "market" | "limit" | "stop" | "stop_limit";
  quantity: number;
  price?: number;
  stop_price?: number;
  time_in_force?: "day" | "gtc" | "ioc" | "fok" | "opg" | "cls";
  extended_hours?: boolean;
  bracket?: { stop_loss: number; take_profit: number };
  legs?: { symbol: string; side: "buy" | "sell"; quantity: number; price?: number }[];
  /** Unix timestamp for the quote snapshot used to price this order. */
  quote_at_fill_ts?: number;
  /**
   * Round-5 F-1 — originating strategy tag. Threaded onto the backend
   * `CreateOrderRequest.strategy` field so the trade ledger and
   * `/reports/strategy-performance` correctly attribute the position.
   */
  strategy?: string;
  /**
   * Round-5 F-14 — combo classification ("strangle" | "iron_condor" |
   * "vertical_spread"). The backend records this on the broker's
   * client_order_id metadata so the risk gate can recognise a
   * defined-risk spread instead of treating each leg as naked.
   */
  combo_type?: string;
  /**
   * Round-5 F-14 — combo correlation ID. Present when multiple legs of
   * the same combo are submitted as separate orders (single-leg fallback
   * for brokers without combo support); allows downstream reconciliation
   * to stitch them back into one combo.
   */
  combo_correlation_id?: string;
  /**
   * Broker-review routing metadata. Order-entry surfaces preview broker
   * and risk checks before submit, then pass the returned review id with
   * the final POST so the request is auditable end-to-end.
   */
  route_intent?: "broker_order_review";
  broker_provider?: OrderBrokerProvider;
  review_id?: string;
  mode?: TradingMode;
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

export type OrderBrokerProvider = BrokerProvider;

export interface OrderPreviewCheck {
  code: string;
  label: string;
  passed: boolean;
  detail?: string | null;
}

export interface OrderPreviewResponse {
  review_id: string | null;
  can_submit: boolean;
  expires_at?: string | null;
  checks: OrderPreviewCheck[];
}

function orderRequestBodyFromPayload(
  payload: PlaceOrderPayload,
  options?: { confirm?: boolean },
): Record<string, unknown> {
  const explicitLegs = payload.legs != null;
  if (explicitLegs && payload.legs && payload.legs.length > 1) {
    const pricedCount = payload.legs.filter((leg) => leg.price != null).length;
    if (pricedCount > 0 && pricedCount < payload.legs.length) {
      throw new Error("Multi-leg option orders need either every leg priced or no leg prices.");
    }
  }
  const legs = (payload.legs ?? [{ symbol: payload.symbol, side: payload.side, quantity: payload.quantity, price: payload.price }]).map((leg) => {
    const symbol = leg.symbol.trim().toUpperCase();
    const limitSource = explicitLegs ? leg.price : (leg.price ?? payload.price);
    const stopSource = explicitLegs ? leg.price : (payload.stop_price ?? leg.price);
    return {
      symbol,
      side: leg.side,
      qty: leg.quantity,
      order_type: payload.type,
      limit_price: payload.type === "limit" || payload.type === "stop_limit" ? (limitSource ?? null) : null,
      stop_price: payload.type === "stop" || payload.type === "stop_limit" ? (stopSource ?? null) : null,
      asset_class: isOccOptionSymbol(symbol) ? "option" : "equity",
    };
  });

  // Round-5 F-1 / F-14 — forward strategy + combo metadata so the
  // backend `CreateOrderRequest.strategy` field is populated and the
  // ledger row carries the originating strategy + combo type. We omit
  // undefined keys to keep existing single-leg equity flows tidy.
  const reqBody: Record<string, unknown> = {
    legs,
    time_in_force: payload.time_in_force ?? "day",
    mode: payload.mode ?? useUIStore.getState().tradingMode,
  };
  if (options?.confirm) reqBody.confirm = true;
  if (payload.strategy) reqBody.strategy = payload.strategy;
  if (payload.combo_type) reqBody.combo_type = payload.combo_type;
  if (payload.combo_correlation_id) reqBody.combo_correlation_id = payload.combo_correlation_id;
  if (payload.extended_hours) reqBody.extended_hours = true;
  if (payload.bracket) reqBody.bracket = payload.bracket;
  if (payload.route_intent) reqBody.route_intent = payload.route_intent;
  if (payload.broker_provider) reqBody.broker_provider = payload.broker_provider;
  if (payload.review_id) reqBody.review_id = payload.review_id;
  const hasOptionLeg = legs.some((leg) => leg.asset_class === "option");
  const requiresFreshQuote = payload.type !== "market" || hasOptionLeg;
  if (payload.quote_at_fill_ts != null) {
    reqBody.quote_at_fill_ts = normalizeQuoteTimestamp(payload.quote_at_fill_ts);
  } else if (requiresFreshQuote && !hasOptionLeg) {
    // Direct UI submissions always include a timestamp so the backend's
    // stale-quote gate runs instead of silently skipping. Callers that own
    // a real quote snapshot should pass it; this fallback preserves older
    // manual equity flows while still enabling server-side drift checks.
    // Option tickets must carry a real chain snapshot timestamp from the
    // source surface; fabricating Date.now() would make a stale option chain
    // look fresh and defeat the backend's fail-closed option gate.
    reqBody.quote_at_fill_ts = Date.now() / 1000;
  }
  return reqBody;
}

export function previewOrder(payload: PlaceOrderPayload): Promise<OrderPreviewResponse> {
  return apiFetch<OrderPreviewResponse>("/api/v1/trades/orders/preview", {
    method: "POST",
    body: JSON.stringify(orderRequestBodyFromPayload(payload)),
  });
}

export function placeOrder(payload: PlaceOrderPayload, options?: PlaceOrderOptions) {
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
    body: JSON.stringify(orderRequestBodyFromPayload(payload, { confirm: true })),
  });
}

function isOccOptionSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{1,6}\d{6}[CP]\d{8}$/.test(symbol);
}

function normalizeQuoteTimestamp(ts: number): number {
  return ts > 1e12 ? ts / 1000 : ts;
}

export function cancelOrder(orderId: string) {
  // Backend returns 204 No Content on success (see backend/api/routes/trades.py:361).
  // apiFetch short-circuits on 204 and resolves to `undefined`; no body to parse.
  return apiFetch<void>(`/api/v1/trades/orders/${orderId}`, {
    method: "DELETE",
  });
}

// Audit Persona F4.2 (2026-05-05): system-level halt-trading controls.
// The dashboard renders a halt-trading button as the primary emergency
// stop — operator clicks it, /halt cancels open orders + flattens
// positions. ``getHaltStatus`` powers the button's "Halt" vs "Resume"
// state and shows the trigger metadata when halted.

export interface HaltStatus {
  halted: boolean;
  halted_by: string | null;
  halted_at: string | null;
  reason: string | null;
}

export async function getHaltStatus(): Promise<HaltStatus> {
  return apiFetch<HaltStatus>(`/api/v1/halt-status`, { suppressGlobalError: true });
}

export async function haltTrading(opts?: { flatten?: boolean; reason?: string }): Promise<{
  halted: boolean;
  message: string;
  flatten?: Record<string, unknown>;
  flatten_indeterminate?: boolean;
  flatten_queued_for_next_open?: boolean;
}> {
  const params = new URLSearchParams();
  if (opts?.flatten !== undefined) params.set("flatten", String(opts.flatten));
  if (opts?.reason) params.set("reason", opts.reason);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/api/v1/halt${qs}`, { method: "POST" });
}

export async function resumeTrading(): Promise<{ halted: boolean; message: string }> {
  return apiFetch(`/api/v1/halt/resume`, { method: "POST" });
}

// 2026-05-11 (round 6): standalone flatten — closes every open
// position at market WITHOUT setting the halt flag. Use when an
// operator wants to de-risk but keep trading enabled. Admin-only.
// Backend audit-logs the call.
export interface FlattenAllSummary {
  flatten_attempts: number;
  flatten_successes: number;
  failures?: Array<{ symbol: string; error: string }>;
  [key: string]: unknown;
}

export async function flattenAllPositions(): Promise<{
  message: string;
  summary: FlattenAllSummary;
}> {
  return apiFetch(`/api/v1/trades/flatten_all`, { method: "POST" });
}

// ─── Strategy alloc-capital (kill-switch Layer 2) ─────────────────
//
// /api/v1/trades/strategy-alloc-capital exposes the per-strategy
// notional cap Layer-2 (daily-PnL ratio) compares realized_today
// against. Returns 4-field resolution: default, env, overlay, and
// effective (resolved value the gate reads).
//
// PATCH is admin-only. Body is a {set: {name: value}, clear: [name]}
// shape — `set` adds/updates overlays, `clear` drops them and falls
// back to env/default.
export interface StrategyAllocCapitalResponse {
  default: number;
  env: Record<string, number>;
  overlay: Record<string, number>;
  effective: Record<string, number>;
}

export interface StrategyAllocCapitalPatchBody {
  set?: Record<string, number>;
  clear?: string[];
}

export function getStrategyAllocCapital() {
  return apiFetch<StrategyAllocCapitalResponse>(`/api/v1/trades/strategy-alloc-capital`);
}

export function patchStrategyAllocCapital(body: StrategyAllocCapitalPatchBody) {
  return apiFetch<{ ok: boolean; overlay: Record<string, number> }>(
    `/api/v1/trades/strategy-alloc-capital`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

// ─── Strategy kill-switch thresholds (Layer 1 + Layer 2) ──────────
//
// Layer 1 = drawdown threshold (default -8%).
// Layer 2 = daily-PnL ratio threshold (default -2%).
// Both are NEGATIVE fractions; positive values are rejected with 422.
//
// Each layer has independent {set, clear} blocks so an admin can
// edit Layer-1 overrides without touching Layer-2.
export interface KillSwitchLayerThresholdSet {
  layer1: Record<string, number>;
  layer2: Record<string, number>;
}

export interface KillSwitchThresholdsResponse {
  default: { layer1: number; layer2: number };
  env: KillSwitchLayerThresholdSet;
  overlay: KillSwitchLayerThresholdSet;
  effective: Record<string, { layer1: number; layer2: number }>;
}

export interface KillSwitchThresholdsPatchBody {
  layer1?: { set?: Record<string, number>; clear?: string[] };
  layer2?: { set?: Record<string, number>; clear?: string[] };
}

export function getKillSwitchThresholds() {
  return apiFetch<KillSwitchThresholdsResponse>(`/api/v1/trades/strategy-kill-switch-thresholds`);
}

export function patchKillSwitchThresholds(body: KillSwitchThresholdsPatchBody) {
  return apiFetch<{ ok: boolean; overlay: KillSwitchLayerThresholdSet }>(
    `/api/v1/trades/strategy-kill-switch-thresholds`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function getOrders(status?: string): Promise<Order[]> {
  const qs = status ? `?status=${status}` : "";
  // BUG-059: only the unqueried form (`/api/v1/trades/orders`) is in
  // the shared cache allow-list. Status-filtered calls go straight to
  // apiFetch so different filters don't collide on the same cache key.
  const raw = status
    ? await apiFetch<Record<string, unknown>[]>(`/api/v1/trades/orders${qs}`)
    : await apiFetchShared<Record<string, unknown>[]>(`/api/v1/trades/orders`);
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
      // Round-5 F-1 / F-13 — surface the originating strategy so the
      // /trade page's recent-orders strip and /reports can render the
      // attribution column. Backend already returns `strategy` on
      // OrderResponse (see backend/api/routes/trades.py:398).
      strategy: (o.strategy as string) ?? null,
      // Round-11 / Y-10 — surface combo_type + reject_reason so
      // multi-leg orders render correctly and rejected orders show
      // why. Backend already emits both.
      comboType: (o.combo_type as string) ?? null,
      rejectReason: (o.reject_reason as string) ?? null,
      filledAt: (o.filled_at as string) ?? undefined,
      createdAt: (o.submitted_at as string) ?? new Date().toISOString(),
    };
  });
}

// ─── Current user profile ─────────────────────────────────────

/**
 * Shape returned by ``GET /api/v1/user/me``. Mirrors the backend's
 * ``user_to_dict`` helper plus the derived ``is_demo_seed`` flag the
 * dashboard reads to drive the "Connect your broker" prompt.
 *
 * Batch E (2026-05-05) — P0-05: when the dashboard sees a demo-seeded
 * account it replaces the Action stack's first card with an explicit
 * "Connect your broker" CTA so brand-new operators can't mistake the
 * demo book for their real one. Iter 19 wired ``is_demo_seed`` through
 * the backend; the field is set on every authenticated profile fetch.
 */
export interface CurrentUserProfile {
  id?: number | null;
  username: string;
  email?: string | null;
  role?: string;
  status?: string;
  display_name?: string | null;
  profile?: Record<string, unknown> | null;
  /**
   * Iter 19 — set by the backend (``services.users.user_to_dict``).
   * True when the row is non-admin AND has no rows in
   * ``broker_connections``. Drives the "Connect your broker" CTA at
   * the top of the dashboard Action stack (audit Batch E P0-05).
   *
   * Typed as required because every authenticated /me response now
   * carries it; legacy payloads without the field will read
   * ``undefined`` and the dashboard's nullish-coalesce fallback to
   * ``false`` is the safe default (no CTA rather than a misfire).
   */
  is_demo_seed?: boolean;
}

export function getCurrentUser(): Promise<CurrentUserProfile> {
  return apiFetch<CurrentUserProfile>("/api/v1/user/me");
}

// ─── User Watchlist (iter 17) ────────────────────────────────
//
// Per-user watchlist persisted server-side (migration 0023). The market
// zustand store keeps an optimistic local copy and reconciles with these
// endpoints; consumers should call into the store rather than these
// wrappers directly. Wire envelope is `{symbols, as_of}` snake-case from
// the backend; the mapper rewrites `as_of` -> `asOf` to match the rest
// of the frontend's camelCase convention.

export interface UserWatchlist {
  symbols: string[];
  /** ISO-8601 timestamp the server stamped on the read. */
  asOf: string;
}

interface RawUserWatchlist {
  symbols: string[];
  as_of: string;
}

function mapUserWatchlist(raw: RawUserWatchlist): UserWatchlist {
  return { symbols: raw.symbols, asOf: raw.as_of };
}

export async function getUserWatchlist(): Promise<UserWatchlist> {
  const raw = await apiFetch<RawUserWatchlist>("/api/v1/user/watchlist");
  return mapUserWatchlist(raw);
}

export async function addToUserWatchlist(symbol: string): Promise<UserWatchlist> {
  const upper = symbol.trim().toUpperCase();
  const raw = await apiFetch<RawUserWatchlist>(
    `/api/v1/user/watchlist/${encodeURIComponent(upper)}`,
    { method: "POST" },
  );
  return mapUserWatchlist(raw);
}

export async function removeFromUserWatchlist(
  symbol: string,
): Promise<UserWatchlist> {
  const upper = symbol.trim().toUpperCase();
  const raw = await apiFetch<RawUserWatchlist>(
    `/api/v1/user/watchlist/${encodeURIComponent(upper)}`,
    { method: "DELETE" },
  );
  return mapUserWatchlist(raw);
}

// ─── Broker Connections & Reconciliation ─────────────────────

export interface BrokerConnection {
  id: number;
  provider: BrokerProvider;
  account_env: "paper" | "live";
  display_name: string | null;
  key_last4: string | null;
  status: string;
  is_default: boolean;
  verified_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  broker_account_id: string | null;
  metadata: Record<string, unknown>;
}

export type BrokerProvider = "alpaca" | "ibkr" | "etrade" | "schwab" | "robinhood";

export interface BrokerProviderInfo {
  provider: BrokerProvider;
  label: string;
  auth_model: string;
  account_envs: Array<"paper" | "live">;
  trading_enabled: boolean;
  reconciliation_enabled: boolean;
  fields: string[];
}

export interface SaveBrokerConnectionPayload {
  provider: BrokerProvider;
  account_env: "paper" | "live";
  display_name?: string | null;
  credentials: Record<string, string>;
}

export interface SaveAlpacaConnectionPayload {
  api_key: string;
  secret_key: string;
  account_env: "paper" | "live";
  display_name?: string | null;
}

export interface ReconciliationIssue {
  id: number;
  issue_key: string;
  provider: string;
  account_env: "paper" | "live";
  issue_type: string;
  severity: string;
  status: "open" | "approved" | "rejected" | string;
  symbol: string | null;
  broker_order_id: string | null;
  client_order_id: string | null;
  local_trade_id: number | null;
  broker_snapshot: Record<string, unknown> | null;
  local_snapshot: Record<string, unknown> | null;
  proposed_action: Record<string, unknown>;
  detected_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  resolution_note: string | null;
}

export interface ReconciliationCounts {
  backfilled: number;
  orphaned: number;
  matched: number;
}

export function getBrokerConnections(): Promise<BrokerConnection[]> {
  return apiFetch<BrokerConnection[]>("/api/v1/broker/connections");
}

export function getBrokerProviders(): Promise<BrokerProviderInfo[]> {
  return apiFetch<BrokerProviderInfo[]>("/api/v1/broker/providers");
}

export function saveBrokerConnection(
  payload: SaveBrokerConnectionPayload,
): Promise<BrokerConnection> {
  return apiFetch<BrokerConnection>(
    `/api/v1/broker/connections/${payload.provider}`,
    {
      method: "POST",
      body: JSON.stringify({
        account_env: payload.account_env,
        display_name: payload.display_name ?? null,
        credentials: payload.credentials,
      }),
      timeoutMs: 30_000,
    },
  );
}

export function saveAlpacaConnection(
  payload: SaveAlpacaConnectionPayload,
): Promise<BrokerConnection> {
  return apiFetch<BrokerConnection>("/api/v1/broker/connections/alpaca", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
  });
}

export function deleteBrokerConnection(connectionId: number): Promise<void> {
  return apiFetch<void>(`/api/v1/broker/connections/${connectionId}`, {
    method: "DELETE",
  });
}

export function getReconciliationIssues(
  status: "open" | "all" | "approved" | "rejected" = "open",
): Promise<ReconciliationIssue[]> {
  return apiFetch<ReconciliationIssue[]>(
    `/api/v1/broker/reconciliation/issues?status=${encodeURIComponent(status)}`,
  );
}

export function runBrokerReconciliation(): Promise<ReconciliationCounts> {
  return apiFetch<ReconciliationCounts>("/api/v1/broker/reconciliation/run", {
    method: "POST",
    timeoutMs: 45_000,
  });
}

export function approveReconciliationIssue(
  issueId: number,
  note?: string,
): Promise<ReconciliationIssue> {
  return apiFetch<ReconciliationIssue>(
    `/api/v1/broker/reconciliation/issues/${issueId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ note: note ?? null }),
    },
  );
}

export function rejectReconciliationIssue(
  issueId: number,
  note?: string,
): Promise<ReconciliationIssue> {
  return apiFetch<ReconciliationIssue>(
    `/api/v1/broker/reconciliation/issues/${issueId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ note: note ?? null }),
    },
  );
}

// ─── Portfolio ───────────────────────────────────────────────

export async function getPositions(): Promise<Position[]> {
  // BUG-059: shared 5s response cache — see apiFetchShared.
  const raw = await apiFetchShared<Record<string, unknown>[]>(`/api/v1/trades/positions`);
  return raw.map((p) => ({
    symbol: (p.symbol as string) ?? "",
    quantity: (p.quantity as number) ?? (p.qty as number) ?? 0,
    avgCost: (p.avg_cost as number) ?? (p.avgCost as number) ?? 0,
    currentPrice: (p.current_price as number) ?? (p.currentPrice as number) ?? 0,
    unrealizedPnl: (p.unrealized_pnl as number) ?? (p.unrealizedPnl as number) ?? 0,
    marketValue: (p.market_value as number) ?? (p.marketValue as number) ?? 0,
    stopLoss: (p.stop_loss as number) ?? (p.stopLoss as number) ?? null,
    takeProfit: (p.take_profit as number) ?? (p.takeProfit as number) ?? null,
    side: (p.side as "long" | "short") ?? undefined,
    sector: (p.sector as string) ?? undefined,
    // Round-5 F-6 — strategy attribution. The backend joins on the
    // latest fill's `strategy` column and returns a string or null.
    strategy: (p.strategy as string) ?? null,
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
    // Round-11 / Y-8 (P2): the backend emits ``last_updated`` (ISO
    // datetime) on every summary response. Surface it so the
    // dashboard header can render a "last refreshed Xs ago" pill.
    last_updated?: string;
  }
  // 2026-04-20 — bumped per-call timeout to 30s (was default 15s). Cold-start
  // on this endpoint can exceed 15s because the backend fans out to the
  // Alpaca account+positions+trade-ledger queries sequentially on the first
  // request, and container restarts empty the in-proc caches. Direct curl
  // settled in <1s after warm-up, so this is a first-hit tail, not a real
  // failure — a longer timeout prevents the dashboard from briefly showing
  // em-dashes for equity/P&L.
  // BUG-059: route through `apiFetchShared` so two pages mounting in
  // the same second see the same snapshot (no cross-page drift).
  const raw = await apiFetchShared<BackendSummary>(`/api/v1/portfolio/summary`, {
    timeoutMs: 30_000,
  });
  // Prefer backend-provided true day P&L. When older backends omit it,
  // show the best live account picture available from the payload instead
  // of labeling realized-only P&L as total day P&L.
  const rawAny = raw as unknown as Record<string, unknown>;
  const dayPnl =
    (rawAny.day_pnl as number | undefined) ??
    (rawAny.profit_loss as number | undefined) ??
    ((raw.realized_pnl_today ?? 0) + (raw.unrealized_pnl ?? 0));
  const lastEquity = (raw.equity ?? 0) - dayPnl;
  const dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
  const isDemo =
    raw.is_demo === true || raw.source === "demo"
      ? true
      : raw.is_demo === false || raw.source === "alpaca"
        ? false
        : undefined;
  // Fire the global event so the dashboard chrome can surface a
  // broker-unavailable banner. Only when the flag is explicitly true —
  // the UI should not flash DEMO on a live response that happened to
  // omit the field.
  maybeDispatchBrokerDegraded(`/api/v1/portfolio/summary`, isDemo === true);
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
    // Round-11 / Y-8 — surface freshness + provenance so consumers
    // can render an "updated 5s ago" pill or detect demo-mode
    // without re-deriving from the legacy ``is_demo`` shorthand.
    lastUpdated: raw.last_updated,
    source: raw.source,
  };
}

export async function getPortfolioGreeks(): Promise<PortfolioGreeks> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/portfolio/greeks`);
  // Round-11 / Y-7 (P2): surface the per-position breakdown the
  // backend already computes (``api/routes/portfolio.py:75``).
  // Without this the panel can't show "by position" attribution.
  const byPositionRaw = raw.by_position;
  const byPosition = Array.isArray(byPositionRaw)
    ? byPositionRaw.map((p) => {
        const r = p as Record<string, unknown>;
        return {
          symbol: (r.symbol as string) ?? "",
          delta: (r.delta as number) ?? 0,
          gamma: (r.gamma as number) ?? 0,
          theta: (r.theta as number) ?? 0,
          vega: (r.vega as number) ?? 0,
        };
      })
    : undefined;
  return {
    netDelta: (raw.net_delta as number) ?? 0,
    netGamma: (raw.net_gamma as number) ?? 0,
    netTheta: (raw.net_theta as number) ?? 0,
    netVega: (raw.net_vega as number) ?? 0,
    betaWeightedDelta: (raw.beta_weighted_delta as number) ?? 0,
    byPosition,
    isDemo: raw.is_demo === true,
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

/**
 * Round-5 F-7: alerts now support percent-move conditions in addition
 * to absolute-price thresholds. ``price`` carries either a $ threshold
 * (above/below) or a % threshold (percent_move_*).
 */
export type PriceAlertCondition =
  | "above"
  | "below"
  | "percent_move_above"
  | "percent_move_below";
export type PriceAlertReference = "static" | "prev_close" | "session_open";

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  condition: PriceAlertCondition;
  triggered: boolean;
  triggered_at: string | null;
  created_at: string;
  /** Round-5 F-7 — percent-move bookkeeping. */
  reference?: PriceAlertReference | null;
  reference_price?: number | null;
  /** Round-5 F-8 — auto-cancel on close + optional TTL. */
  position_id?: string | null;
  expires_at?: string | null;
}

export function getPriceAlerts(symbol?: string): Promise<PriceAlert[]> {
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return apiFetch<PriceAlert[]>(`/api/v1/trades/alerts${qs}`);
}

export interface CreatePriceAlertExtra {
  reference?: PriceAlertReference;
  reference_price?: number;
  position_id?: string;
  expires_at?: string;
}

export function createPriceAlert(
  symbol: string,
  price: number,
  condition: PriceAlertCondition,
  extra: CreatePriceAlertExtra = {},
) {
  const body: Record<string, unknown> = { symbol, price, condition };
  if (extra.reference) body.reference = extra.reference;
  if (extra.reference_price != null) body.reference_price = extra.reference_price;
  if (extra.position_id) body.position_id = extra.position_id;
  if (extra.expires_at) body.expires_at = extra.expires_at;
  return apiFetch<PriceAlert>(`/api/v1/trades/alerts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deletePriceAlert(alertId: string) {
  return apiFetch<{ ok: boolean }>(`/api/v1/trades/alerts/${alertId}`, {
    method: "DELETE",
  });
}

// 2026-05-11 (round 5i): the alert-ack endpoint marks an alert as
// "acknowledged" (operator saw it; don't re-fire). Different from
// delete — the row stays around for audit.
export function ackPriceAlert(alertId: string) {
  return apiFetch<{ ok: boolean }>(`/api/v1/trades/alerts/${alertId}/ack`, {
    method: "POST",
  });
}

// ─── Per-agent control (Plan B.2, round 5i) ─────────────────────────
//
// Four archetypes (research / signal / risk / exec). Each row has a
// pause flag, an optional daily-spend cap in USD, and audit metadata
// (paused_by, paused_at, reason). Phase B seeds one wildcard row per
// archetype with a $50/day default cap.
export interface AgentControl {
  id: number;
  archetype: "research" | "signal" | "risk" | "exec" | string;
  model: string | null;
  provider: string | null;
  is_paused: boolean;
  daily_spend_cap_usd: number | null;
  paused_by: string | null;
  paused_at: string | null;
  reason: string | null;
  updated_at: string | null;
}

export interface AgentControlPatch {
  is_paused?: boolean;
  daily_spend_cap_usd?: number;
  reason?: string;
}

export function getAgentControls() {
  return apiFetch<AgentControl[]>(`/api/v1/agents/controls`);
}

export function patchAgentControl(controlId: number, patch: AgentControlPatch) {
  return apiFetch<AgentControl>(`/api/v1/agents/controls/${controlId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
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

// ─── Portfolio journal + calendar (round 5e) ───────────────────────
//
// /api/v1/portfolio/journal returns trade journal entries; the design's
// Analytics + Reports pages render notes per trade. Calendar returns
// per-day P&L + best/worst trading day for the month-cell heatmap.
export interface JournalEntry {
  id: number;
  trade_id: number | null;
  symbol: string | null;
  entry_date: string;
  entry_type: string;
  content: string;
  tags: string[];
  attachments?: string[];
}

export function getPortfolioJournal(opts?: { limit?: number; symbol?: string }) {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.symbol) qs.set("symbol", opts.symbol);
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<JournalEntry[]>(`/api/v1/portfolio/journal${tail}`);
}

// 2026-05-11 (round 5e): the earnings module already exports a
// `CalendarResponse` for the earnings-events calendar. The portfolio
// daily-P&L calendar is a different shape — keep them distinct.
export interface PortfolioCalendarDay {
  date: string;
  pnl: number;
  trades: number;
  win_rate: number;
}

export interface PortfolioCalendarBestWorst {
  date: string;
  pnl: number;
}

export interface PortfolioCalendarResponse {
  month: number;
  year: number;
  days: PortfolioCalendarDay[];
  month_total: number;
  trading_days: number;
  winning_days: number;
  losing_days: number;
  best_day: PortfolioCalendarBestWorst | null;
  worst_day: PortfolioCalendarBestWorst | null;
  is_demo: boolean;
  has_data: boolean;
}

export function getPortfolioCalendar(month?: number, year?: number) {
  const qs = new URLSearchParams();
  if (month) qs.set("month", String(month));
  if (year) qs.set("year", String(year));
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<PortfolioCalendarResponse>(`/api/v1/portfolio/calendar${tail}`);
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
  signals: Record<string, unknown>[];
  ordersPlaced: PipelineOrder[];
  ordersClosed: PipelineOrder[];
  portfolioSnapshot: { equity: number; cash: number; positions: number };
  errors: string[];
  /** Raw per-strategy breakdown from the pipeline log */
  strategies?: Record<string, unknown>;
  /** Master agent decisions/rejections */
  master_agent?: Record<string, unknown>;
  /**
   * Numeric counts surfaced when the backend returns aggregate totals
   * without per-row detail. The UI renders these in an editorial empty
   * state rather than synthesizing `stock-0`/`${stratName}-${i}` rows.
   */
  counts?: { screened: number; analyzed: number };
}

export interface PipelineHistoryEntry extends Record<string, unknown> {
  date?: string;
  signals?: number | Record<string, unknown>[];
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

export async function getPipelineHistory(): Promise<PipelineHistoryEntry[]> {
  return apiFetch<PipelineHistoryEntry[]>('/api/v1/pipeline/history');
}

// v2 backend (PR #146 follow-up) — pre-screen universe size for the
// pipeline funnel hero. Backend may degrade gracefully to a known-good
// ballpark when the symbol catalogue is unavailable.
export interface PipelineUniverseResponse {
  count: number;
  source: string;
  filter_criteria: string;
  as_of: string;
}

export function getPipelineUniverse() {
  return apiFetch<PipelineUniverseResponse>('/api/v1/pipeline/universe');
}

// v2 backend (pensive-kirch B.3) — multi-list watchlists v2.
// Backend prefix: /api/v1/watchlists. Each list has symbol-only items
// (no enriched price/signal data — those come from quote feeds).
export interface WatchlistV2Item {
  symbol: string;
  position: number;
  note: string | null;
}

export interface WatchlistV2 {
  id: number;
  name: string;
  description: string | null;
  kind: "manual" | "auto_strategy" | "auto_earnings";
  auto_source_strategy: string | null;
  column_set: string[] | null;
  share_mode: "private" | "tenant" | "public";
  share_token: string | null;
  position: number;
  items: WatchlistV2Item[];
}

export interface CreateWatchlistRequest {
  name: string;
  description?: string;
  kind?: "manual" | "auto_strategy" | "auto_earnings";
}

export function getWatchlistsV2() {
  return apiFetch<WatchlistV2[]>('/api/v1/watchlists');
}

export function createWatchlistV2(req: CreateWatchlistRequest) {
  return apiFetch<WatchlistV2>('/api/v1/watchlists', {
    method: "POST",
    body: JSON.stringify(req),
    headers: { "Content-Type": "application/json" },
  });
}

export function addWatchlistItem(watchlistId: number, symbol: string, note?: string) {
  return apiFetch<WatchlistV2Item>(`/api/v1/watchlists/${watchlistId}/items`, {
    method: "POST",
    body: JSON.stringify({ symbol, note }),
    headers: { "Content-Type": "application/json" },
  });
}

export function removeWatchlistItem(watchlistId: number, symbol: string) {
  return apiFetch<void>(`/api/v1/watchlists/${watchlistId}/items/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  });
}

// v2 backend (PR #146 follow-up) — reconciliation state for the
// design's "Reconciled with Alpaca · 09:14 today" indicator on the
// Reports page hero.
export interface ReconciliationStateResponse {
  last_reconciled_at: string | null;
  open_issue_count: number;
  primary_provider: string | null;
  is_clean: boolean;
}

export function getReconciliationState() {
  return apiFetch<ReconciliationStateResponse>('/api/v1/broker/reconciliation/state');
}

// v2 backend — structured staged candidates from the latest pipeline
// run. Powers the design's "STAGED · AWAITING YOUR REVIEW" 2x2 grid
// without per-row defensive parsing of the loose `signals` array.
export interface StagedCandidate {
  symbol: string;
  strategy: string | null;
  signal: string | null;
  conviction: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string | null;
  timestamp: string | null;
}

export interface StagedCandidatesResponse {
  run_date: string | null;
  universe_estimate: number | null;
  candidates: StagedCandidate[];
}

export function getPipelineStaged() {
  return apiFetch<StagedCandidatesResponse>('/api/v1/pipeline/staged');
}

// v2 backend — watchlist items joined with current quote + signal +
// held data. Lets the watchlists table render live data without a
// per-row fan-out of quote queries.
export interface EnrichedWatchlistItem {
  symbol: string;
  name: string | null;
  px: number | null;
  pct_day: number | null;
  vol: string | null;
  tech_score: number | null;
  signal: string | null;
  held: boolean;
  note: string | null;
  position: number;
}

export interface EnrichedWatchlistResponse {
  id: number;
  name: string;
  kind: string;
  items: EnrichedWatchlistItem[];
}

export function getEnrichedWatchlist(watchlistId: number) {
  return apiFetch<EnrichedWatchlistResponse>(`/api/v1/watchlists/${watchlistId}/enriched`);
}

// v2 backend (pensive-kirch B.4) — server-side notification inbox.
// Backend types: fill / agent / risk / system / billing / support.
// Maps cleanly onto the frontend store's NotificationCategory.
export interface NotificationV2 {
  id: number;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export function getNotifications(opts?: { unread_only?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (opts?.unread_only) qs.set("unread_only", "true");
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<NotificationV2[]>(`/api/v1/notifications${tail}`);
}

export function markNotificationRead(notificationId: number) {
  return apiFetch<void>(`/api/v1/notifications/${notificationId}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead() {
  return apiFetch<void>(`/api/v1/notifications/read-all`, {
    method: "POST",
  });
}

// ─── Notification preferences (round 5d backend wiring) ────────────
//
// Settings → Notifications drives 6 backend channel types: fill /
// agent / risk / system / billing / support. Each row carries email
// + push + slack toggles plus quiet-hours + min-severity. The
// /preferences/{type} PATCH auto-creates a default row on first edit,
// so the FE can fire off PATCHes for any type without an explicit
// provisioning step.
export type NotificationPrefType = "fill" | "agent" | "risk" | "system" | "billing" | "support";

export interface NotificationPreference {
  type: NotificationPrefType;
  channel_email: boolean;
  channel_push: boolean;
  channel_slack: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
  min_severity: "info" | "warning" | "error";
}

export interface NotificationPreferencePatch {
  channel_email?: boolean;
  channel_push?: boolean;
  channel_slack?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
  min_severity?: "info" | "warning" | "error";
}

export function getNotificationPreferences() {
  return apiFetch<NotificationPreference[]>(`/api/v1/notifications/preferences`);
}

export function patchNotificationPreference(
  type: NotificationPrefType,
  patch: NotificationPreferencePatch,
) {
  return apiFetch<NotificationPreference>(`/api/v1/notifications/preferences/${type}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ─── Pipeline stages v2 (round 5d) ────────────────────────────────
//
// B.1 per-stage pause/resume. Replaces the global-halt model with 5
// stages: ingest / enrich / score / risk / execute. Admin-only on
// pause+resume; list is for any authed user so the operator sees the
// state badge from non-admin surfaces.
export type PipelineStageName = "ingest" | "enrich" | "score" | "risk" | "execute";

export interface PipelineStage {
  stage: PipelineStageName;
  is_paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  reason: string | null;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  queue_depth: number;
}

export function getPipelineStages() {
  return apiFetch<PipelineStage[]>(`/api/v1/pipeline/stages`);
}

export function pausePipelineStage(stage: PipelineStageName, reason: string) {
  return apiFetch<PipelineStage>(`/api/v1/pipeline/stages/${stage}/pause`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function resumePipelineStage(stage: PipelineStageName) {
  return apiFetch<PipelineStage>(`/api/v1/pipeline/stages/${stage}/resume`, {
    method: "POST",
  });
}

// ─── Pipeline operations (round 5d) ───────────────────────────────
//
// Wraps the trigger / cancel / scheduler / schedule / summary endpoints
// the design's Pipeline page surfaces but didn't actually call.
export interface PipelineSchedulerState {
  last_premarket?: string;
  last_open?: string;
  last_midday?: string;
  last_close?: string;
  last_heartbeat?: string | null;
  next_scheduled_run?: string | null;
  missed_runs?: number;
}

// 2026-05-11 (round 5d follow-up): the original /schedule + /summary
// + /realtime-setups types were wishful — they didn't match the
// backend's actual wire shapes. PR #174 shipped with these guesses,
// which crashed Pipeline page in prod ("x.slice is not a function"
// because /realtime-setups returns {summary, setups} not an array).
// Updated to the real shapes the backend emits.

export interface PipelineScheduleWindow {
  time: string;     // "06:00 ET" / "15:30 Fri"
  name: string;     // "Pre-market scan" / "Market open execution"
  strategies: string[];
  frequency: string; // "daily" / "weekly (Friday)" / etc.
}

export interface PipelineSchedule {
  windows: PipelineScheduleWindow[];
  realtime: {
    strategies: string[];
    description: string;
  };
}

// `/pipeline/summary` returns an aggregate-stats blob. None of the
// fields I originally assumed (universe / candidates / staged / live /
// filled) exist on the backend — those numbers come from staged + live
// state, not the summary endpoint. Real shape mirrors the FastAPI
// handler verbatim.
export interface PipelineSummary {
  total_runs: number;
  total_trades_placed: number;
  total_trades_rejected: number;
  approval_rate: number;
  most_active_strategy: string | null;
  most_rejected_reason: string | null;
  last_run: string | null;
  portfolio_since_start: {
    starting_equity: number;
    current_equity: number;
    total_return_pct: number;
  };
  closed_trade_metrics: Record<string, unknown>;
}

// `/realtime-setups` returns `{summary, setups[]}` where summary is
// the scanner's aggregate and setups is the per-symbol active list.
// PipelinePage cares about the `setups` array; we unwrap here so
// callers can `.slice/.map` on the return value without defensive
// guards everywhere.
export interface PipelineRealtimeSetup {
  symbol: string;
  strategy: string;
  type: string;
  trigger_price: number;
  direction: string;
  expires: string;
}

export interface PipelineRealtimeSetupsResponse {
  summary: Record<string, unknown>;
  setups: PipelineRealtimeSetup[];
}

export function getPipelineSchedule() {
  return apiFetch<PipelineSchedule>(`/api/v1/pipeline/schedule`);
}

export function getPipelineSchedulerState() {
  return apiFetch<PipelineSchedulerState>(`/api/v1/pipeline/scheduler_state`);
}

export function getPipelineSummary() {
  return apiFetch<PipelineSummary>(`/api/v1/pipeline/summary`);
}

export function cancelPipelineRun() {
  return apiFetch<{ cancelled: boolean; reason?: string }>(`/api/v1/pipeline/cancel`, {
    method: "POST",
  });
}

/** Returns ONLY the setups[] array — backend wraps it in {summary, setups}. */
export async function getPipelineRealtimeSetups(): Promise<PipelineRealtimeSetup[]> {
  const res = await apiFetch<PipelineRealtimeSetupsResponse | PipelineRealtimeSetup[]>(
    `/api/v1/pipeline/realtime-setups`,
  );
  // Defensive: if backend ever flattens, accept both shapes.
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.setups) ? res.setups : [];
}

export async function getPipelineRun(date: string): Promise<PipelineRun> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/pipeline/history/${date}`);
  return mapPipelineRun(raw);
}

type PipelineStrategyDetail = {
  screened?: number;
  analyzed?: number;
  analyses?: unknown[];
};

function asPipelineRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asPipelineRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asPipelineRecord) : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapPipelineAnalysis(value: unknown, fallbackSymbol = ""): PipelineAnalysis {
  const item = asPipelineRecord(value);
  return {
    symbol: asString(item.symbol, fallbackSymbol),
    signal: asString(item.signal, "hold"),
    conviction: asNumber(item.conviction),
    entryPrice: asNumberOrNull(item.entry_price ?? item.entryPrice),
    stopLoss: asNumberOrNull(item.stop_loss ?? item.stopLoss),
    takeProfit: asNumberOrNull(item.take_profit ?? item.takeProfit),
    rationale: asString(item.rationale),
  };
}

function mapPipelineOrder(item: Record<string, unknown>): PipelineOrder {
  return {
    symbol: asString(item.symbol),
    side: asString(item.side),
    qty: asNumber(item.qty),
    price: asNumber(item.price),
    orderId: asString(item.order_id ?? item.orderId),
    status: asString(item.status),
    timestamp: asString(item.timestamp),
  };
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPipelineStrategyMap(value: unknown): Record<string, PipelineStrategyDetail> {
  const source = asPipelineRecord(value);
  const mapped: Record<string, PipelineStrategyDetail> = {};
  for (const [name, rawValue] of Object.entries(source)) {
    const raw = asPipelineRecord(rawValue);
    mapped[name] = {
      screened: typeof raw.screened === "number" ? raw.screened : undefined,
      analyzed: typeof raw.analyzed === "number" ? raw.analyzed : undefined,
      analyses: Array.isArray(raw.analyses) ? raw.analyses : undefined,
    };
  }
  return mapped;
}

export function mapPipelineRun(raw: Record<string, unknown>): PipelineRun {
  const r = raw;

  // Build screened/analyzed arrays — top-level arrays if available, otherwise
  // aggregate from per-strategy data inside r.strategies
  let screened: PipelineScreenedStock[] = [];
  let analyzed: PipelineAnalysis[] = [];

  if (Array.isArray(r.screened) && r.screened.length > 0) {
    screened = r.screened.map((item) => {
      const s = asPipelineRecord(item);
      return {
        symbol: asString(s.symbol), name: asString(s.name), price: asNumber(s.price),
        compositeScore: asNumber(s.composite_score ?? s.compositeScore),
        sector: asString(s.sector), changePct: asNumber(s.change_pct ?? s.changePct),
      };
    });
  }
  if (Array.isArray(r.analyzed) && r.analyzed.length > 0) {
    analyzed = r.analyzed.map((item) => mapPipelineAnalysis(item));
  }

  // Aggregate from per-strategy data when top-level arrays are absent.
  // We NEVER synthesize rows to pad a count — if the backend only gave us a
  // number, the UI renders the count in an editorial empty state instead of
  // fake `stock-0` / `${stratName}-${i}` placeholders.
  const strategies = asPipelineStrategyMap(r.strategies);
  const screenedCounts = Object.values(strategies)
    .reduce((acc, s) => acc + (typeof s.screened === "number" ? s.screened : 0), 0);
  const analyzedCounts = Object.values(strategies)
    .reduce((acc, s) => acc + (typeof s.analyzed === "number" ? s.analyzed : 0), 0);
  if (analyzed.length === 0) {
    // Collect analyses from each strategy's analyses array. A numeric-only
    // `analyzed` count does NOT fabricate rows — it survives as part of
    // `counts` below for the UI's empty state to display.
    for (const [stratName, strat] of Object.entries(strategies)) {
      if (Array.isArray(strat.analyses)) {
        for (const item of strat.analyses) {
          analyzed.push(mapPipelineAnalysis(item, stratName));
        }
      }
    }
  }

  const portfolio = asPipelineRecord(r.portfolio_snapshot ?? r.portfolioSnapshot);
  const masterAgent = asPipelineRecord(r.master_agent);

  return {
    date: asString(r.date),
    timestamp: asString(r.timestamp),
    screened,
    analyzed,
    signals: asPipelineRecords(r.signals),
    ordersPlaced: asPipelineRecords(r.orders_placed ?? r.ordersPlaced).map(mapPipelineOrder),
    ordersClosed: asPipelineRecords(r.orders_closed ?? r.ordersClosed).map(mapPipelineOrder),
    portfolioSnapshot: {
      equity: asNumber(portfolio.equity),
      cash: asNumber(portfolio.cash),
      positions: asNumber(portfolio.positions),
    },
    errors: Array.isArray(r.errors) ? r.errors.map((item) => asString(item)).filter(Boolean) : [],
    strategies: Object.keys(strategies).length ? strategies : undefined,
    master_agent: Object.keys(masterAgent).length ? masterAgent : undefined,
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

// ─── Earnings API mappers ────────────────────────────────────
//
// The backend serves this surface in snake_case (Python convention). The
// frontend types (see `@/types`) are camelCase, matching the rest of the
// codebase. Every earnings endpoint runs its raw payload through one of the
// mappers below so the shape is camelCased at the transport boundary — no
// snake_case leaks downstream into components or tests.

interface RawCalendarRow {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  days_until: number;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  iv_rank: number | null;
  premium_yield_call_atm: number | null;
  premium_yield_put_atm: number | null;
  expected_move_pct: number | null;
  hist_avg_abs_move_pct: number | null;
  claude_verdict: EarningsVerdict | null;
  claude_confidence: number | null;
  top_setup: EarningsTopSetup | null;
  edge_score?: number | null;
  edge_score_reasons?: unknown;
  /** Round-4: backend tags state of this report relative to today. */
  report_state?: import("@/types").EarningsReportState;
}

interface RawCalendarResponse {
  earnings: RawCalendarRow[];
  generated_at: string;
  partial: boolean;
  error?: string | null;
  /** Per-symbol Pydantic validation failures from earnings_screener.
   *  Backend emits snake_case; mapper renames to ``validationErrors``. */
  validation_errors?: Array<{ symbol: string | null; error: string }>;
  /** Round-4: window honesty fields. Optional so older response shapes
   *  still parse (UI falls back to local titles when absent). */
  window_start?: string;
  window_end?: string;
  window_label?: string;
  meta?: {
    reason?: import("@/types").CalendarMetaReason;
    before_curated?: number;
  };
}

interface RawLadderRow {
  strike: number;
  expiry?: string | null;
  side: LadderRow["side"];
  bucket: LadderRow["bucket"];
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  yield_pct: number;
  pop: number;
  theta: number;
  gamma: number;
  vega: number;
  oi: number;
  volume: number;
  /** Wave V V1-3 (2026-05-05): wire field — volume / OI ratio. */
  volume_oi_ratio?: number | null;
  /** Wave V V1-4 (2026-05-05): wire field — 0..1 liquidity score. */
  liquidity_score?: number | null;
}

interface RawStrikeLadder {
  expiry: string;
  underlying_price: number;
  rows: RawLadderRow[];
  /** ISO timestamp of the options-chain snapshot used for row mids. */
  fetched_at?: string | null;
  /** Round-4: true when the ladder is synthetic / demo data. */
  is_demo?: boolean;
}

interface RawComparableSetup {
  report_date: string;
  iv_rank: number;
  setup: string;
  outcome: string;
  similarity_score: number;
}

interface RawClaudeStructured {
  verdict: EarningsVerdict;
  direction_magnitude: { bull_case_pct: number; bear_case_pct: number };
  thesis: string;
  catalysts: string[];
  risks: string[];
  suggested_play: EarningsTopSetup;
  suggested_play_reason: string;
  confidence: number;
  model: string;
  generated_at: string;
}

interface RawClaudeFullResearch {
  thesis_paragraph: string;
  comparable_setups: RawComparableSetup[];
  post_earnings_drift_playbook: string;
  sector_backdrop: string;
  analyst_consensus_delta: string;
  what_would_change_my_mind: string;
  confidence: number;
  model: string;
  generated_at: string;
}

interface RawHistQuarter {
  report_date: string;
  surprise_pct: number | null;
  next_day_move_pct: number;
  five_day_move_pct: number;
}

interface RawHistoricalStats {
  avg_abs_move_pct: number;
  wins: number;
  losses: number;
  surprise_beat_rate: number;
  iv_vs_hist_vol_points: number | null;
}

interface RawHistoricalBlock {
  quarters: RawHistQuarter[];
  stats: RawHistoricalStats;
}

interface RawEarningsBacktestTrade {
  symbol: string;
  report_date: string;
  setup: string;
  return_pct: number;
  win: boolean;
  edge_score: number | null;
  reason: string;
}

interface RawEarningsBacktestSkipped {
  symbol: string;
  reason: string;
}

interface RawEarningsBacktestMetrics {
  events: number;
  win_rate: number;
  avg_trade_return_pct: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
}

interface RawEarningsBacktestResponse {
  trades: RawEarningsBacktestTrade[];
  skipped: RawEarningsBacktestSkipped[];
  metrics: RawEarningsBacktestMetrics;
}

interface RawIVTermPoint {
  expiry: string;
  dte: number;
  atm_iv: number;
}

interface RawSkewBlock {
  put_iv_25d: number | null;
  call_iv_25d: number | null;
  skew_points: number | null;
  interpretation: SkewBlock["interpretation"];
}

interface RawEarningsMetricsBlock {
  iv_rank: number | null;
  iv_percentile: number | null;
  current_iv: number | null;
  hv_20: number | null;
  hv_50: number | null;
  hv_100: number | null;
  hv_iv_ratio: number | null;
  expected_move_pct: number | null;
  expected_move_dollars: number | null;
  hist_avg_abs_move_pct: number | null;
  vol_premium_score?: number | null;
  beat_rate: number | null;
  days_to_earnings: number | null;
  days_to_expiry: number | null;
}

interface RawEarningsNewsArticle {
  title: string;
  source: string;
  published_at: string;
  url: string;
  // Round-12 / NF-1 (P2): backend ``services/news.py`` now emits a
  // relevance_score (0..1), price-driving category, and source tier
  // computed at parse time. Surface them so the FE can render a
  // category chip + sort by relevance.
  relevance_score?: number;
  category?: string | null;
  tier?: number;
  sentiment?: string | null;
  // B2.1: heuristic sentiment / magnitude / confidence chips.
  magnitude?: "small" | "medium" | "large" | null;
  confidence?: number | null;
  // B2.6: source priority pass-through.
  source_priority?: number | null;
  // B2.4: collapsed-duplicate count (>0 → "+N more" suffix).
  duplicate_count?: number;
}

interface RawEarningsDetail {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  days_until?: number | null;
  report_state?: import("@/types").EarningsReportState;
  quote: { last: number; change: number; change_pct: number; timestamp?: string } | null;
  metrics: RawEarningsMetricsBlock | null;
  strike_ladder: RawStrikeLadder | null;
  claude_structured: RawClaudeStructured | null;
  claude_full_research: RawClaudeFullResearch | null;
  historical_earnings?: RawHistoricalBlock | null;
  iv_term_structure: RawIVTermPoint[] | null;
  skew: RawSkewBlock | null;
  news: RawEarningsNewsArticle[];
  partial: boolean;
  generated_at: string;
  /**
   * Round-4: per-payload degraded-path codes for precise UI banner.
   * Round-5 (NEW-Y9): typed `unknown` so the mapper can defensively
   * filter non-string entries from a wonky backend payload without
   * forcing a cast at the call site.
   */
  error_codes?: unknown;
  /**
   * Maverick FIX-C: tail-risk score + reasons. Backend already
   * emits them on the analysis endpoint; the detail payload is the
   * forward-compat shape (mapper passes through whatever lands).
   * Typed liberally on the wire — the mapper does the narrowing.
   */
  tail_risk_score?: number | null;
  tail_risk_reasons?: unknown;
}

function mapCalendarRow(r: RawCalendarRow): CalendarRow {
  const rawReasons = r.edge_score_reasons;
  return {
    symbol: r.symbol,
    company: r.company,
    sector: r.sector,
    reportDate: r.report_date,
    reportTime: r.report_time,
    daysUntil: r.days_until,
    price: r.price,
    change: r.change,
    changePct: r.change_pct,
    ivRank: r.iv_rank,
    premiumYieldCallAtm: r.premium_yield_call_atm,
    premiumYieldPutAtm: r.premium_yield_put_atm,
    expectedMovePct: r.expected_move_pct,
    histAvgAbsMovePct: r.hist_avg_abs_move_pct,
    claudeVerdict: r.claude_verdict,
    claudeConfidence: r.claude_confidence,
    topSetup: r.top_setup,
    edgeScore: r.edge_score ?? null,
    edgeScoreReasons: Array.isArray(rawReasons)
      ? rawReasons.filter((v): v is string => typeof v === "string")
      : [],
    // Round-4: optional report state — pass through when present.
    ...(r.report_state !== undefined ? { reportState: r.report_state } : {}),
  };
}

function mapLadderRow(r: RawLadderRow): LadderRow {
  return {
    strike: r.strike,
    expiry: r.expiry ?? null,
    side: r.side,
    bucket: r.bucket,
    delta: r.delta,
    bid: r.bid,
    ask: r.ask,
    mid: r.mid,
    iv: r.iv,
    yieldPct: r.yield_pct,
    pop: r.pop,
    theta: r.theta,
    gamma: r.gamma,
    vega: r.vega,
    oi: r.oi,
    volume: r.volume,
    // Wave V V1-3/V1-4: forward optional liquidity signals when the
    // backend provides them. ``null`` survives the round-trip; missing
    // fields stay missing so legacy paths and older fixtures keep
    // their existing shapes.
    volumeOiRatio: r.volume_oi_ratio ?? null,
    liquidityScore: r.liquidity_score ?? null,
  };
}

function mapStrikeLadder(raw: RawStrikeLadder): StrikeLadder {
  return {
    expiry: raw.expiry,
    underlyingPrice: raw.underlying_price,
    rows: raw.rows.map(mapLadderRow),
    fetchedAt: raw.fetched_at ?? null,
    // Round-4: backend may flag synthetic / demo chain — UI badges it.
    isDemo: raw.is_demo === true,
  };
}

/**
 * Wave V V5 — pre-trade slippage forecast emitted with each setup. Maps
 * the backend snake-case payload to the frontend ComboFillForecast shape.
 * Returns null when the backend emitted null/undefined so the FE can
 * conditionally render the "Expected fill" line.
 */
export function mapFillForecast(raw: unknown): ComboFillForecast | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const targetMid = typeof r.target_mid === "number" ? r.target_mid : null;
  const expectedFill = typeof r.expected_fill === "number" ? r.expected_fill : null;
  const p10Fill = typeof r.p10_fill === "number" ? r.p10_fill : null;
  const p90Fill = typeof r.p90_fill === "number" ? r.p90_fill : null;
  const expectedSlippageDollars =
    typeof r.expected_slippage_dollars === "number"
      ? r.expected_slippage_dollars
      : null;
  if (
    targetMid === null
    || expectedFill === null
    || p10Fill === null
    || p90Fill === null
    || expectedSlippageDollars === null
  ) {
    return null;
  }
  const confidenceRaw = r.confidence;
  const confidence: "high" | "medium" | "low" =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? confidenceRaw
      : "low";
  const reasoning = Array.isArray(r.reasoning)
    ? (r.reasoning as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  return {
    targetMid,
    expectedFill,
    p10Fill,
    p90Fill,
    expectedSlippageDollars,
    confidence,
    reasoning,
  };
}

/**
 * Mirrors backend ``earnings_recommender._SETUP_ID_TO_LEGACY``: snake_case
 * wire IDs → space-delimited ``EarningsTopSetup`` literals. Without this
 * normalization the FE keys per-setup confidence by ``setup_id``
 * ("bull_put_spread") while consumers (TradeButtonRow) look up by label
 * ("bull put spread"), so every chip silently disappears in prod.
 *
 * Keep aligned with the backend table; new entries should be added in
 * tandem. Unknown IDs fall through to ``null`` so future backend setups
 * degrade gracefully rather than mis-key into existing slots.
 */
export const SETUP_ID_TO_LABEL: Record<string, EarningsTopSetup> = {
  iron_condor: "iron condor",
  iron_butterfly: "iron butterfly",
  bear_call_spread: "bear call spread",
  bull_put_spread: "bull put spread",
  bull_call_spread: "bull call spread",
  bear_put_spread: "bear put spread",
  long_call: "long call",
  long_put: "long put",
  long_straddle: "long straddle",
  long_strangle: "long straddle", // backend collapses; FE union lacks long_strangle
  calendar_spread: "calendar spread",
  diagonal_spread: "diagonal spread",
  short_strangle: "short strangle", // legacy, defined-risk gate blocks new emissions
  short_straddle: "short strangle", // legacy collapse, mirrors backend
};

/**
 * Wave 4a / Batch Q — map a backend EarningsSetup wire payload to the
 * frontend EarningsSetup shape. Tolerant of missing optional fields
 * (older cached responses, demo data) so unknown fields fall to safe
 * defaults rather than failing the whole earnings response.
 */
export function mapEarningsSetup(raw: unknown): EarningsSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const setupId = typeof r.setup_id === "string" ? r.setup_id : null;
  if (!setupId) return null;
  // Normalize snake_case wire ID → space-delimited EarningsTopSetup label.
  // ``null`` when the backend ships an ID we don't recognize (e.g. a new
  // setup type), so callers either skip the lookup or render a fallback
  // rather than mis-keying into an unrelated label.
  const setupLabel = SETUP_ID_TO_LABEL[setupId] ?? null;
  const legsRaw = Array.isArray(r.legs) ? (r.legs as unknown[]) : [];
  const legs: EarningsSetupLeg[] = legsRaw
    .map((legRaw): EarningsSetupLeg | null => {
      if (!legRaw || typeof legRaw !== "object") return null;
      const l = legRaw as Record<string, unknown>;
      const side = l.side === "buy" || l.side === "sell" ? l.side : null;
      const contractType = l.contract_type === "call" || l.contract_type === "put"
        ? l.contract_type
        : null;
      const strike = typeof l.strike === "number" ? l.strike : null;
      const mid = typeof l.mid === "number" ? l.mid : null;
      const expiry = typeof l.expiry === "string" ? l.expiry : null;
      if (side === null || contractType === null || strike === null || mid === null || expiry === null) {
        return null;
      }
      return {
        side,
        contractType,
        strike,
        expiry,
        qty: typeof l.qty === "number" ? l.qty : 1,
        mid,
      };
    })
    .filter((l): l is EarningsSetupLeg => l !== null);
  return {
    setupId,
    setupLabel,
    legs,
    netCreditOrDebit: typeof r.net_credit_or_debit === "number" ? r.net_credit_or_debit : 0,
    maxProfit: typeof r.max_profit === "number" ? r.max_profit : null,
    maxLoss: typeof r.max_loss === "number" ? r.max_loss : null,
    breakevens: Array.isArray(r.breakevens)
      ? (r.breakevens as unknown[]).filter((b): b is number => typeof b === "number")
      : [],
    popEstimate: typeof r.pop_estimate === "number" ? r.pop_estimate : 0,
    expectedValue: typeof r.expected_value === "number" ? r.expected_value : 0,
    riskReward: typeof r.risk_reward === "number" ? r.risk_reward : null,
    rationale: typeof r.rationale === "string" ? r.rationale : "",
    sizingKellyPct: typeof r.sizing_kelly_pct === "number" ? r.sizing_kelly_pct : 0,
    isDefinedRisk: r.is_defined_risk === true,
    requiresMarginEstimate:
      typeof r.requires_margin_estimate === "number" ? r.requires_margin_estimate : null,
    worstLegLiquidityScore:
      typeof r.worst_leg_liquidity_score === "number" ? r.worst_leg_liquidity_score : null,
    liquidityWarning: r.liquidity_warning === true,
    fillForecast: mapFillForecast(r.fill_forecast),
    // PR-1 / T3: pass through per-setup confidence (0..1). Backend emits
    // null for setups missing PoP (skip / extreme-tail demotions); we
    // preserve null so the UI can omit the chip rather than render 0%.
    confidence: typeof r.confidence === "number" ? r.confidence : null,
  };
}

function mapClaudeStructured(raw: RawClaudeStructured): ClaudeStructured {
  return {
    verdict: raw.verdict,
    directionMagnitude: {
      bullCasePct: raw.direction_magnitude.bull_case_pct,
      bearCasePct: raw.direction_magnitude.bear_case_pct,
    },
    thesis: raw.thesis,
    catalysts: raw.catalysts,
    risks: raw.risks,
    suggestedPlay: raw.suggested_play,
    suggestedPlayReason: raw.suggested_play_reason,
    confidence: raw.confidence,
    model: raw.model,
    generatedAt: raw.generated_at,
  };
}

function mapComparableSetup(raw: RawComparableSetup): ComparableSetup {
  return {
    reportDate: raw.report_date,
    ivRank: raw.iv_rank,
    setup: raw.setup,
    outcome: raw.outcome,
    similarityScore: raw.similarity_score,
  };
}

function mapClaudeFullResearch(raw: RawClaudeFullResearch): ClaudeFullResearch {
  return {
    thesisParagraph: raw.thesis_paragraph,
    comparableSetups: raw.comparable_setups.map(mapComparableSetup),
    postEarningsDriftPlaybook: raw.post_earnings_drift_playbook,
    sectorBackdrop: raw.sector_backdrop,
    analystConsensusDelta: raw.analyst_consensus_delta,
    whatWouldChangeMyMind: raw.what_would_change_my_mind,
    confidence: raw.confidence,
    model: raw.model,
    generatedAt: raw.generated_at,
  };
}

function mapMetrics(raw: RawEarningsMetricsBlock): EarningsMetricsBlock {
  return {
    ivRank: raw.iv_rank,
    ivPercentile: raw.iv_percentile,
    currentIv: raw.current_iv,
    hv20: raw.hv_20,
    hv50: raw.hv_50,
    hv100: raw.hv_100,
    hvIvRatio: raw.hv_iv_ratio,
    expectedMovePct: raw.expected_move_pct,
    expectedMoveDollars: raw.expected_move_dollars,
    histAvgAbsMovePct: raw.hist_avg_abs_move_pct,
    volPremiumScore: raw.vol_premium_score ?? null,
    beatRate: raw.beat_rate,
    daysToEarnings: raw.days_to_earnings,
    daysToExpiry: raw.days_to_expiry,
  };
}

function mapHistQuarter(raw: RawHistQuarter): HistQuarter {
  return {
    reportDate: raw.report_date,
    surprisePct: raw.surprise_pct,
    nextDayMovePct: raw.next_day_move_pct,
    fiveDayMovePct: raw.five_day_move_pct,
  };
}

function mapHistoricalStats(raw: RawHistoricalStats): HistoricalStats {
  return {
    avgAbsMovePct: raw.avg_abs_move_pct,
    wins: raw.wins,
    losses: raw.losses,
    surpriseBeatRate: raw.surprise_beat_rate,
    ivVsHistVolPoints: raw.iv_vs_hist_vol_points,
  };
}

function mapHistoricalBlock(raw: RawHistoricalBlock): HistoricalBlock {
  return {
    quarters: raw.quarters.map(mapHistQuarter),
    stats: mapHistoricalStats(raw.stats),
  };
}

function mapEarningsBacktestTrade(raw: RawEarningsBacktestTrade): EarningsBacktestTrade {
  return {
    symbol: raw.symbol,
    reportDate: raw.report_date,
    setup: raw.setup,
    returnPct: raw.return_pct,
    win: raw.win,
    edgeScore: raw.edge_score,
    reason: raw.reason,
  };
}

function mapEarningsBacktestMetrics(raw: RawEarningsBacktestMetrics): EarningsBacktestMetrics {
  return {
    events: raw.events,
    winRate: raw.win_rate,
    avgTradeReturnPct: raw.avg_trade_return_pct,
    totalReturnPct: raw.total_return_pct,
    maxDrawdownPct: raw.max_drawdown_pct,
    profitFactor: raw.profit_factor,
  };
}

export function mapEarningsBacktestResponse(
  raw: RawEarningsBacktestResponse,
): EarningsBacktestResponse {
  return {
    trades: (raw.trades ?? []).map(mapEarningsBacktestTrade),
    skipped: raw.skipped ?? [],
    metrics: mapEarningsBacktestMetrics(raw.metrics),
  };
}

function mapIVTermPoint(raw: RawIVTermPoint): IVTermPoint {
  return { expiry: raw.expiry, dte: raw.dte, atmIv: raw.atm_iv };
}

function mapSkew(raw: RawSkewBlock): SkewBlock {
  return {
    putIv25d: raw.put_iv_25d,
    callIv25d: raw.call_iv_25d,
    skewPoints: raw.skew_points,
    interpretation: raw.interpretation,
  };
}

function mapNewsArticle(raw: RawEarningsNewsArticle): EarningsNewsArticle {
  return {
    title: raw.title,
    source: raw.source,
    publishedAt: raw.published_at,
    url: raw.url,
    // Round-12 / NF-1 — surface stage-1 ranking signals so the UI can
    // render a category chip and sort by relevance.
    relevanceScore: raw.relevance_score ?? 0,
    category: raw.category ?? null,
    tier: raw.tier ?? 2,
    sentiment: raw.sentiment ?? null,
    // B2.1 — sentiment/magnitude/confidence chips.
    magnitude: raw.magnitude ?? null,
    confidence: raw.confidence ?? null,
    // B2.6 — source priority for tier badge.
    sourcePriority: raw.source_priority ?? null,
    // B2.4 — duplicate-count collapse indicator.
    duplicateCount: raw.duplicate_count ?? 0,
  };
}

/**
 * Map the wire-shape detail payload into the UI's `EarningsDetail`.
 *
 * Round-5 (NEW-Y9 / E-15): `errorCodes` is sorted alphabetically
 * client-side. The backend may emit them in race-dependent order (multiple
 * `await` points, gather()) — sorting client-side keeps the partial-data
 * banner stable as the user re-fetches the same symbol. Non-string
 * entries are silently dropped; unknown-but-string codes pass through so
 * the UI can render new codes raw before the literal union is updated.
 *
 * Exported so the apiMappers test can exercise the sort + filter logic
 * without going through `apiFetch`.
 */
export function mapEarningsDetail(raw: RawEarningsDetail): EarningsDetail {
  const rawCodes: unknown = raw.error_codes;
  const codes = Array.isArray(rawCodes)
    ? rawCodes.filter((v): v is string => typeof v === "string")
    : [];
  // Maverick FIX-C: pass through tail_risk fields. Score is nullable so
  // we preserve the null/undefined distinction (undefined = backend did
  // not emit the field; null = explicitly absent — both render as no
  // badge in the panel). Reasons coerced to a string array; non-string
  // entries silently dropped.
  const rawReasons: unknown = raw.tail_risk_reasons;
  const tailRiskReasons = Array.isArray(rawReasons)
    ? rawReasons.filter((v): v is string => typeof v === "string")
    : [];
  return {
    symbol: raw.symbol,
    company: raw.company,
    sector: raw.sector,
    reportDate: raw.report_date,
    reportTime: raw.report_time,
    daysUntil: raw.days_until ?? null,
    ...(raw.report_state !== undefined ? { reportState: raw.report_state } : {}),
    quote: raw.quote
      ? {
          last: raw.quote.last,
          change: raw.quote.change,
          changePct: raw.quote.change_pct,
          timestamp: raw.quote.timestamp,
        }
      : null,
    metrics: raw.metrics ? mapMetrics(raw.metrics) : null,
    strikeLadder: raw.strike_ladder ? mapStrikeLadder(raw.strike_ladder) : null,
    claudeStructured: raw.claude_structured ? mapClaudeStructured(raw.claude_structured) : null,
    claudeFullResearch: raw.claude_full_research ? mapClaudeFullResearch(raw.claude_full_research) : null,
    historicalEarnings: raw.historical_earnings
      ? mapHistoricalBlock(raw.historical_earnings)
      : null,
    ivTermStructure: raw.iv_term_structure ? raw.iv_term_structure.map(mapIVTermPoint) : null,
    skew: raw.skew ? mapSkew(raw.skew) : null,
    news: (raw.news ?? []).map(mapNewsArticle),
    partial: raw.partial,
    generatedAt: raw.generated_at,
    // Round-5 (NEW-Y9 / E-15): copy + sort so the banner stays stable
    // across re-fetches even if backend gather()s the providers in a
    // different order. `slice()` so we don't mutate the wire payload.
    errorCodes: codes.slice().sort() as EarningsErrorCode[],
    // Maverick FIX-C: tail_risk passthrough. Only set when backend
    // emitted the field so older cached responses don't gain a
    // synthetic null in the FE shape.
    ...(raw.tail_risk_score !== undefined ? { tailRiskScore: raw.tail_risk_score } : {}),
    ...(rawReasons !== undefined ? { tailRiskReasons } : {}),
  };
}

/**
 * Fetch the earnings-options-play calendar for the screener.
 * Backend: GET /api/v1/earnings/calendar
 *
 * Accepts an optional `{ signal }` so react-query can cancel in-flight
 * requests when a queryKey becomes stale (B-97).
 */
export async function getEarningsCalendar(
  filters: EarningsCalendarFilters = {},
  opts?: { signal?: AbortSignal },
): Promise<CalendarResponse> {
  const params = new URLSearchParams();
  if (filters.window) params.set("window", filters.window);
  if (filters.minIvRank !== undefined) params.set("min_iv_rank", String(filters.minIvRank));
  // B-66: marketCap dropped — backend now unconditionally applies the
  // curated-universe filter.
  if (filters.bmoAmc) params.set("bmo_amc", filters.bmoAmc);
  if (filters.watchlistOnly) {
    params.set("watchlist_only", "true");
    if (Array.isArray(filters.watchlistSymbols)) {
      params.set("watchlist", normalizeWatchlistQuery(filters.watchlistSymbols).join(","));
    }
  }
  if (filters.sort) params.set("sort", filters.sort);
  const query = params.toString();
  const raw = await apiFetch<RawCalendarResponse>(
    `/api/v1/earnings/calendar${query ? `?${query}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
  return {
    earnings: (raw.earnings ?? []).map(mapCalendarRow),
    generatedAt: raw.generated_at,
    partial: raw.partial,
    error: raw.error ?? null,
    // Iteration 9: pass-through per-symbol validation failures so the
    // sidebar can surface a partial-data banner + per-row issue
    // disclosure. Only emitted when the backend produced any
    // (default_factory=list); we skip the field on empty payloads so
    // consumers can rely on ``Array.isArray(...)`` checks rather than
    // length-zero guards.
    ...(Array.isArray(raw.validation_errors) && raw.validation_errors.length > 0
      ? { validationErrors: raw.validation_errors }
      : {}),
    // Round-4: window-honesty fields. Each is optional on the wire so
    // we pass through `undefined` when the backend hasn't emitted them
    // (older deployments + most existing test fixtures).
    ...(raw.window_start !== undefined ? { windowStart: raw.window_start } : {}),
    ...(raw.window_end !== undefined ? { windowEnd: raw.window_end } : {}),
    ...(raw.window_label !== undefined ? { windowLabel: raw.window_label } : {}),
    ...(raw.meta !== undefined
      ? {
          meta: {
            ...(raw.meta.reason !== undefined ? { reason: raw.meta.reason } : {}),
            ...(raw.meta.before_curated !== undefined
              ? { beforeCurated: raw.meta.before_curated }
              : {}),
          },
        }
      : {}),
  };
}

const WATCHLIST_QUERY_SYMBOL_RE = /^[A-Z]{1,6}(\.[A-Z])?$/;

function normalizeWatchlistQuery(symbols: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const symbol = String(raw).trim().toUpperCase();
    if (!WATCHLIST_QUERY_SYMBOL_RE.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

/**
 * Fetch the detail panel payload for one symbol's earnings.
 * Backend: GET /api/v1/earnings/{symbol}/detail
 *
 * Accepts an optional `{ signal }` so react-query can cancel in-flight
 * requests when the selected symbol changes (B-97).
 */
export async function getEarningsDetail(
  symbol: string,
  opts?: DataFetchOptions,
): Promise<EarningsDetail> {
  const raw = await apiFetch<RawEarningsDetail>(
    `/api/v1/earnings/${encodeURIComponent(symbol)}/detail`,
    opts,
  );
  return mapEarningsDetail(raw);
}

/**
 * T8 (symbol page): fetch the ranked recommended setups list from the
 * single-round-trip earnings analysis endpoint. The full ``EarningsAnalysis``
 * payload is heavy (quote, IV, news, history, claude); the symbol page only
 * consumes ``top_setups`` so we narrow to that field rather than mapping the
 * whole shape. 404 from the curated-universe gate must be caught at the call
 * site (mirrors getEarningsDetail).
 *
 * Backend: GET /api/v1/earnings/{symbol}/analysis?setups=3
 */
export async function getRecommendedSetups(
  symbol: string,
  opts?: DataFetchOptions & { setups?: number },
): Promise<EarningsSetup[]> {
  const setups = opts?.setups ?? 3;
  const raw = await apiFetch<{ top_setups?: unknown }>(
    `/api/v1/earnings/${encodeURIComponent(symbol)}/analysis?setups=${setups}&news_limit=0`,
    {
      signal: opts?.signal,
      suppressAuthRedirect: opts?.suppressAuthRedirect,
      suppressGlobalError: opts?.suppressGlobalError,
      timeoutMs: opts?.timeoutMs,
    },
  );
  if (!Array.isArray(raw.top_setups)) return [];
  return (raw.top_setups as unknown[])
    .map(mapEarningsSetup)
    .filter((s): s is EarningsSetup => s !== null);
}

/**
 * Trigger the on-demand Claude Opus full research note.
 * Backend: POST /api/v1/earnings/{symbol}/full-research
 * Rate-limited per user (~30/5min via backend middleware).
 */
export async function postEarningsFullResearch(symbol: string): Promise<ClaudeFullResearch> {
  // Round-12 / CL-1 (P1): bumped FE timeout 60_000 → 120_000.
  // The backend ``ClaudeClient.complete`` default timeout is 60.0s; with
  // identical client + server budgets the browser would `AbortError` before
  // the 500/200 response landed on slow Opus tail latencies (30-60s typical,
  // 60-90s tail). The mutation rejected with a generic abort and the user
  // saw the spinner spin forever. Doubling the FE budget gives the backend
  // breathing room to either return a useful error or the research itself.
  const raw = await apiFetch<RawClaudeFullResearch>(
    `/api/v1/earnings/${encodeURIComponent(symbol)}/full-research`,
    { method: "POST", timeoutMs: 120_000, suppressGlobalError: true },
  );
  return mapClaudeFullResearch(raw);
}

export async function postEarningsBacktest(
  request: EarningsBacktestRequest,
  opts?: { signal?: AbortSignal },
): Promise<EarningsBacktestResponse> {
  const init: ApiFetchOptions = {
    method: "POST",
    timeoutMs: 30_000,
    body: JSON.stringify({
      events: request.events.map((event) => ({
        symbol: event.symbol,
        report_date: event.reportDate,
        top_setup: event.topSetup,
        expected_move_pct: event.expectedMovePct,
        realized_move_pct: event.realizedMovePct,
        ...(event.premiumYieldCallAtm !== undefined
          ? { premium_yield_call_atm: event.premiumYieldCallAtm }
          : {}),
        ...(event.premiumYieldPutAtm !== undefined
          ? { premium_yield_put_atm: event.premiumYieldPutAtm }
          : {}),
        ...(event.edgeScore !== undefined ? { edge_score: event.edgeScore } : {}),
      })),
      ...(request.minEdgeScore !== undefined ? { min_edge_score: request.minEdgeScore } : {}),
      ...(request.maxEvents !== undefined ? { max_events: request.maxEvents } : {}),
      risk_fraction: request.riskFraction ?? 0.01,
    }),
  };
  if (opts?.signal) init.signal = opts.signal;
  const raw = await apiFetch<RawEarningsBacktestResponse>(
    "/api/v1/earnings/backtest",
    init,
  );
  return mapEarningsBacktestResponse(raw);
}

export async function getPipelinePositions(): Promise<{ positions: PipelinePosition[]; performance: PipelinePerformance }> {
  const resp = await apiFetch<{ open_positions: Record<string, unknown>[]; performance: Record<string, unknown> }>('/api/v1/pipeline/positions');
  const perf = resp.performance ?? {};
  const bestTrade = asPipelineRecord(perf.best_trade);
  const worstTrade = asPipelineRecord(perf.worst_trade);
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
      bestTrade: Object.keys(bestTrade).length
        ? { symbol: asString(bestTrade.symbol), pnl: asNumber(bestTrade.pnl) }
        : null,
      worstTrade: Object.keys(worstTrade).length
        ? { symbol: asString(worstTrade.symbol), pnl: asNumber(worstTrade.pnl) }
        : null,
    },
  };
}

// ============================================================
// Admin Control Center — provider-agnostic key rotation, layout
// config, and a deploy trigger. Backend routes self-gate via
// require_admin (mutating calls) or require_auth (layout GET).
// ============================================================

export interface AdminBackendKey {
  label: string;
  key: string;
  set: boolean;
  masked: string;
}

export async function getAdminBackendKeys(): Promise<AdminBackendKey[]> {
  const resp = await apiFetch<{ keys: AdminBackendKey[] }>(
    "/api/v1/admin/control-center/keys",
  );
  return resp.keys ?? [];
}

export async function patchAdminBackendKeys(
  body: { set?: Record<string, string>; clear?: string[] },
): Promise<AdminBackendKey[]> {
  const resp = await apiFetch<{ keys: AdminBackendKey[] }>(
    "/api/v1/admin/control-center/keys",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ set: body.set ?? {}, clear: body.clear ?? [] }),
    },
  );
  return resp.keys ?? [];
}

export interface LayoutSection {
  id: string;
  visible: boolean;
  order: number;
}

export interface LayoutConfig {
  dashboard_sections: LayoutSection[];
  version?: number;
}

export async function getLayoutConfig(): Promise<LayoutConfig> {
  return apiFetch<LayoutConfig>("/api/v1/admin/control-center/layout", { suppressGlobalError: true });
}

export async function patchLayoutConfig(
  config: Pick<LayoutConfig, "dashboard_sections">,
): Promise<LayoutConfig> {
  return apiFetch<LayoutConfig>("/api/v1/admin/control-center/layout", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export interface DeployResult {
  ok: boolean;
  ref?: string;
  triggered_at?: string;
  html_url?: string | null;
}

export async function triggerDeploy(): Promise<DeployResult> {
  return apiFetch<DeployResult>("/api/v1/admin/control-center/deploy", {
    method: "POST",
  });
}

export async function getLastDeploy(): Promise<DeployResult & { actor?: string | null }> {
  return apiFetch<DeployResult & { actor?: string | null }>(
    "/api/v1/admin/control-center/deploy/last",
  );
}

// ─── Slippage analytics (M-O S) ─────────────────────────────

/** Per-bucket slippage roll-up — used for the by-strategy / by-structure
 * tables and the patient-vs-immediate comparison block. Mirrors
 * ``services.slippage_analytics.SlippageBreakdown`` on the backend. */
export interface SlippageBreakdown {
  trades: number;
  avg_slippage_pct: number | null;
  median_slippage_pct: number | null;
  p90_slippage_pct: number | null;
  total_dollars_leaked: number;
}

/** Top-level execution-quality response. ``slippage_pct`` values are
 * fractional (0.025 = 2.5%). Positive percentages mean the trader did
 * WORSE than mid (paid more than mid as a buyer, collected less than
 * mid as a seller). ``total_dollars_leaked`` is always positive (sum
 * of |actual - target| × qty × multiplier). */
export interface SlippageSummary {
  total_trades: number;
  avg_slippage_pct: number | null;
  median_slippage_pct: number | null;
  p90_slippage_pct: number | null;
  total_dollars_leaked: number;
  by_strategy: Record<string, SlippageBreakdown>;
  by_structure_type: Record<string, SlippageBreakdown>;
  fill_mode_comparison: Record<string, SlippageBreakdown>;
  trades_without_target: number;
}

export async function getSlippageSummary(opts?: {
  startDate?: string;
  endDate?: string;
  strategy?: string;
}): Promise<SlippageSummary> {
  const params = new URLSearchParams();
  if (opts?.startDate) params.set("start_date", opts.startDate);
  if (opts?.endDate) params.set("end_date", opts.endDate);
  if (opts?.strategy) params.set("strategy", opts.strategy);
  const qs = params.toString();
  return apiFetch<SlippageSummary>(
    `/api/v1/analytics/slippage${qs ? `?${qs}` : ""}`,
  );
}
