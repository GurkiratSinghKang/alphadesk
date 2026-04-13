from __future__ import annotations

# All model classes are defined inside _define_models() so that sqlalchemy
# is NOT imported at module level.  Call get_models() or import individual
# model names -- the module-level __getattr__ below makes both work
# transparently.

from datetime import datetime, date
from typing import Any

_models_cache: dict[str, Any] = {}


def _define_models() -> dict[str, Any]:
    """Define all SQLAlchemy ORM models (imports sqlalchemy on first call)."""
    if _models_cache:
        return _models_cache

    from sqlalchemy import (
        Boolean,
        Column,
        DateTime,
        Float,
        Integer,
        String,
        Text,
        UniqueConstraint,
        Index,
        func,
    )
    from sqlalchemy.dialects.postgresql import JSONB

    from core.database import get_base

    Base = get_base()

    class OHLCVBar(Base):
        """OHLCV price bars stored in a TimescaleDB hypertable.

        After table creation, run:
            SELECT create_hypertable('ohlcv_bars', 'timestamp');
        """

        __tablename__ = "ohlcv_bars"

        id = Column(Integer, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, index=True)
        timestamp = Column(DateTime(timezone=True), nullable=False)
        open = Column(Float, nullable=False)
        high = Column(Float, nullable=False)
        low = Column(Float, nullable=False)
        close = Column(Float, nullable=False)
        volume = Column(Float, nullable=False, default=0)
        vwap = Column(Float, nullable=True)

        __table_args__ = (
            UniqueConstraint("symbol", "timestamp", name="uq_ohlcv_symbol_timestamp"),
            Index("ix_ohlcv_symbol_timestamp", "symbol", "timestamp"),
        )

    class OptionsSnapshot(Base):
        """Point-in-time options contract snapshot."""

        __tablename__ = "options_snapshots"

        id = Column(Integer, primary_key=True, autoincrement=True)
        symbol = Column(String(40), nullable=False, index=True)
        underlying = Column(String(20), nullable=False, index=True)
        expiry = Column(DateTime(timezone=True), nullable=False)
        strike = Column(Float, nullable=False)
        call_put = Column(String(4), nullable=False)  # "call" or "put"
        bid = Column(Float, default=0)
        ask = Column(Float, default=0)
        last = Column(Float, default=0)
        volume = Column(Integer, default=0)
        open_interest = Column(Integer, default=0)
        iv = Column(Float, default=0)
        delta = Column(Float, default=0)
        gamma = Column(Float, default=0)
        theta = Column(Float, default=0)
        vega = Column(Float, default=0)
        timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

        __table_args__ = (
            Index("ix_options_underlying_expiry", "underlying", "expiry"),
        )

    class Trade(Base):
        """Trade journal entry tracking the full lifecycle of a trade."""

        __tablename__ = "trades"

        id = Column(Integer, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, index=True)
        strategy = Column(String(60), nullable=True, index=True)
        legs = Column(JSONB, nullable=True, default=list)
        entry_time = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        exit_time = Column(DateTime(timezone=True), nullable=True)
        entry_price = Column(Float, nullable=True)
        exit_price = Column(Float, nullable=True)
        pnl = Column(Float, nullable=True)
        status = Column(String(20), nullable=False, default="open", index=True)
        notes = Column(Text, nullable=True)

        __table_args__ = (
            Index("ix_trades_strategy_status", "strategy", "status"),
        )

    class Position(Base):
        """Current portfolio position."""

        __tablename__ = "positions"

        id = Column(Integer, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, unique=True)
        quantity = Column(Float, nullable=False, default=0)
        avg_cost = Column(Float, nullable=False, default=0)
        current_price = Column(Float, nullable=True)
        unrealized_pnl = Column(Float, nullable=True)
        greeks = Column(JSONB, nullable=True, default=dict)
        asset_class = Column(String(20), nullable=False, default="equity")
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class Watchlist(Base):
        """User-defined watchlist."""

        __tablename__ = "watchlists"

        id = Column(Integer, primary_key=True, autoincrement=True)
        name = Column(String(100), nullable=False, unique=True)
        symbols = Column(JSONB, nullable=False, default=list)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class ScreenerPreset(Base):
        """Saved screener filter configuration."""

        __tablename__ = "screener_presets"

        id = Column(Integer, primary_key=True, autoincrement=True)
        name = Column(String(100), nullable=False, unique=True)
        filters = Column(JSONB, nullable=False, default=list)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class AgentAnalysis(Base):
        """Cached agent analysis result for a symbol."""

        __tablename__ = "agent_analyses"

        id = Column(Integer, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, index=True)
        agent_type = Column(String(40), nullable=False, index=True)
        analysis = Column(JSONB, nullable=True)
        score = Column(Float, nullable=True)
        timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

        __table_args__ = (
            Index("ix_agent_analysis_symbol_type", "symbol", "agent_type"),
        )

    class StrategySignal(Base):
        """Discrete signal generated by a strategy."""

        __tablename__ = "strategy_signals"

        id = Column(Integer, primary_key=True, autoincrement=True)
        strategy = Column(String(60), nullable=False, index=True)
        symbol = Column(String(20), nullable=False, index=True)
        signal_type = Column(String(20), nullable=False)  # buy, sell, hold, close
        strength = Column(Float, nullable=True)
        timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        signal_metadata = Column("metadata", JSONB, nullable=True, default=dict)

        __table_args__ = (
            Index("ix_signal_strategy_symbol", "strategy", "symbol"),
        )

    class Alert(Base):
        """System or user alert."""

        __tablename__ = "alerts"

        id = Column(Integer, primary_key=True, autoincrement=True)
        alert_type = Column(String(40), nullable=False, index=True)
        message = Column(Text, nullable=False)
        symbol = Column(String(20), nullable=True, index=True)
        triggered_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        acknowledged = Column(Boolean, nullable=False, default=False)

    _models_cache.update({
        "OHLCVBar": OHLCVBar,
        "OptionsSnapshot": OptionsSnapshot,
        "Trade": Trade,
        "Position": Position,
        "Watchlist": Watchlist,
        "ScreenerPreset": ScreenerPreset,
        "AgentAnalysis": AgentAnalysis,
        "StrategySignal": StrategySignal,
        "Alert": Alert,
    })
    return _models_cache


def __getattr__(name: str) -> Any:
    """Allow ``from data.storage.models import Trade`` etc. to work lazily."""
    models = _define_models()
    if name in models:
        return models[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
