"""v2 Phase B — backend extensions B.1 through B.18.

Revision ID: 0024_v2_phase_b
Revises: 0023_user_watchlist
Create Date: 2026-05-08

v2 redesign cycle. Lands the model layer for all 18 backend
extensions called out in the redesign plan
(`/Users/GK/.claude/plans/we-need-to-redesign-eager-flute.md`):

  B.1  PipelineStageState                (per-stage pause/resume)
  B.2  AgentControl                      (per-agent pause + spend cap)
  B.3  Watchlist + WatchlistItem         (multi-list watchlists)
  B.4  Notification + NotificationPref   (user inbox + routing)
  B.5  RejectReasonTemplate +
       WelcomeTemplate                   (applicant approval workflow)
  B.6  UserLayoutConfig                  (user-scoped layout overrides)
  B.7  JarvisIntent                      (⌘⇧J replay/audit)
  B.8  FeatureFlag + FeatureFlagOverride (runtime flags)
  B.9  StrategyPlaybook +
       StrategyPlaybookVersion           (playbook workflow doc)
  B.10 BacktestRun +
       BacktestRunPublication            (backtest workbench)
  B.11 OnboardingQuestionnaire +
       RecommendationSnapshot            (onboarding recommender)
  B.12 ReportSchedule + ReportRun        (scheduled reports)
  B.13 Lot + WashSaleAdjustment          (tax/lots + wash sales)
  B.14 ImpersonationSession              (operator impersonation)
  B.16 UserSettings                      (per-user settings)
  B.17 Plan + Subscription + BillingEvent (Stripe billing)
  B.18 DocCategory + DocArticle          (public docs CMS-lite)

Migration is purely additive (no rewrites of existing tables). All
new tables can be dropped on downgrade without affecting existing
features. Per the redesign plan §0.11 and the Preservation Register:
existing `user_watchlist` is left in place — Watchlist v2 sits
alongside; the old single-row watchlist will be migrated row-by-row
via the B.3 service in a follow-up iteration, then dropped.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0024_v2_phase_b"
down_revision = "0023_user_watchlist"
branch_labels = None
depends_on = None


def _ts_default(name: str = "created_at") -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _ts_updated() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    # ─── B.1 Pipeline stage state ───────────────────────────────
    op.create_table(
        "pipeline_stage_state",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("stage", sa.String(length=32), nullable=False, unique=True),
        sa.Column("is_paused", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("paused_by", sa.String(length=255), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("last_run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_status", sa.String(length=16), nullable=True),
        sa.Column("queue_depth", sa.Integer, nullable=False, server_default=sa.text("0")),
        _ts_updated(),
    )
    # Seed the 5 known stages so the GET /pipeline/stages always
    # returns the canonical taxonomy (ingest / enrich / score / risk /
    # execute).
    for stage in ("ingest", "enrich", "score", "risk", "execute"):
        op.execute(
            sa.text(
                "INSERT INTO pipeline_stage_state (stage, is_paused, queue_depth) "
                "VALUES (:stage, false, 0) ON CONFLICT (stage) DO NOTHING"
            ).bindparams(stage=stage)
        )

    # ─── B.2 Agent control ──────────────────────────────────────
    op.create_table(
        "agent_control",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("archetype", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=True),
        sa.Column("is_paused", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("daily_spend_cap_usd", sa.Numeric(10, 4), nullable=True),
        sa.Column("paused_by", sa.String(length=255), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        _ts_updated(),
        sa.UniqueConstraint("archetype", "model", "provider", name="agent_control_key_unique"),
    )
    # Seed wildcard rows for the four archetypes (model + provider NULL).
    for arch in ("research", "signal", "risk", "exec"):
        op.execute(
            sa.text(
                "INSERT INTO agent_control (archetype, is_paused, daily_spend_cap_usd) "
                "VALUES (:arch, false, 50.0) ON CONFLICT (archetype, model, provider) DO NOTHING"
            ).bindparams(arch=arch)
        )

    # ─── B.3 Watchlists v2 ──────────────────────────────────────
    op.create_table(
        "watchlist",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("auto_source_strategy", sa.String(length=60), nullable=True),
        sa.Column("column_set", JSONB, nullable=True),
        sa.Column("share_mode", sa.String(length=16), nullable=False, server_default="private"),
        sa.Column("share_token", sa.String(length=48), nullable=True, unique=True),
        sa.Column("position", sa.Integer, nullable=False, server_default=sa.text("0")),
        _ts_default(),
        _ts_updated(),
        sa.UniqueConstraint("username", "name", name="watchlist_user_name_unique"),
    )
    op.create_index("watchlist_username_idx", "watchlist", ["username"])

    op.create_table(
        "watchlist_item",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("watchlist_id", sa.BigInteger, nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("watchlist_id", "symbol", name="watchlist_item_unique"),
    )
    op.create_index("watchlist_item_wl_idx", "watchlist_item", ["watchlist_id"])

    # ─── B.4 Notifications ──────────────────────────────────────
    op.create_table(
        "notification",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=24), nullable=False),
        sa.Column("severity", sa.String(length=8), nullable=False, server_default="info"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("link", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        _ts_default(),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("notification_user_unread_idx", "notification", ["username", "read_at", "created_at"])
    op.create_index("notification_user_type_idx", "notification", ["username", "type"])

    op.create_table(
        "notification_preference",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=24), nullable=False),
        sa.Column("channel_email", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("channel_push", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("channel_slack", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("quiet_hours_start", sa.String(length=8), nullable=True),
        sa.Column("quiet_hours_end", sa.String(length=8), nullable=True),
        sa.Column("quiet_hours_tz", sa.String(length=48), nullable=True),
        sa.Column("min_severity", sa.String(length=8), nullable=False, server_default="info"),
        _ts_updated(),
        sa.UniqueConstraint("username", "type", name="notif_pref_user_type_unique"),
    )

    # ─── B.5 Applicant approval templates ───────────────────────
    for table in ("reject_reason_template", "welcome_template"):
        op.create_table(
            table,
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            sa.Column("slug", sa.String(length=64), nullable=False, unique=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("body", sa.Text, nullable=False),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            _ts_updated(),
        )

    # Seed B.5 reject reasons per the plan.
    for slug, title, body in (
        ("incomplete_info", "Incomplete information", "Some required fields were missing or unclear in your application."),
        ("unsupported_jurisdiction", "Unsupported jurisdiction", "We're unable to onboard accounts from your jurisdiction at this time."),
        ("capital_below_min", "Capital below minimum", "Your stated capital falls below the minimum for the requested plan."),
        ("cannot_verify", "Cannot verify identity", "We were unable to verify the identity provided in your application."),
        ("policy_violation", "Policy violation", "Your application failed automated policy checks (sanctions, abuse signals)."),
        ("other", "Other", "Please reach out to support for additional context on this decision."),
    ):
        op.execute(
            sa.text(
                "INSERT INTO reject_reason_template (slug, title, body) "
                "VALUES (:slug, :title, :body) ON CONFLICT (slug) DO NOTHING"
            ).bindparams(slug=slug, title=title, body=body)
        )

    # ─── B.6 User layout config ─────────────────────────────────
    op.create_table(
        "user_layout_config",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value_json", JSONB, nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=True),
        _ts_updated(),
        sa.UniqueConstraint("username", "key", name="user_layout_config_unique"),
    )

    # ─── B.7 Jarvis intent log ──────────────────────────────────
    op.create_table(
        "jarvis_intent",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("prompt", sa.Text, nullable=False),
        sa.Column("parsed_intent", JSONB, nullable=True),
        sa.Column("dry_run_diff", JSONB, nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        _ts_default(),
    )
    op.create_index("jarvis_intent_user_idx", "jarvis_intent", ["username", "created_at"])

    # ─── B.8 Feature flags ──────────────────────────────────────
    op.create_table(
        "feature_flag",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(length=120), nullable=False, unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("default_enabled", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("rollout_status", sa.String(length=16), nullable=False, server_default="off"),
        _ts_default(),
    )
    op.create_table(
        "feature_flag_override",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("flag_id", sa.BigInteger, nullable=False),
        sa.Column("scope_type", sa.String(length=16), nullable=False),
        sa.Column("scope_value", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=True),
        _ts_updated(),
        sa.UniqueConstraint("flag_id", "scope_type", "scope_value", name="feature_flag_override_unique"),
    )
    op.create_index("feature_flag_override_flag_idx", "feature_flag_override", ["flag_id"])

    # Seed the 5 v2 flags called out in the plan.
    for key, desc, default in (
        ("dashboard.live_ticker", "Hero equity ticker live-tick animation", True),
        ("trade.options_chain", "Show full options chain panel on Trade page", True),
        ("symbol.ai_thesis", "Render AI thesis card on Symbol page Overview", True),
        ("command.jarvis", "⌘⇧J Jarvis conversational command bar", True),
        ("admin.impersonation", "Operator impersonation (gated by consent)", False),
    ):
        op.execute(
            sa.text(
                "INSERT INTO feature_flag (key, description, default_enabled, rollout_status) "
                "VALUES (:key, :desc, :enabled, :rollout) ON CONFLICT (key) DO NOTHING"
            ).bindparams(
                key=key,
                desc=desc,
                enabled=default,
                rollout="on" if default else "off",
            )
        )

    # ─── B.9 Strategy playbook ──────────────────────────────────
    op.create_table(
        "strategy_playbook",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("strategy", sa.String(length=60), nullable=False, unique=True),
        sa.Column("current_version", sa.Integer, nullable=False, server_default=sa.text("1")),
    )
    op.create_table(
        "strategy_playbook_version",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("playbook_id", sa.BigInteger, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("playbook_id", "version", name="strategy_playbook_version_unique"),
    )
    op.create_index("strategy_playbook_version_pb_idx", "strategy_playbook_version", ["playbook_id"])

    # ─── B.10 Backtest workbench ────────────────────────────────
    op.create_table(
        "backtest_run",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("strategy", sa.String(length=60), nullable=False),
        sa.Column("universe", JSONB, nullable=True),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("cost_model", JSONB, nullable=True),
        sa.Column("sweep_params", JSONB, nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Float, nullable=False, server_default=sa.text("0")),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("metrics", JSONB, nullable=True),
        sa.Column("equity_curve", JSONB, nullable=True),
        sa.Column("trade_log_count", sa.Integer, nullable=True),
        _ts_default(),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("backtest_run_user_idx", "backtest_run", ["username", "created_at"])
    op.create_index("backtest_run_strategy_idx", "backtest_run", ["strategy", "completed_at"])

    op.create_table(
        "backtest_run_publication",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.BigInteger, nullable=False, unique=True),
        sa.Column("strategy", sa.String(length=60), nullable=False),
        sa.Column("published_by", sa.String(length=255), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("backtest_run_publication_strategy_idx", "backtest_run_publication", ["strategy"])

    # ─── B.11 Onboarding questionnaire ──────────────────────────
    op.create_table(
        "onboarding_questionnaire",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False, unique=True),
        sa.Column("answers", JSONB, nullable=True),
        sa.Column("step", sa.String(length=24), nullable=False, server_default="not_started"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        _ts_updated(),
    )
    op.create_table(
        "recommendation_snapshot",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("engine_version", sa.String(length=16), nullable=False),
        sa.Column("recommended_layout", JSONB, nullable=True),
        sa.Column("recommended_agents", JSONB, nullable=True),
        sa.Column("recommended_watchlist", JSONB, nullable=True),
        _ts_default(),
    )
    op.create_index("recommendation_snapshot_user_idx", "recommendation_snapshot", ["username"])

    # ─── B.12 Reports ──────────────────────────────────────────
    op.create_table(
        "report_schedule",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("report_type", sa.String(length=32), nullable=False),
        sa.Column("cron_expression", sa.String(length=120), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("delivery_channels", JSONB, nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_status", sa.String(length=16), nullable=True),
        _ts_default(),
    )
    op.create_index("report_schedule_user_idx", "report_schedule", ["username"])

    op.create_table(
        "report_run",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("schedule_id", sa.BigInteger, nullable=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("report_type", sa.String(length=32), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("pdf_uri", sa.Text, nullable=True),
        sa.Column("html_uri", sa.Text, nullable=True),
        sa.Column("data", JSONB, nullable=True),
        sa.Column("ai_summary", sa.Text, nullable=True),
        _ts_default(),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("report_run_user_type_period_idx", "report_run", ["username", "report_type", "period_end"])

    # ─── B.13 Tax / lots ───────────────────────────────────────
    op.create_table(
        "lot",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("acquisition_date", sa.Date, nullable=False),
        sa.Column("acquisition_qty", sa.Numeric(20, 4), nullable=False),
        sa.Column("acquisition_price", sa.Numeric(20, 6), nullable=False),
        sa.Column("parent_trade_id", sa.BigInteger, nullable=True),
        sa.Column("lot_method", sa.String(length=8), nullable=False, server_default="fifo"),
        sa.Column("disposed_qty", sa.Numeric(20, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("disposed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disposal_trade_id", sa.BigInteger, nullable=True),
        sa.Column("cost_basis_adjusted", sa.Numeric(20, 6), nullable=True),
        sa.Column("holding_period_classification", sa.String(length=8), nullable=True),
        sa.Column("lot_id_external", sa.String(length=64), nullable=True, unique=True),
    )
    op.create_index("lot_user_symbol_acq_idx", "lot", ["username", "symbol", "acquisition_date"])

    op.create_table(
        "wash_sale_adjustment",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("loss_lot_id", sa.BigInteger, nullable=False),
        sa.Column("replacement_lot_id", sa.BigInteger, nullable=False),
        sa.Column("disallowed_loss_amount", sa.Numeric(20, 6), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("rule_window_days", sa.Integer, nullable=False, server_default=sa.text("30")),
        sa.Column("notes", sa.Text, nullable=True),
    )

    # ─── B.14 Impersonation ────────────────────────────────────
    op.create_table(
        "impersonation_session",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("operator_username", sa.String(length=255), nullable=False),
        sa.Column("target_username", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("consent_token", sa.String(length=48), nullable=True, unique=True),
    )
    op.create_index("impersonation_op_idx", "impersonation_session", ["operator_username", "started_at"])
    op.create_index("impersonation_tgt_idx", "impersonation_session", ["target_username", "started_at"])

    # ─── B.16 User settings ────────────────────────────────────
    op.create_table(
        "user_settings",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False, unique=True),
        sa.Column("default_broker_connection_id", sa.BigInteger, nullable=True),
        sa.Column("slippage_tolerance_bps", sa.Numeric(8, 2), nullable=False, server_default=sa.text("10")),
        sa.Column("default_order_qty", sa.Integer, nullable=False, server_default=sa.text("100")),
        sa.Column("fast_fill_confirms", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("appearance", JSONB, nullable=True),
        sa.Column("shortcuts", JSONB, nullable=True),
        sa.Column("feed_providers", JSONB, nullable=True),
        _ts_default(),
        _ts_updated(),
    )

    # ─── B.17 Billing ──────────────────────────────────────────
    op.create_table(
        "plan",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tier_slug", sa.String(length=32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("monthly_price_usd", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("features", JSONB, nullable=True),
        sa.Column("max_brokers", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("paper_only", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )
    # Seed the 4 plan tiers from the v2 pricing page.
    for slug, name, price, max_brokers, paper_only in (
        ("free", "Free", 0, 1, True),
        ("starter", "Starter", 49, 1, False),
        ("pro", "Pro", 199, 3, False),
        ("operator", "Operator", 0, 99, False),
    ):
        op.execute(
            sa.text(
                "INSERT INTO plan (tier_slug, display_name, monthly_price_usd, max_brokers, paper_only) "
                "VALUES (:slug, :name, :price, :max_brokers, :paper_only) ON CONFLICT (tier_slug) DO NOTHING"
            ).bindparams(slug=slug, name=name, price=price, max_brokers=max_brokers, paper_only=paper_only)
        )

    op.create_table(
        "subscription",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("plan_id", sa.BigInteger, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("stripe_customer_id", sa.String(length=120), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=120), nullable=True, unique=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_end", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("subscription_user_status_idx", "subscription", ["username", "status"])

    op.create_table(
        "billing_event",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("subscription_id", sa.BigInteger, nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ─── B.18 Documentation ────────────────────────────────────
    op.create_table(
        "doc_category",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(length=64), nullable=False, unique=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "doc_article",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("category_id", sa.BigInteger, nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False, unique=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body_markdown", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text, nullable=True),
        sa.Column("author", sa.String(length=255), nullable=True),
        _ts_default(),
        _ts_updated(),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("doc_article_category_idx", "doc_article", ["category_id"])

    # Seed default v2 doc category + welcome article.
    op.execute(
        sa.text(
            "INSERT INTO doc_category (slug, title, position) VALUES ('v2', 'v2 Redesign', 0) "
            "ON CONFLICT (slug) DO NOTHING"
        )
    )


def downgrade() -> None:
    # Drop in reverse order. All v2 Phase B tables are additive;
    # reverting leaves the existing app fully functional.
    for table in (
        "doc_article",
        "doc_category",
        "billing_event",
        "subscription",
        "plan",
        "user_settings",
        "impersonation_session",
        "wash_sale_adjustment",
        "lot",
        "report_run",
        "report_schedule",
        "recommendation_snapshot",
        "onboarding_questionnaire",
        "backtest_run_publication",
        "backtest_run",
        "strategy_playbook_version",
        "strategy_playbook",
        "feature_flag_override",
        "feature_flag",
        "jarvis_intent",
        "user_layout_config",
        "welcome_template",
        "reject_reason_template",
        "notification_preference",
        "notification",
        "watchlist_item",
        "watchlist",
        "agent_control",
        "pipeline_stage_state",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
