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

    # --- AI ---
    ANTHROPIC_API_KEY: SecretStr = SecretStr("")

    # --- News ---
    NEWSDATA_API_KEY: SecretStr = SecretStr("")

    # --- Notifications ---
    TELEGRAM_BOT_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_CHAT_ID: str = ""
    DISCORD_WEBHOOK_URL: SecretStr = SecretStr("")

    # --- Webhooks ---
    TRADINGVIEW_WEBHOOK_SECRET: SecretStr = SecretStr("")

    # --- Dev settings ---
    SKIP_DB_INIT: bool = False

    # --- Auth ---
    JWT_SECRET: SecretStr = SecretStr("")
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""  # bcrypt hash
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours — trading terminal stays open all day
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- Production ---
    PRODUCTION_ORIGIN: str = ""  # e.g. "https://alphadesk.example.com"

    # --- Compliance (Wave 2H — persona 76 P76-7) ---
    # Operator-owned deny-list. Populated either inline (comma-separated) or
    # via a file path. Both sources union together at ``core.compliance``
    # import and the resulting frozenset gates every order path (HTTP,
    # master_agent routing, realtime scanner). Empty default so the gate
    # only fires when the operator opts in.
    RESTRICTED_SYMBOLS: str = ""  # e.g. "GME,AMC,BBBY"
    RESTRICTED_SYMBOLS_FILE: str = ""  # path to YAML/JSON list (optional)

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
# STRATEGY_PAPER_ONLY — strategy is implementation-complete but statistically
#   thin. Route to Alpaca paper only. ``create_order`` rejects with 422 when
#   the Alpaca base URL is a live endpoint.
STRATEGY_LIVE_DISABLED: set[str] = {"orb"}
STRATEGY_PAPER_ONLY: set[str] = {"kama_breakout"}


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
