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
