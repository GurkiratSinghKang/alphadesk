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

    # Round-29 hotfix — survive a ``_models_cache.clear()`` in tests
    # (test_optimistic_locking + test_audit_log_cleanup do this to force a
    # fresh registration). Without this guard the second ``_define_models``
    # call raises ``Table 'ohlcv_bars' is already defined for this MetaData
    # instance`` because Base.metadata is shared across the process. If the
    # tables are already on Base.metadata, look them up by tablename and
    # rebuild the cache from existing class objects instead of re-defining.
    from core.database import get_base
    _base = get_base()
    if "ohlcv_bars" in _base.metadata.tables:
        for cls in _base.registry.mappers:
            klass = cls.class_
            _models_cache[klass.__name__] = klass
        if _models_cache:
            return _models_cache

    from sqlalchemy import (
        BigInteger,
        Boolean,
        CheckConstraint,
        Column,
        Date,
        DateTime,
        Float,
        Integer,
        Numeric,
        String,
        Text,
        UniqueConstraint,
        Index,
        func,
    )
    from sqlalchemy.dialects.postgresql import INET, JSONB

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

    class TickerProfile(Base):
        """Canonical, durable identity metadata for one ticker.

        This is intentionally small in v1. Frequently changing market facts
        live in ``TickerFact``; this table gives the rest of the app a stable
        place to converge on symbol/company identity without re-fetching it
        independently in each strategy or page.
        """

        __tablename__ = "ticker_profiles"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, unique=True, index=True)
        name = Column(String(255), nullable=True)
        exchange = Column(String(64), nullable=True)
        sector = Column(String(120), nullable=True)
        industry = Column(String(160), nullable=True)
        currency = Column(String(16), nullable=True)
        cik = Column(String(32), nullable=True)
        figi = Column(String(64), nullable=True)
        profile_metadata = Column("metadata", JSONB, nullable=True, default=dict)
        observed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )

    class TickerFact(Base):
        """Reusable ticker-scoped fact with explicit freshness metadata."""

        __tablename__ = "ticker_facts"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        symbol = Column(String(20), nullable=False, index=True)
        namespace = Column(String(40), nullable=False, index=True)
        key = Column(String(80), nullable=False, index=True)
        value = Column(JSONB, nullable=False)
        source = Column(String(80), nullable=False, index=True)
        source_ref = Column(String(128), nullable=True)
        as_of = Column(DateTime(timezone=True), nullable=True, index=True)
        observed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
        source_updated_at = Column(DateTime(timezone=True), nullable=True)
        expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
        stale_after_seconds = Column(Integer, nullable=True)
        quality = Column(String(20), nullable=False, server_default="fresh", default="fresh", index=True)
        is_demo = Column(Boolean, nullable=False, server_default="false", default=False)
        schema_version = Column(Integer, nullable=False, server_default="1", default=1)
        lineage_hash = Column(String(64), nullable=True, index=True)
        created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )

        __table_args__ = (
            Index("ix_ticker_facts_latest", "symbol", "namespace", "key", "observed_at"),
            Index("ix_ticker_facts_source_ref", "source", "source_ref"),
        )

    class TickerResearchRun(Base):
        """Reusable external/LLM research run normalized by ticker."""

        __tablename__ = "ticker_research_runs"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        run_id = Column(String(64), nullable=False, unique=True, index=True)
        symbol = Column(String(20), nullable=False, index=True)
        username = Column(String(128), nullable=True, index=True)
        status = Column(String(32), nullable=False, index=True)
        provider = Column(String(40), nullable=True)
        deep_model = Column(String(120), nullable=True)
        quick_model = Column(String(120), nullable=True)
        analysts = Column(JSONB, nullable=False, default=list)
        research_depth = Column(Integer, nullable=True)
        trade_date = Column(Date, nullable=True)
        summary_lines = Column(JSONB, nullable=False, default=list)
        decision_text = Column(Text, nullable=True)
        artifact_files = Column(JSONB, nullable=False, default=list)
        request_payload = Column(JSONB, nullable=True)
        error = Column(JSONB, nullable=True)
        created_at = Column(DateTime(timezone=True), nullable=True)
        started_at = Column(DateTime(timezone=True), nullable=True)
        completed_at = Column(DateTime(timezone=True), nullable=True, index=True)
        updated_at = Column(DateTime(timezone=True), nullable=True)
        persisted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

        __table_args__ = (
            Index("ix_ticker_research_symbol_completed", "symbol", "completed_at"),
            Index("ix_ticker_research_username_symbol", "username", "symbol"),
        )

    class User(Base):
        """Durable application user profile.

        Auth still accepts the env-configured admin as a compatibility
        fallback, but every successful login is mirrored here and new users
        are created here.  The username string remains the stable join key for
        existing audit/session infrastructure.
        """

        __tablename__ = "users"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        username = Column(String(128), nullable=False, unique=True, index=True)
        email = Column(String(255), nullable=True, unique=True, index=True)
        password_hash = Column(String(255), nullable=True)
        role = Column(String(32), nullable=False, server_default="user", default="user", index=True)
        status = Column(String(32), nullable=False, server_default="active", default="active", index=True)
        display_name = Column(String(160), nullable=True)
        profile = Column(JSONB, nullable=True, default=dict)
        created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
        last_login_at = Column(DateTime(timezone=True), nullable=True)

        __table_args__ = (
            Index("ix_users_status_role", "status", "role"),
        )

    class BrokerConnection(Base):
        """Encrypted per-user brokerage connection.

        Stores only encrypted credential material plus non-sensitive display
        metadata. The active connection for a username/provider/environment is
        used before falling back to server-wide env credentials.
        """

        __tablename__ = "broker_connections"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        username = Column(String(128), nullable=False, index=True)
        provider = Column(String(32), nullable=False, index=True)
        account_env = Column(String(16), nullable=False, server_default="paper", default="paper", index=True)
        display_name = Column(String(160), nullable=True)
        api_key_ciphertext = Column(Text, nullable=False)
        secret_key_ciphertext = Column(Text, nullable=False)
        # Audit fix-D (2026-05-05): track which KDF version produced
        # ``*_ciphertext`` so the bulk re-encryption script can be re-run
        # idempotently. Migration 0015 backfills existing rows with 1 (the
        # legacy sha256 default) and ``encrypt_secret`` writes 3 going
        # forward; the migration script lifts straggling 1/2 rows to 3.
        crypto_version = Column(
            Integer, nullable=False, server_default="1", default=1
        )
        key_last4 = Column(String(8), nullable=True)
        status = Column(String(32), nullable=False, server_default="active", default="active", index=True)
        is_default = Column(Boolean, nullable=False, server_default="true", default=True)
        verified_at = Column(DateTime(timezone=True), nullable=True)
        last_sync_at = Column(DateTime(timezone=True), nullable=True)
        last_error = Column(Text, nullable=True)
        broker_account_id = Column(String(128), nullable=True)
        broker_metadata = Column("metadata", JSONB, nullable=True, default=dict)
        created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )

        __table_args__ = (
            UniqueConstraint("username", "provider", "account_env", name="uq_broker_conn_user_provider_env"),
            Index("ix_broker_conn_user_provider", "username", "provider", "status"),
        )

    class ReconciliationIssue(Base):
        """Broker/local-ledger mismatch queued for user approval.

        The periodic reconciler writes these rows instead of silently
        mutating the local ledger. A user can approve the proposed action or
        reject it, leaving a durable decision trail.
        """

        __tablename__ = "reconciliation_issues"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        issue_key = Column(String(160), nullable=False, unique=True, index=True)
        username = Column(String(128), nullable=False, index=True)
        broker_connection_id = Column(BigInteger, nullable=True, index=True)
        provider = Column(String(32), nullable=False, server_default="alpaca", default="alpaca", index=True)
        account_env = Column(String(16), nullable=False, server_default="paper", default="paper", index=True)
        issue_type = Column(String(48), nullable=False, index=True)
        severity = Column(String(16), nullable=False, server_default="warning", default="warning", index=True)
        status = Column(String(24), nullable=False, server_default="open", default="open", index=True)
        symbol = Column(String(32), nullable=True, index=True)
        broker_order_id = Column(String(128), nullable=True, index=True)
        client_order_id = Column(String(128), nullable=True, index=True)
        local_trade_id = Column(BigInteger, nullable=True, index=True)
        broker_snapshot = Column(JSONB, nullable=True)
        local_snapshot = Column(JSONB, nullable=True)
        proposed_action = Column(JSONB, nullable=False, default=dict)
        detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
        decided_at = Column(DateTime(timezone=True), nullable=True)
        decided_by = Column(String(128), nullable=True)
        resolution_note = Column(Text, nullable=True)

        __table_args__ = (
            Index("ix_recon_issues_user_status", "username", "status", "detected_at"),
            Index("ix_recon_issues_type_status", "issue_type", "status"),
        )

    class Trade(Base):
        """Trade journal entry tracking the full lifecycle of a trade."""

        __tablename__ = "trades"

        id = Column(Integer, primary_key=True, autoincrement=True)
        username = Column(String(128), nullable=True, index=True)
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
        # ``side`` records the direction of the entry ("long" or "short"). It is
        # nullable so legacy rows that pre-date the column keep loading; new
        # inserts MUST supply the side from the originating order so short P&L
        # can be computed correctly.  The first leg's ``side`` in the
        # ``legs`` JSON is authoritative when present; this column is a denormalised
        # projection for fast filtering and for queries that don't need to parse
        # JSON.
        # TODO: generate an alembic migration to add this column to production:
        #   alembic revision --autogenerate -m "add side to trades"
        side = Column(String(10), nullable=True, index=True)

        # Wave B (persona-72 P0 fill-reconciliation gap).  The broker
        # ``trade_updates`` WebSocket publishes fill / partial_fill / canceled
        # / rejected / expired events to Redis; the DB consumer
        # (``data.ingestion.fill_reconciler``) uses these columns to stamp the
        # authoritative fill state onto the local Trade row.  Schema shape:
        #
        # * ``broker_order_id``   – Alpaca's ``order.id`` (UUID string, 36 chars
        #   but widened to 64 to allow for prefixing / future brokers). UNIQUE
        #   so a double-posted fill event is a DB constraint violation rather
        #   than a silent duplicate.
        # * ``client_order_id``   – the correlation id we sent to the broker on
        #   submit (``manual_<user>_<hex>`` or ``{strategy}_{symbol}_{ts}``).
        #   UNIQUE. Previously we encoded this inside the legs JSON; that
        #   still works for legacy rows but new inserts populate both.
        # * ``filled_at``         – millisecond-precision UTC timestamp of the
        #   broker fill (FINRA 4590 retention). TIMESTAMP(6) WITH TIME ZONE
        #   in Postgres.
        # * ``filled_avg_price``  – NUMERIC(20, 6): six decimal places matches
        #   Alpaca's ``filled_avg_price`` field and avoids binary-float drift
        #   on downstream P&L.
        # * ``account_env``       – 'paper' | 'live' | 'backtest'. NOT NULL
        #   with a default of 'paper' so that existing rows are safe; new
        #   inserts MUST populate it from ``settings.LIVE_TRADING_ENABLED``
        #   (or the Alpaca base-URL helper while Wave A is in flight).
        broker_order_id = Column(String(64), nullable=True, unique=True)
        client_order_id = Column(String(128), nullable=True, unique=True)
        filled_at = Column(DateTime(timezone=True), nullable=True)
        filled_avg_price = Column(Numeric(20, 6), nullable=True)
        account_env = Column(
            String(16), nullable=False, server_default="paper", default="paper", index=True,
        )

        # Wave 2G — execution quality columns (persona-85 gaps 1, 2, 10).
        # Captured by the fill_reconciler when Alpaca's trade_updates payload
        # carries the venue routing string and an NBBO tick is available
        # from the quote-stream Redis cache. NULL is a legitimate value for
        # any of these — older fills (pre-Wave 2G) have no execution-quality
        # records, and not every fill exposes a venue (e.g. retail-router
        # internalised flow). ``price_improvement_cents`` is computed by
        # the reconciler from (NBBO mid - fill_price) * sign(side) * 100.
        execution_venue = Column(String(16), nullable=True)
        nbbo_bid_at_fill = Column(Numeric(20, 6), nullable=True)
        nbbo_ask_at_fill = Column(Numeric(20, 6), nullable=True)
        price_improvement_cents = Column(Numeric(10, 4), nullable=True)

        # Wave 2G — optimistic concurrency control (persona-79 Race 2).
        # The fill_reconciler and reconcile_on_boot can race on the same
        # Trade row when boot fires while the live pub/sub channel is
        # already replaying queued events. With ``__mapper_args__ =
        # {"version_id_col": Trade.version}`` SQLAlchemy automatically
        # bumps this column on UPDATE and adds it to the WHERE clause; a
        # concurrent transition that writes first wins, the loser raises
        # ``StaleDataError`` and retries against the fresh row. Default 0
        # so existing rows pre-migration validate cleanly.
        version = Column(Integer, nullable=False, server_default="0", default=0)

        # Wave 4P Fix 3 (P97) — position-aware trade classification.
        # The legacy ``side`` column was derived from the broker-order
        # SIDE (``buy`` → ``long``, ``sell`` → ``short``). That maps
        # cleanly for OPENING orders but is wrong for CLOSES: selling
        # to close a long is a LONG-EXIT, not a NEW SHORT. This column
        # carries the correct position-aware classification:
        #     ``long_open`` | ``long_close`` | ``short_open`` | ``short_close``
        # Nullable so legacy rows don't fail post-migration validation.
        # The fill_reconciler computes this against the pre-fill
        # position state and stamps it onto the row at fill time.
        trade_kind = Column(String(16), nullable=True, index=True)

        # J-17 (Round-6, persona Round-6 J) — actually-filled quantity.
        #
        # Until this column landed, the only authoritative qty for a
        # trade row was the SUBMITTED qty stamped on the leg JSON at
        # order-creation time. Partial fills updated ``status`` to
        # ``partial`` and ``filled_avg_price`` to the volume-weighted
        # average, but never recorded HOW MANY shares had actually
        # filled. Downstream consumers (pipeline.py /pipeline/positions,
        # report builders, P&L attribution) all read leg.qty and
        # silently assumed a 100%-filled order — every partial-fill
        # showed the wrong size in the dashboard.
        #
        # The fill_reconciler stamps this on every fill / partial_fill
        # event from Alpaca's trade_updates feed; the manual-order
        # path leaves it NULL until the first fill event arrives.
        # Numeric(20,4) matches Alpaca's qty precision (4 decimals
        # accommodates fractional-share orders). NULLABLE so legacy
        # rows without a fill event keep loading.
        filled_qty = Column(Numeric(20, 4), nullable=True)

        # OE-2 (combo-exit hardening, 2026-05-05) — combo-mark stop level.
        #
        # Multi-leg option combos (iron condor, vertical spreads, etc.)
        # cannot attach broker-side bracket exits on Alpaca (the OPRA
        # multi-leg endpoint does not accept bracket parameters), so
        # stops live entirely in ``daily_pipeline._check_exits``. The
        # legacy per-share ``stop_loss`` is meaningless for a defined-
        # risk spread — comparing the underlying's mark against a
        # "stop_loss" of $97 fires on the wrong signal for a credit
        # spread that's bleeding because IV expanded, not because spot
        # moved.
        #
        # ``stop_loss_combo_mark`` is the COMBO MARK (sum of per-leg
        # signed mids × qty × 100) below which the position should
        # auto-close. Per :func:`services.combo_calc.compute_combo_mark`
        # the combo mark is the dollar cost to flatten the position
        # right now; for a credit spread it's NEGATIVE at entry (you
        # collected credit) and approaches 0 as the position decays
        # favourably. A typical iron condor with $662 net credit and
        # $338 max loss might set ``stop_loss_combo_mark = -200``
        # (close when it would cost $200 to flatten).
        #
        # NULL means "no combo-mark stop has been calculated for this
        # trade" — applies to every legacy row pre-this-migration and
        # to single-leg trades where the column is irrelevant. The
        # exit checker treats NULL as "skip the combo-mark check, fall
        # through to the existing single-leg logic".
        stop_loss_combo_mark = Column(Float, nullable=True)

        __mapper_args__ = {
            "version_id_col": version,
        }

        __table_args__ = (
            Index("ix_trades_strategy_status", "strategy", "status"),
            # Composite index for the most common filter shape on this table:
            # ``WHERE symbol = :s ORDER BY entry_time DESC`` used by
            # ``GET /trades/history`` and the trade-ledger sync helpers.
            # Declared at the ORM level only — migration NOT generated in this
            # wave to keep the change reversible and reviewable on its own.
            # Index declared; generate migration separately with
            #   alembic revision --autogenerate
            Index("ix_trades_symbol_entry_time", "symbol", "entry_time"),
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

    class AuditLog(Base):
        """Durable compliance trail for authenticated + trading actions.

        Wave 3K — persona-87 P1 #1. Replaces the prior stdout-only
        ``_audit(...)`` callsites across auth.py / trades.py /
        trading_gate.py so a container rotation no longer evaporates the
        compliance record.  Every ``core.audit.write_audit(...)`` invocation
        appends one row here; the same helper also emits a structured log
        record so existing log-aggregation pipelines keep functioning
        unchanged.

        Fields mirror the columns declared in
        ``alembic/versions/0005_audit_log.py``.  See that migration's
        docstring for the rationale behind each column's nullability and
        type choice.  Schema highlights:

        * ``id``         — BIGINT surrogate PK. BigInteger rather than
          Integer because audit inserts aggregate across every auth event,
          every order submit, and every live-gate rejection — at even
          modest load a 32-bit serial would wrap inside a couple of years.
        * ``ts``         — server-side ``NOW()`` default so a skewed
          client clock cannot corrupt the timeline.
        * ``event``      — short snake_case identifier
          (``login``/``halt_trading``/``wash_trade_rejected``/…).
        * ``username``   — NULL for pre-auth events (e.g. failed login
          against an unknown user).
        * ``ip``         — stored in Postgres's native INET type so CIDR
          containment queries work ("every event from 10.0.0.0/8").
        * ``request_id`` — the request-correlation id from
          ``request.state.request_id`` / ``REQUEST_ID.get()``; pivots
          from an audit row to every structured log line in the same
          request.
        * ``details``    — JSONB free-form kwargs
          (``reason``/``symbol``/``new_password_version``/…).
        """

        __tablename__ = "audit_log"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        ts = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )
        event = Column(String(64), nullable=False)
        username = Column(String(128), nullable=True)
        ip = Column(INET, nullable=True)
        request_id = Column(String(64), nullable=True)
        details = Column(JSONB, nullable=True)
        # Wave 4Q (persona-103 P1 — GDPR Art. 17 / SEC 17a-4 interplay).
        # When a user invokes the erasure endpoint we MUST delete their
        # audit rows to honour Art. 17 — EXCEPT those whose event is on
        # the regulatory minimum-retention list (halt_trading,
        # resume_trading, wash_trade_reject, restricted_symbol_reject,
        # live_gate_reject). Those rows survive but are flagged TRUE so
        # downstream exports and admin UIs render them as "retained for
        # regulatory compliance — not user-originated data" rather than
        # as a privacy-policy breach.
        retained_for_compliance = Column(
            Boolean, nullable=False, server_default="false", default=False
        )

        __table_args__ = (
            # Indexes mirror the alembic migration 1:1. Declared at the
            # ORM level only (migration owns the DDL); SQLAlchemy's
            # create_all picks them up so in-memory test DBs get the same
            # shape as production.
            Index("ix_audit_log_ts", "ts"),
            Index("ix_audit_log_event_ts", "event", "ts"),
            Index("ix_audit_log_username_ts", "username", "ts"),
        )

    class ComplianceTicket(Base):
        """Subject Access Request (SAR) / GDPR+CCPA rights ticket.

        Wave 4Q — persona-103 P1 #5.  One row per incoming rights
        request.  Statuses flow through ``received`` → ``verifying``
        → ``in_progress`` → ``completed`` / ``denied`` / ``withdrawn``.
        See ``docs/SAR_WORKFLOW.md`` for the operator runbook.
        """

        __tablename__ = "compliance_tickets"

        id = Column(BigInteger, primary_key=True, autoincrement=True)
        received_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )
        completed_at = Column(DateTime(timezone=True), nullable=True)
        # access | erasure | rectification | portability | objection |
        # restriction. CCPA know/delete map onto access/erasure.
        request_type = Column(String(32), nullable=False)
        # received | verifying | in_progress | completed | denied |
        # withdrawn.
        status = Column(String(32), nullable=False, server_default="received", default="received")
        requester_email = Column(String(255), nullable=True)
        requester_username = Column(String(128), nullable=True)
        identity_verified = Column(
            Boolean, nullable=False, server_default="false", default=False
        )
        denial_reason = Column(Text, nullable=True)
        notes = Column(JSONB, nullable=True)

        __table_args__ = (
            Index(
                "ix_compliance_tickets_status_received",
                "status",
                "received_at",
            ),
            Index(
                "ix_compliance_tickets_requester_email",
                "requester_email",
            ),
        )

    class AccessRequest(Base):
        """Public invite-request intake for AlphaDesk onboarding.

        This is intentionally separate from ``compliance_tickets``. Access
        requests are sales/onboarding work items, while compliance tickets
        are statutory privacy-rights records with a different retention and
        verification workflow.
        """

        __tablename__ = "access_requests"

        id = Column(Integer, primary_key=True, autoincrement=True)
        public_id = Column(String(32), nullable=False, unique=True, index=True)
        created_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
        status = Column(String(32), nullable=False, server_default="received", default="received")
        name = Column(String(120), nullable=False)
        email = Column(String(255), nullable=False)
        firm = Column(String(160), nullable=True)
        role = Column(String(120), nullable=True)
        jurisdiction = Column(String(80), nullable=False)
        capital_band = Column(String(32), nullable=False)
        trading_mode = Column(String(32), nullable=False)
        instruments = Column(JSONB, nullable=False)
        note = Column(Text, nullable=False)
        referral = Column(Text, nullable=True)
        client_ip = Column(String(64), nullable=True)
        user_agent = Column(String(256), nullable=True)

        __table_args__ = (
            Index("ix_access_requests_status_created", "status", "created_at"),
            Index("ix_access_requests_email", "email"),
        )

    class HaltState(Base):
        """Singleton table holding the emergency kill-switch state.

        Wave 4P Fix 1 (persona P96).  Before this model the halt flag
        lived ONLY in Redis under ``trading:halted``.  A ``FLUSHALL`` or
        a cold Redis restart silently un-halted trading — the next
        pipeline tick saw an absent key and classified the system as
        NOT-halted, resuming live orders without operator intent.

        Postgres is now the SOURCE OF TRUTH: every halt / resume
        transition writes to this row first, then invalidates the Redis
        cache.  ``_is_trading_halted()`` reads Postgres first; Redis is
        a 0.5s-latency cache that fails closed.

        Singleton invariant is enforced by a CHECK constraint (id = 1)
        mirroring ``alembic/versions/0006_halt_state_and_trade_kind.py``.
        Any INSERT that is not id=1 will fail at the DB layer — defence
        in depth against an application bug that tries to create a
        second halt row.
        """

        __tablename__ = "halt_state"

        # Singleton surrogate — always 1.  ``server_default='1'`` so a
        # bare ``session.add(HaltState())`` populates the column without
        # the caller having to remember.
        id = Column(Integer, primary_key=True, server_default="1", default=1)
        is_halted = Column(
            Boolean, nullable=False, server_default="false", default=False,
        )
        halted_by = Column(String(128), nullable=True)
        halted_at = Column(DateTime(timezone=True), nullable=True)
        reason = Column(String(256), nullable=True)
        # Wave 4P Fix 2 (P104): queue a flatten intent when the operator
        # halts while the market is closed.  The next-open reconciler
        # sees ``pending_flatten = TRUE`` and fires the close orders
        # once regular trading hours resume.
        pending_flatten = Column(
            Boolean, nullable=False, server_default="false", default=False,
        )

        __table_args__ = (
            CheckConstraint("id = 1", name="ck_halt_state_singleton"),
        )

    class ExitRule(Base):
        """Configurable exit-rule for OPEN trades (P2 — position-management automation).

        Wave 5A (audit/2026-05-05-position-management). The system previously
        held positions to expiration with no auto-take-profit, time-based
        exit, or auto-roll discipline. A user took max-loss on an AMD iron
        condor partly because no 50%-of-max-credit profit-taker fired when
        the trade was favourable mid-week.

        This table holds the rule set the exit evaluator
        (``services.exit_rules.evaluate_exit_rules``) walks on every
        ``daily_pipeline._check_exits`` tick. Rules are scoped by
        ``strategy`` (NULL = all strategies) and ``structure_type`` (NULL or
        ``"*"`` = all structures), and fire in ``priority`` order — lowest
        runs first, first match wins.

        Schema fields:

        * ``rule_type`` — one of:

          - ``profit_pct``   — fire when current pnl >= threshold * max_profit
          - ``time_dte``     — fire when DTE <= threshold
          - ``loss_pct``     — fire when current pnl <= -threshold * max_profit
          - ``delta_breach`` — fire when |net combo delta| >= threshold

        * ``threshold`` — interpretation depends on ``rule_type`` (a fraction
          for profit/loss_pct, a day count for time_dte, a delta for
          delta_breach).

        * ``action`` — one of ``close`` | ``roll`` | ``alert``. Auto-roll
          is downgraded to ``alert`` by ``services.position_roller`` when
          guardrails fail (DTE > 7, no defensible debit, structure not
          iron_condor / vertical_spread, …).

        * ``priority`` — lower number runs first. Default 100. The seed
          set uses 5 for the "alert at -200% loss" rule (so it fires
          before any close action) and 10 for the take-profit rules.

        * ``enabled`` — soft-disable a rule without dropping it. The
          admin UI uses this for the per-row toggle.
        """

        __tablename__ = "exit_rules"

        id = Column(Integer, primary_key=True, autoincrement=True)
        strategy = Column(String(60), nullable=True, index=True)
        structure_type = Column(String(40), nullable=True, index=True)
        rule_type = Column(String(32), nullable=False, index=True)
        threshold = Column(Float, nullable=False)
        action = Column(String(16), nullable=False, server_default="close", default="close")
        enabled = Column(Boolean, nullable=False, server_default="true", default=True, index=True)
        priority = Column(Integer, nullable=False, server_default="100", default=100, index=True)
        # Free-form notes / rationale shown in the admin UI. Optional.
        description = Column(Text, nullable=True)
        created_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )
        updated_at = Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )

        __table_args__ = (
            Index("ix_exit_rules_scope", "strategy", "structure_type", "enabled"),
            Index("ix_exit_rules_priority", "priority", "enabled"),
            CheckConstraint(
                "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach')",
                name="ck_exit_rules_rule_type",
            ),
            CheckConstraint(
                "action IN ('close','roll','alert')",
                name="ck_exit_rules_action",
            ),
        )

    _models_cache.update({
        "OHLCVBar": OHLCVBar,
        "OptionsSnapshot": OptionsSnapshot,
        "TickerProfile": TickerProfile,
        "TickerFact": TickerFact,
        "TickerResearchRun": TickerResearchRun,
        "User": User,
        "BrokerConnection": BrokerConnection,
        "ReconciliationIssue": ReconciliationIssue,
        "Trade": Trade,
        "Position": Position,
        "Watchlist": Watchlist,
        "ScreenerPreset": ScreenerPreset,
        "AgentAnalysis": AgentAnalysis,
        "StrategySignal": StrategySignal,
        "Alert": Alert,
        "AuditLog": AuditLog,
        "ComplianceTicket": ComplianceTicket,
        "AccessRequest": AccessRequest,
        "HaltState": HaltState,
        "ExitRule": ExitRule,
    })
    return _models_cache


def __getattr__(name: str) -> Any:
    """Allow ``from data.storage.models import Trade`` etc. to work lazily."""
    models = _define_models()
    if name in models:
        return models[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
