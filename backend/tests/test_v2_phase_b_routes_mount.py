"""Smoke test for v2 Phase B route registration.

Verifies that every B.1–B.18 endpoint defined in the redesign plan
is mounted on the FastAPI app under the expected prefix. Doesn't
exercise the handlers (auth + DB are mocked elsewhere); only checks
that the routes exist.

This protects against accidental removals during the v2 follow-up
cycle — anyone refactoring the v2 routers will see this fail before
the frontend hits a 404.
"""
from __future__ import annotations


def _route_paths(app) -> set[str]:
    out: set[str] = set()
    for r in app.routes:
        path = getattr(r, "path", None)
        if path:
            out.add(path)
    return out


def test_v2_phase_b_routes_mounted() -> None:
    """Every v2 backend slice must register its expected paths."""
    import os

    os.environ.setdefault("SKIP_DB_INIT", "true")
    os.environ.setdefault("JWT_SECRET", "test-secret-key-32-chars-minimum")

    import importlib

    main = importlib.import_module("main")
    paths = _route_paths(main.app)

    expected = {
        # B.1 Pipeline stages
        "/api/v1/pipeline/stages",
        "/api/v1/pipeline/stages/{stage}/pause",
        "/api/v1/pipeline/stages/{stage}/resume",
        # B.2 Agent control
        "/api/v1/agents/controls",
        "/api/v1/agents/controls/{control_id}",
        # B.3 Watchlists v2
        "/api/v1/watchlists",
        "/api/v1/watchlists/{watchlist_id}",
        "/api/v1/watchlists/{watchlist_id}/items",
        "/api/v1/watchlists/{watchlist_id}/items/{symbol}",
        # B.4 Notifications inbox
        "/api/v1/notifications",
        "/api/v1/notifications/{notification_id}/read",
        "/api/v1/notifications/read-all",
        "/api/v1/notifications/preferences",
        "/api/v1/notifications/preferences/{type}",
        # B.6 User layout config
        "/api/v1/user/layout",
        # B.8 Feature flags
        "/api/v1/feature-flags",
        "/api/v1/admin/feature-flags",
        "/api/v1/admin/feature-flags/{key}",
        # B.16 User settings
        "/api/v1/user/settings",
        "/api/v1/user/settings/reset",
        # B.5 Templates (read)
        "/api/v1/access-requests/templates/reject-reasons",
        "/api/v1/access-requests/templates/welcome",
        # B.9 Strategy playbook
        "/api/v1/strategies/{strategy}/playbook",
        # B.10 Backtest
        "/api/v1/backtest/runs",
        # B.11 Onboarding
        "/api/v1/onboarding/state",
        "/api/v1/onboarding/answers",
        # B.12 Reports
        "/api/v1/reports/runs",
        "/api/v1/reports/runs/{run_id}/download/{format}",
        # B.13 Tax
        "/api/v1/tax/lots",
        "/api/v1/tax/wash-sales",
        # B.14 Impersonation
        "/api/v1/admin/impersonate/start",
        "/api/v1/admin/impersonate/active",
        # B.15 Bulk
        "/api/v1/admin/users/bulk/suspend",
        # B.17 Billing
        "/api/v1/billing/plans",
        "/api/v1/billing/subscription",
        "/api/v1/billing/webhook",
        # B.18 Documentation
        "/api/v1/docs/categories",
        "/api/v1/docs/articles",
        # B.7 Jarvis
        "/api/v1/jarvis/history",
        "/api/v1/jarvis/parse",
        "/api/v1/jarvis/confirm/{intent_id}",
        "/api/v1/jarvis/modules",
    }

    missing = expected - paths
    assert not missing, f"v2 Phase B routes missing: {sorted(missing)}"


def test_v2_models_register() -> None:
    """All 27 v2 model classes must register on Base.metadata."""
    from data.storage.models import _define_models

    models = _define_models()
    expected_v2_models = {
        # B.1
        "PipelineStageState",
        # B.2
        "AgentControl",
        # B.3
        "Watchlist",
        "WatchlistItem",
        # B.4
        "Notification",
        "NotificationPreference",
        # B.5
        "RejectReasonTemplate",
        "WelcomeTemplate",
        # B.6
        "UserLayoutConfig",
        # B.7
        "JarvisIntent",
        # B.8
        "FeatureFlag",
        "FeatureFlagOverride",
        # B.9
        "StrategyPlaybook",
        "StrategyPlaybookVersion",
        # B.10
        "BacktestRun",
        "BacktestRunPublication",
        # B.11
        "OnboardingQuestionnaire",
        "RecommendationSnapshot",
        # B.12
        "ReportSchedule",
        "ReportRun",
        # B.13
        "Lot",
        "WashSaleAdjustment",
        # B.14
        "ImpersonationSession",
        # B.16
        "UserSettings",
        # B.17
        "Plan",
        "Subscription",
        "BillingEvent",
        # B.18
        "DocCategory",
        "DocArticle",
    }
    missing = expected_v2_models - set(models.keys())
    assert not missing, f"v2 model classes missing from cache: {sorted(missing)}"
