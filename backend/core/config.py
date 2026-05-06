from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class Settings(BaseSettings):
    """AlphaDesk application configuration.

    All values can be overridden via environment variables or a .env file
    placed in the project root.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application ---
    APP_NAME: str = "AlphaDesk"
    # Default to PROD — the safer default. A forgotten ENVIRONMENT=prod in a
    # prod deploy previously meant /docs was live and cookies weren't Secure.
    # Developers must explicitly opt into dev mode via ENVIRONMENT=dev.
    ENVIRONMENT: Environment = Environment.PROD
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # --- Database ---
    DATABASE_URL: str = "postgresql+asyncpg://alphadesk:alphadesk_dev@localhost:5432/alphadesk"

    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- Market Data Providers ---
    POLYGON_API_KEY: SecretStr = SecretStr("")
    FMP_API_KEY: SecretStr = SecretStr("")
    THETA_DATA_API_KEY: SecretStr = SecretStr("")
    UNUSUAL_WHALES_API_KEY: SecretStr = SecretStr("")

    # --- Broker: Alpaca ---
    ALPACA_API_KEY: SecretStr = SecretStr("")
    ALPACA_SECRET_KEY: SecretStr = SecretStr("")
    ALPACA_BASE_URL: str = "https://paper-api.alpaca.markets"
    # Batch W (audit-reports/2026-05-05/HARDCODING-SWEEP.md C-1/C-2):
    # canonical Alpaca hostnames used by broker_connections / market-data
    # layers. Override via env when routing through a proxy / sandbox so a
    # host change is one PR.
    ALPACA_PAPER_BASE_URL: str = "https://paper-api.alpaca.markets"
    ALPACA_LIVE_BASE_URL: str = "https://api.alpaca.markets"
    ALPACA_DATA_BASE_URL: str = "https://data.alpaca.markets"
    # Toggle the broker trade_updates WebSocket subscription in
    # ``data/ingestion/alpaca_stream.py``. When True the backend opens a
    # second Alpaca WS connection and publishes fill / cancel / reject
    # events to Redis channel ``trade_updates``. Safe kill-switch if the
    # broker side misbehaves without redeploying (persona-r P27/P43).
    ALPACA_TRADE_UPDATES_ENABLED: bool = True
    # Wave-A bypass-path fix: LIVE_TRADING_ENABLED is the operator's *intent*
    # signal. The trading-gate (``core.trading_gate.reject_if_live_forbidden``)
    # only fires when ``LIVE_TRADING_ENABLED`` is True AND the base URL points
    # at the live broker. Defaults False so an operator who forgets to flip the
    # env var on a deploy never accidentally routes denylisted strategies to
    # live capital. ``assert_live_enabled_or_paper()`` is called at startup to
    # catch the inverse misconfig (URL says live but env says paper, or vice
    # versa).
    LIVE_TRADING_ENABLED: bool = False

    # --- Broker: Interactive Brokers ---
    IB_HOST: str = "127.0.0.1"
    IB_PORT: int = 7497
    IB_CLIENT_ID: int = 1

    # --- Broker: E*TRADE (Batch W — C-3) ---
    ETRADE_LIVE_BASE_URL: str = "https://api.etrade.com"
    ETRADE_SANDBOX_BASE_URL: str = "https://apisb.etrade.com"

    # --- Broker: Schwab (Batch W — C-4) ---
    SCHWAB_API_BASE_URL: str = "https://api.schwabapi.com"

    # --- Market data providers (Batch W — C-5 + sweep) ---
    # Polygon REST host. /v1, /v2, /v3 prefix lives at the call site so
    # multi-version routes don't fork on env. FMP host shared by /api/v3
    # (legacy) and /stable mounts; callers append the version. NewsData.io
    # centralised for operator overrides. Anthropic surfaced for parity if
    # a custom proxy is required.
    POLYGON_BASE_URL: str = "https://api.polygon.io"
    FMP_BASE_URL: str = "https://financialmodelingprep.com"
    NEWSDATA_BASE_URL: str = "https://newsdata.io/api/1"
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com"

    # --- AI ---
    ANTHROPIC_API_KEY: SecretStr = SecretStr("")
    # Claude runtime used by BaseAgent chat/analysis paths:
    #   auto -> Anthropic API when ANTHROPIC_API_KEY is set, otherwise CLI
    #   api  -> require Anthropic API key
    #   cli  -> require local Claude CLI
    CLAUDE_BACKEND: str = "auto"
    # Raw Anthropic request/response JSONL audit trail. Disabled by default
    # because prompts can contain account, order, and user context.
    CLAUDE_AUDIT_LOG_ENABLED: bool = False
    CLAUDE_AUDIT_LOG_DIR: str = "logs/claude"
    CLAUDE_AUDIT_LOG_MAX_CHARS: int = 200_000

    # --- TradingAgents research desk ---
    # Open-source TradingAgents is integrated as an external research artifact
    # generator, not as an executable strategy. The API launches the stable
    # skill wrapper and stores only sanitized report excerpts for the UI.
    TRADINGAGENTS_ENABLED: bool = True
    TRADINGAGENTS_SCRIPT_PATH: str = ""
    TRADINGAGENTS_SKILL_HOME: str = ""
    TRADINGAGENTS_PROVIDER: str = "anthropic"
    TRADINGAGENTS_DEEP_MODEL: str = "claude-sonnet-4-6"
    TRADINGAGENTS_QUICK_MODEL: str = "claude-haiku-4-5"
    TRADINGAGENTS_OUTPUT_LANGUAGE: str = "English"
    # Minimum subprocess timeout. The TradingAgents service raises the
    # effective run budget for full analyst/deeper graphs.
    TRADINGAGENTS_TIMEOUT_S: int = 900
    TRADINGAGENTS_HISTORY_LIMIT: int = 20
    TRADINGAGENTS_MAX_DECISION_CHARS: int = 16_000
    TRADINGAGENTS_RUNS_PER_HOUR: int = 12
    OPENAI_API_KEY: SecretStr = SecretStr("")
    GOOGLE_API_KEY: SecretStr = SecretStr("")
    XAI_API_KEY: SecretStr = SecretStr("")
    OPENROUTER_API_KEY: SecretStr = SecretStr("")
    DEEPSEEK_API_KEY: SecretStr = SecretStr("")
    DASHSCOPE_API_KEY: SecretStr = SecretStr("")
    ZHIPU_API_KEY: SecretStr = SecretStr("")
    AZURE_OPENAI_API_KEY: SecretStr = SecretStr("")

    # --- News ---
    NEWSDATA_API_KEY: SecretStr = SecretStr("")

    # --- Notifications ---
    TELEGRAM_BOT_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_CHAT_ID: str = ""
    DISCORD_WEBHOOK_URL: SecretStr = SecretStr("")

    # --- Oncall alert dispatcher (audit P0-5, 2026-05-05) ---
    # Generic webhook-based dispatcher (``services.alerts.fire_alert``)
    # routes alerts by severity. Empty strings = destination disabled
    # (silently skipped). See ``docs/RUNBOOK-alerts.md`` for severity
    # meanings and SLAs. ``ALERT_DISCORD_WEBHOOK_URL`` falls back to the
    # legacy ``DISCORD_WEBHOOK_URL`` when unset, so existing deploys
    # don't have to be re-configured to keep Discord working.
    ALERT_PAGERDUTY_INTEGRATION_KEY: SecretStr = SecretStr("")  # PagerDuty Events API v2 integration key
    ALERT_DISCORD_WEBHOOK_URL: SecretStr = SecretStr("")        # Optional override; falls back to DISCORD_WEBHOOK_URL
    ALERT_SLACK_WEBHOOK_URL: SecretStr = SecretStr("")          # Optional Slack incoming webhook
    ALERT_GENERIC_WEBHOOK_URL: SecretStr = SecretStr("")        # Optional generic POST endpoint
    ALERT_DEDUP_WINDOW_SECONDS: int = 900                       # 15 min dedup window

    # --- Webhooks ---
    TRADINGVIEW_WEBHOOK_SECRET: SecretStr = SecretStr("")

    # --- Dev settings ---
    SKIP_DB_INIT: bool = False

    # --- Auth ---
    JWT_SECRET: SecretStr = SecretStr("")
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""  # bcrypt hash
    # Audit P2-03 (2026-05-05): lowered from 480 (8h) to 60 (1h) to shrink
    # the stolen-token replay window. The refresh-token flow in
    # ``backend/api/routes/auth.py`` (``/refresh`` endpoint with HttpOnly
    # cookie + Redis replay detection + concurrent-refresh race lock) is
    # already exercised by the browser path on every cookie expiry, so the
    # session continuity guarantee is unchanged from the user's
    # perspective: the access-token cookie silently rotates every hour.
    # CLI / iOS callers receive ``expires_in`` in the login response and
    # are expected to rotate against ``/api/v1/auth/refresh`` themselves.
    # Refresh tokens still live 30 days — a continuously-active session
    # remains seamless; only an idle-then-resumed session forces a
    # re-login after the refresh token finally expires.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # 32+ random bytes recommended. Used to derive the AES-256-GCM key that
    # encrypts user-supplied brokerage credentials at rest.
    BROKER_CREDENTIAL_ENCRYPTION_KEY: SecretStr = SecretStr("")

    # --- Production ---
    PRODUCTION_ORIGIN: str = ""  # e.g. "https://alphadesk.example.com"

    # --- WebSocket capacity (Round 7 Fix 1 — P127) ---
    # Hard caps so a burst of 10k clients cannot exhaust kernel FDs. The
    # ConnectionManager consults these on register() and rejects new
    # connections with close-code 4008 ("policy violation") once the total
    # or per-user ceiling is hit. Generous per-user budget — a single
    # operator runs the desk in 1-3 tabs, 5 leaves headroom for odd
    # devtools reconnect churn. Total is sized for our current single-VPS
    # target; bump in env if the deployment footprint grows.
    WS_MAX_TOTAL: int = 500
    WS_MAX_PER_USER: int = 5

    # --- Market read-path rate limit (Round 7 Fix 2 — P127) ---
    # Per-IP request budget for the heavy public-ish market routes
    # (quotes / snapshot / bars). The backend can't install the
    # caddy-ratelimit plugin in place, so we do an application-layer cap
    # keyed on Redis INCR against ``market_rl:{ip}:{minute_bucket}``.
    # Unauth callers get 10/sec; authed callers get 20/sec to cover
    # watchlist refresh + chart pans without papering. Fails open on
    # Redis outage — these are read-only paths, blocking them
    # indiscriminately would make a Redis blip a full market-data
    # blackout.
    MARKET_RL_UNAUTH_PER_MIN: int = 600
    MARKET_RL_AUTH_PER_MIN: int = 1200

    # --- Earnings screener knobs (Wave B-85) ---
    # Hard cap on how many calendar rows the /earnings/calendar endpoint
    # hydrates and returns. At the curated-universe default this is rarely
    # binding (≤10 tradeable names per week typical), but protects us on
    # weeks where many mega caps report in parallel — each row fans out to
    # Alpaca chain + IV + Claude, so uncapped parallelism eats the
    # provider budgets fast.
    EARNINGS_CALENDAR_MAX_ROWS: int = 16
    # Per-request concurrency cap on per-symbol hydration fan-out. Alpaca's
    # rate limit is ~200 req/min across the whole backend, so 10 in-flight
    # hydrations keeps headroom for the rest of the app.
    EARNINGS_HYDRATE_CONCURRENCY: int = 10
    # TTL (hours) for the cached Claude structured verdict per
    # symbol+report_date. 4h is short enough that the verdict refreshes
    # intra-day as news breaks, long enough that screener scrolls don't
    # re-prompt Claude on every tab-focus.
    EARNINGS_CLAUDE_STRUCTURED_TTL_HOURS: int = 4
    # Timeout (seconds) for the upstream FMP earnings-calendar fetch.
    # Below 5s FMP returns 504s during earnings-heavy windows; above 5s
    # the /earnings/calendar p95 degrades visibly on the UI side.
    EARNINGS_FMP_TIMEOUT_S: float = 5.0
    # Optional operator-curated earnings timing feed. The FMP stable
    # calendar often returns ``time=null``; PEAD needs AMC/BMO to place
    # next-session vs same-session entries correctly. Point this at a CSV
    # or JSON file with symbol,date,announcement_when/report_time/time fields
    # from a vendor such as EarningsWhispers/Polygon/Benzinga.
    EARNINGS_TIME_SOURCE_PATH: str = ""

    # --- Round-5 Cluster A G-15: earnings watchlist filter ---
    # Comma-separated list of tickers that the earnings calendar
    # ``watchlist_only=true`` flag uses as the filter set. This is a
    # placeholder until per-user watchlists are threaded through the auth
    # context — when that lands, the screener will read the user's
    # personal list instead. Sensible default of mega caps so the flag
    # has visible behaviour out of the box.
    WATCHLIST_DEFAULT_SYMBOLS: str = "AAPL,MSFT,NVDA,TSLA,GOOGL,META,AMZN"

    # --- Round-5 Cluster D H-2: Claude spend kill-switch ---
    # Per-day USD ceiling on cross-user Claude spend. Tracked in Redis
    # under ``claude:spend:{utc_date}``; per-call estimates are added
    # before the request fires and reconciled against the actual cost
    # afterwards. When ``current_spend`` exceeds the budget AND the
    # kill-switch is enabled, the next call raises ``ClaudeBudgetExceeded``
    # instead of going to Anthropic. Operators can halt the gate at any
    # time by writing a sentinel value into the day key
    # (``SET claude:spend:{date} 999999``) — see notes in
    # :mod:`agents.claude_client`.
    # Phase-2 / EP-2 (per user directive 2026-04-26): bump the daily
    # Claude budget from $100 → $5,000 so the kill-switch never trips
    # in practice — the user wants Claude analysis available at all
    # times. Operators can still set a hard ceiling via the env var
    # ``CLAUDE_DAILY_BUDGET_USD=…`` if cost concerns return; and the
    # kill-switch can be flipped off entirely by setting
    # ``CLAUDE_BUDGET_KILL_SWITCH_ENABLED=False``.
    CLAUDE_DAILY_BUDGET_USD: float = 5000.0
    CLAUDE_BUDGET_KILL_SWITCH_ENABLED: bool = False

    # --- Round-5 Cluster E E-6: test-mode FMP cache bypass ---
    # When True, ``services.earnings_screener._fmp_upcoming`` skips its
    # per-window dedup lock + cache. Set to True from
    # ``backend/tests/conftest.py`` so concurrent test runs don't share a
    # stale cached response. Replaces the previous PYTEST_CURRENT_TEST
    # env-var heuristic — the env-var could leak into prod (e.g. someone
    # sourcing a dev .env), and a quiet behaviour change in prod is much
    # worse than a noisier explicit setting.
    SKIP_EARNINGS_FMP_CACHE: bool = False

    # --- Earnings IV regime thresholds (Batch U — A-1, A-2) ---
    # Centralised so ops can tune the regime breakpoints without a code
    # deploy. The screener / recommender use these to flip directional
    # vs short-premium framing on iv_rank. Defaults preserve historic
    # behaviour: ≥70 = "rich vol" (favor short premium), ≤35 = "cheap
    # vol" (favor long premium / debit setups).
    EARNINGS_IV_RICH_THRESHOLD: float = 70.0
    EARNINGS_IV_CHEAP_THRESHOLD: float = 35.0

    # --- Recommender strike selection (Batch M-O — strike-tuning ST) ---
    # DTE/confidence/IV-aware delta tables for credit/debit setups.
    # Backed by TastyTrade Research and Sosnoff/Battista backtests:
    # earnings (DTE ≤ 10) iron condors maximise win-rate × avg-credit at
    # 0.16Δ shorts (vs the standard 0.20Δ); long-dated (DTE > 35) widen
    # to 0.25Δ for more credit. Wings track at half the short delta so
    # the wing/short ratio holds across regimes.
    RECOMMENDER_IRON_CONDOR_SHORT_DELTA_EARNINGS: float = 0.16
    RECOMMENDER_IRON_CONDOR_SHORT_DELTA_STANDARD: float = 0.20
    RECOMMENDER_IRON_CONDOR_SHORT_DELTA_LONG_DATED: float = 0.25
    RECOMMENDER_IRON_CONDOR_LONG_DELTA_EARNINGS: float = 0.08
    RECOMMENDER_IRON_CONDOR_LONG_DELTA_STANDARD: float = 0.10
    RECOMMENDER_IRON_CONDOR_LONG_DELTA_LONG_DATED: float = 0.12
    # DTE breakpoints between the three regimes above.
    RECOMMENDER_DTE_EARNINGS_MAX: int = 10
    RECOMMENDER_DTE_STANDARD_MAX: int = 35
    # When Claude confidence is below LOW threshold we widen strikes by
    # multiplying the standard delta by WIDEN_FACTOR (0.7 → 0.20*0.7 = 0.14).
    # When confidence is above HIGH threshold we tighten back to the
    # baseline (no widening). Iron-butterfly is suppressed below LOW.
    RECOMMENDER_LOW_CONFIDENCE_THRESHOLD: float = 0.55
    RECOMMENDER_HIGH_CONFIDENCE_THRESHOLD: float = 0.75
    RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR: float = 0.7
    # IV-rank thresholds for strike adjustments. Above HIGH (rich vol)
    # we tighten slightly (more credit); below LOW (cheap vol) we widen
    # so the recommender prefers long-vol structures over thin credit.
    RECOMMENDER_IV_RANK_HIGH_THRESHOLD: float = 80.0
    RECOMMENDER_IV_RANK_LOW_THRESHOLD: float = 30.0
    RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR: float = 1.10
    RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR: float = 0.85

    # --- Claude Opus per-call cost estimate (Batch U — A-3) ---
    # Used solely for cost-ceiling telemetry; tracks Anthropic pricing.
    CLAUDE_OPUS_COST_PER_CALL_USD: float = 0.30

    # --- FMP cache TTLs (Batch U — A-4, A-5) ---
    FMP_CALENDAR_CACHE_TTL_SECONDS: int = 300
    FMP_RESCUE_CACHE_TTL_SECONDS: int = 300

    # --- Rate-limit caps (Batch U — A-6 through A-9) ---
    RATE_LIMIT_FULL_RESEARCH_MAX: int = 5
    RATE_LIMIT_FULL_RESEARCH_WINDOW_SECONDS: float = 600.0
    RATE_LIMIT_DETAIL_MAX: int = 30
    RATE_LIMIT_DETAIL_WINDOW_SECONDS: float = 600.0
    RATE_LIMIT_ANALYSIS_PER_IP: int = 30
    RATE_LIMIT_ANALYSIS_PER_IP_WINDOW_SECONDS: float = 60.0
    RATE_LIMIT_ANALYSIS_GLOBAL: int = 100
    RATE_LIMIT_ANALYSIS_GLOBAL_WINDOW_SECONDS: float = 60.0

    # --- Greek-calculation risk-free rate (Batch U — A-21) ---
    GREEK_CALCULATION_RISK_FREE_RATE: float = 0.05

    # --- Earnings prewarm scheduler knobs (Batch U / R follow-up) ---
    PREWARM_ENABLED: bool = True
    PREWARM_CLAUDE_ENABLED: bool = True


    # --- Compliance (Wave 2H — persona 76 P76-7) ---
    # Operator-owned deny-list. Populated either inline (comma-separated) or
    # via a file path. Both sources union together at ``core.compliance``
    # import and the resulting frozenset gates every order path (HTTP,
    # master_agent routing, realtime scanner). Empty default so the gate
    # only fires when the operator opts in.
    RESTRICTED_SYMBOLS: str = ""  # e.g. "GME,AMC,BBBY"
    RESTRICTED_SYMBOLS_FILE: str = ""  # path to YAML/JSON list (optional)

    # Audit Persona F4.2 / Layer-2 follow-up (2026-05-05): per-strategy
    # capital allocation for the kill-switch daily-PnL gate. JSON map
    # of canonical strategy name → dollar floor. Override via env:
    #   STRATEGY_ALLOC_CAPITAL='{"momentum_quality": 50000, "pead": 25000}'
    # Or via PATCH /api/v1/admin/strategy-alloc-capital at runtime.
    # Strategies absent from the map use STRATEGY_ALLOC_CAPITAL_DEFAULT
    # ($100k). 0 disables Layer 2 for that strategy.
    STRATEGY_ALLOC_CAPITAL: dict[str, float] = {}
    # Per-strategy kill-switch threshold overrides — negative fractions
    # (e.g. -0.10 = -10%). Layer 1 = drawdown from peak NAV. Layer 2 =
    # realized_today / alloc_capital. Strategies absent from a map fall
    # back to the system-wide defaults defined below. Override via env
    # JSON or PATCH /api/v1/trades/strategy-kill-switch-thresholds.
    STRATEGY_LAYER1_THRESHOLD: dict[str, float] = {}
    STRATEGY_LAYER2_THRESHOLD: dict[str, float] = {}

    # SHF-2 (audit 2026-05-05 P0-4): per-trade max-loss gate as a fraction
    # of current account equity. The existing $50k absolute notional cap
    # (TRADES_PER_ORDER_NOTIONAL_CAP) does NOT prevent a $48k iron-condor
    # max-loss against a $100k account (= 48% of book in one trade).
    # Default 5% — enough headroom for a 1-contract iron condor on a
    # $100k book while still rejecting a 5-contract version that would
    # eat half the account. Admins can override per-deploy via env or
    # bypass per-order with ``?override_size_limit=true`` on POST /orders.
    MAX_LOSS_PER_TRADE_PCT_OF_EQUITY: float = 0.05

    # --- Derived helpers ---
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == Environment.PROD

    @property
    def sync_database_url(self) -> str:
        return self.DATABASE_URL.replace("+asyncpg", "")

    @property
    def jwt_secret_value(self) -> str:
        """Return the JWT signing secret.

        Hard-fails in ALL environments if unset. There is no legitimate reason
        to run WITHOUT a secret, and shipping a hardcoded fallback ("known-
        insecure") meant that anyone who started the backend with
        ENVIRONMENT=dev in production would sign tokens with a publicly-known
        key (reproducible auth bypass). Dev and CI must provide a secret via
        `.env.local` or `JWT_SECRET` env var. Generate one with:
            openssl rand -hex 32
        """
        val = self.JWT_SECRET.get_secret_value()
        if not val:
            raise ValueError(
                "JWT_SECRET must be set. Generate one with: openssl rand -hex 32"
            )
        return val


settings = Settings()


# ---------------------------------------------------------------------------
# Live-trading allowlist / denylist (Wave 4 — audit-reports
# /00-strategy-experts-consolidation.md §4 "Hard lockouts / flags").
# ---------------------------------------------------------------------------
# Central source of truth for the two runtime gates a strategy can carry at
# the routing layer. Keys use the registry's underscore names (the ones the
# strategy classes register under) — the catalog layer maps to the hyphen ids
# the frontend speaks, so both consumers agree.
#
# STRATEGY_LIVE_DISABLED — strategy is structurally unfit for live capital
#   until the P0 defects from its expert audit land. Catalog-visible with a
#   NOT-READY badge; ``create_order`` rejects with 422 if the Alpaca base URL
#   points at a live endpoint. Paper routing remains allowed.
#
#   Round-6 / I-2: this set is auto-derived from the strategy registry — any
#   strategy registered with ``StrategyMeta.kind == "research"`` is structurally
#   unfit for live capital (research stubs emit no executable signals or are
#   pending data/execution integration).
#
# STRATEGY_PAPER_ONLY — strategy is implementation-complete but statistically
#   thin. Route to Alpaca paper only. ``create_order`` rejects with 422 when
#   the Alpaca base URL is a live endpoint.
#
#   ``earnings_options_play`` is research-only by product design (decision-
#   support screener, no auto-execution path) — keep it on the paper-only set
#   as belt-and-suspenders so a catalog regression that flips it to live still
#   cannot route real capital.
def _derive_live_disabled_from_registry() -> set[str]:
    """Return canonical names of strategies registered with ``kind="research"``.

    Imports the strategy package lazily and tolerates an empty registry
    (e.g. partial test fixtures that haven't called ``load_all``). The
    seed below ensures research-only entries stay denied even when
    registration has not happened.

    The trading-gate keys ``STRATEGY_LIVE_DISABLED`` membership on the
    canonical underscore form; some strategies (currently
    ``earnings-options-play``) register under their hyphenated route id
    so we normalise both forms into the set so a lookup with either
    spelling hits.
    """
    seeds: set[str] = {
        "earnings-options-play",
        "earnings_options_play",
        "trading-agents-research",
        "trading_agents_research",
    }
    try:
        # Lazy import — ``core.config`` is loaded very early, before
        # ``strategies`` is on the import path in some shells.
        from strategies.registry import list_strategies, load_all

        try:
            load_all()
        except Exception:
            # If registration fails (test stubbing, missing optional
            # deps), fall through to whatever is already in the registry.
            pass
        for meta in list_strategies():
            if getattr(meta, "kind", "autonomous") == "research":
                seeds.add(meta.name)
                # Also store the underscored form so the gate matches
                # whether the caller passes the hyphen route id or the
                # canonical Python name.
                seeds.add(meta.name.replace("-", "_"))
    except Exception:
        # core.config must remain importable in every context — a missing
        # registry import never blocks startup.
        pass
    return seeds


STRATEGY_LIVE_DISABLED: set[str] = _derive_live_disabled_from_registry()
STRATEGY_PAPER_ONLY: set[str] = {
    "kama_breakout",
    "orb",
    "vwap",
    "earnings_options_play",
    "trading_agents_research",
}


# Audit Persona F4.2 / kill-switch Layer-2 follow-up (2026-05-05):
# Per-strategy capital allocation, used by the Layer-2 daily-PnL gate.
# When realized_today / alloc_capital <= -2% (default) the kill-switch
# auto-disables the strategy for the rest of the session.
#
# User-configurable via the ``STRATEGY_ALLOC_CAPITAL`` env var (JSON
# map, e.g. ``{"momentum_quality": 50000, "pead": 25000}``) and the
# ``GET/PATCH /api/v1/admin/strategy-alloc-capital`` endpoint (admin
# only; persists to Redis with a Postgres fallback).
#
# A value of 0 (or missing entry) disables Layer 2 for that strategy
# — the gate's existing "no ratio definable" short-circuit takes over.
# Sensible default: every strategy gets $100k allocated, matching the
# paper-account default capital.
STRATEGY_ALLOC_CAPITAL_DEFAULT: float = 100_000.0


# Process-local in-memory overlay map populated by the
# admin/strategy-alloc-capital PATCH endpoint. Wins over env config so
# operators can tune Layer-2 thresholds at runtime without a deploy.
# A separate Redis-backed read in the resolver below would survive
# process restarts; the in-memory overlay covers the common case
# (single-worker gunicorn, fast iteration during incident response).
_STRATEGY_ALLOC_CAPITAL_OVERLAY: dict[str, float] = {}


def set_strategy_alloc_capital_overlay(strategy: str, value: float) -> None:
    """Set or clear an in-memory alloc-capital override for ``strategy``.

    Pass ``value < 0`` to clear the overlay and fall back to env config.
    The kill-switch reads the overlay first via
    :func:`get_strategy_alloc_capital`, so changes take effect on the
    next pipeline tick.
    """
    if value < 0:
        _STRATEGY_ALLOC_CAPITAL_OVERLAY.pop(strategy, None)
        return
    _STRATEGY_ALLOC_CAPITAL_OVERLAY[strategy] = float(value)


def get_strategy_alloc_capital_overlay() -> dict[str, float]:
    """Return a snapshot of the active in-memory overlay (for /GET)."""
    return dict(_STRATEGY_ALLOC_CAPITAL_OVERLAY)


def get_strategy_alloc_capital(strategy: str) -> float:
    """Return the alloc-capital floor for ``strategy`` (canonical name).

    Resolution order:
      1. In-memory overlay set via the admin endpoint.
      2. ``settings.STRATEGY_ALLOC_CAPITAL`` (JSON env var).
      3. ``STRATEGY_ALLOC_CAPITAL_DEFAULT`` ($100k).

    Returns 0.0 when the operator has explicitly set the strategy's
    alloc to 0 — the kill-switch's ``alloc_capital <= 0`` short-circuit
    then disables Layer 2.
    """
    if strategy in _STRATEGY_ALLOC_CAPITAL_OVERLAY:
        return float(_STRATEGY_ALLOC_CAPITAL_OVERLAY[strategy])
    try:
        raw = settings.STRATEGY_ALLOC_CAPITAL or {}
    except Exception:
        return STRATEGY_ALLOC_CAPITAL_DEFAULT
    if not isinstance(raw, dict):
        return STRATEGY_ALLOC_CAPITAL_DEFAULT
    val = raw.get(strategy)
    if val is None:
        return STRATEGY_ALLOC_CAPITAL_DEFAULT
    try:
        return float(val)
    except (TypeError, ValueError):
        return STRATEGY_ALLOC_CAPITAL_DEFAULT


# Per-strategy kill-switch threshold defaults + overlays. Same pattern
# as alloc_capital above: in-memory operator overlay > env JSON > default.
# Negative fractions (e.g. -0.08 = -8%).
STRATEGY_LAYER1_THRESHOLD_DEFAULT: float = -0.08  # -8% drawdown from peak
STRATEGY_LAYER2_THRESHOLD_DEFAULT: float = -0.02  # -2% realized / alloc

_STRATEGY_LAYER1_THRESHOLD_OVERLAY: dict[str, float] = {}
_STRATEGY_LAYER2_THRESHOLD_OVERLAY: dict[str, float] = {}


def _resolve_strategy_threshold(
    strategy: str,
    overlay: dict[str, float],
    env_attr: str,
    default: float,
) -> float:
    if strategy in overlay:
        return float(overlay[strategy])
    try:
        raw = getattr(settings, env_attr, None) or {}
    except Exception:
        return default
    if not isinstance(raw, dict):
        return default
    val = raw.get(strategy)
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def get_strategy_layer1_threshold(strategy: str) -> float:
    """Per-strategy Layer-1 (drawdown) threshold. Negative fraction."""
    return _resolve_strategy_threshold(
        strategy,
        _STRATEGY_LAYER1_THRESHOLD_OVERLAY,
        "STRATEGY_LAYER1_THRESHOLD",
        STRATEGY_LAYER1_THRESHOLD_DEFAULT,
    )


def get_strategy_layer2_threshold(strategy: str) -> float:
    """Per-strategy Layer-2 (daily-PnL ratio) threshold. Negative fraction."""
    return _resolve_strategy_threshold(
        strategy,
        _STRATEGY_LAYER2_THRESHOLD_OVERLAY,
        "STRATEGY_LAYER2_THRESHOLD",
        STRATEGY_LAYER2_THRESHOLD_DEFAULT,
    )


def set_strategy_layer1_threshold_overlay(strategy: str, value: float | None) -> None:
    """Set or clear the Layer-1 threshold overlay. ``None`` clears."""
    if value is None:
        _STRATEGY_LAYER1_THRESHOLD_OVERLAY.pop(strategy, None)
        return
    _STRATEGY_LAYER1_THRESHOLD_OVERLAY[strategy] = float(value)


def set_strategy_layer2_threshold_overlay(strategy: str, value: float | None) -> None:
    if value is None:
        _STRATEGY_LAYER2_THRESHOLD_OVERLAY.pop(strategy, None)
        return
    _STRATEGY_LAYER2_THRESHOLD_OVERLAY[strategy] = float(value)


def get_strategy_layer1_threshold_overlay() -> dict[str, float]:
    return dict(_STRATEGY_LAYER1_THRESHOLD_OVERLAY)


def get_strategy_layer2_threshold_overlay() -> dict[str, float]:
    return dict(_STRATEGY_LAYER2_THRESHOLD_OVERLAY)


def is_live_alpaca_base_url(url: str | None = None) -> bool:
    """Return True when ``url`` (or ``settings.ALPACA_BASE_URL`` if unset)
    resolves to Alpaca's live endpoint.

    Wave-A bypass fix: replaced the previous ``"paper" not in url.lower()``
    substring check with an EXACT host match. Personas 66/67/69 flagged the
    substring approach as both fragile and over-blocking:

    * Fragile — an attacker who can write to ``ALPACA_BASE_URL`` (env injection,
      compromised .env) could point at e.g.
      ``https://api.alpaca.markets/?route=paper`` and bypass the gate because
      the substring matched. We now match the *netloc* (host) only and ignore
      path / query.
    * Over-blocking — any private staging mirror whose host happens to omit
      the ``paper`` substring (``alpaca-broker-mock.internal``) was treated as
      live and refused. The exact-host match defaults *unknown* hosts to
      not-live, which is the correct safety posture: only the canonical live
      hostname triggers the gate.

    The canonical live hostname is ``api.alpaca.markets``; ``paper-api.alpaca.markets``
    is the paper endpoint; anything else is treated as not-live (mock /
    staging / sandbox / typo-on-deploy).

    Empty / missing URL is treated as NOT-live so a misconfig doesn't
    accidentally block paper traffic.
    """
    from urllib.parse import urlparse

    base = (url if url is not None else settings.ALPACA_BASE_URL) or ""
    if not base:
        return False
    try:
        parsed = urlparse(base if "://" in base else f"https://{base}")
    except Exception:
        return False
    netloc = (parsed.netloc or "").lower().split(":", 1)[0]
    return netloc == "api.alpaca.markets"
