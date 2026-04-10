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
    ENVIRONMENT: Environment = Environment.DEV
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # --- Database ---
    DATABASE_URL: str = "postgresql+asyncpg://alphadesk:alphadesk_dev@localhost:5432/alphadesk"

    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- Market Data Providers ---
    POLYGON_API_KEY: SecretStr = SecretStr("")
    THETA_DATA_API_KEY: SecretStr = SecretStr("")
    UNUSUAL_WHALES_API_KEY: SecretStr = SecretStr("")

    # --- Broker: Alpaca ---
    ALPACA_API_KEY: SecretStr = SecretStr("")
    ALPACA_SECRET_KEY: SecretStr = SecretStr("")
    ALPACA_BASE_URL: str = "https://paper-api.alpaca.markets"

    # --- Broker: Interactive Brokers ---
    IB_HOST: str = "127.0.0.1"
    IB_PORT: int = 7497
    IB_CLIENT_ID: int = 1

    # --- AI ---
    ANTHROPIC_API_KEY: SecretStr = SecretStr("")

    # --- News ---
    NEWSDATA_API_KEY: str = ""

    # --- Notifications ---
    TELEGRAM_BOT_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_CHAT_ID: str = ""
    DISCORD_WEBHOOK_URL: str = ""

    # --- Webhooks ---
    TRADINGVIEW_WEBHOOK_SECRET: SecretStr = SecretStr("")

    # --- Dev settings ---
    SKIP_DB_INIT: bool = False

    # --- Derived helpers ---
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == Environment.PROD

    @property
    def sync_database_url(self) -> str:
        return self.DATABASE_URL.replace("+asyncpg", "")


settings = Settings()
