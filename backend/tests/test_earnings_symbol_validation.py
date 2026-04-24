"""Tests for B-51 — path-param validation on /earnings/{symbol}/* routes.

The symbol eventually flows into Redis cache keys and Claude prompt
strings, so malformed inputs (traversal sequences, control characters,
lowercase) must be rejected at the edge. FastAPI's ``Path(pattern=...)``
returns 422 when the regex fails — we assert that plus preservation of
legitimate dot-suffix tickers (BRK.B, BF.B, RDS.A).
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from core.auth import require_auth


async def _fake_user() -> str:
    return "test_user"


app.dependency_overrides[require_auth] = _fake_user
client = TestClient(app)


def _stub_detail(symbol: str):
    from api.schemas.earnings import EarningsDetail
    return EarningsDetail(
        symbol=symbol,
        company=symbol,
        sector="",
        report_date=None,
        report_time="DMT",
        quote=None,
        metrics=None,
        strike_ladder=None,
        claude_structured=None,
        claude_full_research=None,
        historical_earnings=None,
        iv_term_structure=None,
        skew=None,
        news=[],
        partial=False,
        generated_at=datetime.now(timezone.utc),
    )


# ───────────────────────── rejection cases ─────────────────────────


def test_detail_rejects_path_traversal():
    """URL-encoded ../ injection in the symbol path is refused.

    Starlette decodes ``%2F`` to ``/`` BEFORE route matching, so a
    traversal-style URL never reaches the handler and comes back 404
    (no matching route) rather than 422. Either status proves the
    input can't poison the Redis cache key or Claude prompt. Accept
    both so the test is stable across Starlette versions."""
    r = client.get("/api/v1/earnings/..%2F..%2Fetc%2Fpasswd/detail")
    assert r.status_code in (404, 422)


def test_detail_rejects_null_byte_injection():
    """URL-encoded null byte appended to an otherwise-valid symbol
    still fails the regex at the handler edge (422)."""
    r = client.get("/api/v1/earnings/AAPL%00/detail")
    assert r.status_code == 422


def test_detail_rejects_dollar_sign():
    """Any character outside [A-Z.] fails the pattern."""
    r = client.get("/api/v1/earnings/A$/detail")
    assert r.status_code == 422


def test_detail_rejects_lowercase_symbol():
    """Lowercase doesn't match ``^[A-Z]{1,6}(\\.[A-Z])?$`` — 422."""
    r = client.get("/api/v1/earnings/aapl/detail")
    assert r.status_code == 422


def test_detail_rejects_digits():
    """Numeric characters are not in the allowed set."""
    r = client.get("/api/v1/earnings/AAPL1/detail")
    assert r.status_code == 422


def test_detail_rejects_too_long():
    """More than 6 letters (before optional .X suffix) fails the pattern."""
    r = client.get("/api/v1/earnings/ABCDEFG/detail")
    assert r.status_code == 422


def test_detail_rejects_multi_dot():
    """Only one dot-letter suffix is allowed (``BRK.B``, not ``A.B.C``)."""
    r = client.get("/api/v1/earnings/A.B.C/detail")
    assert r.status_code == 422


def test_full_research_rejects_path_traversal():
    """Same validation applies to the /full-research route. Either 404
    (route mismatch after %2F decoding) or 422 (pattern mismatch in the
    handler) proves the input can't reach Opus."""
    r = client.post("/api/v1/earnings/..%2F..%2Fetc%2Fpasswd/full-research")
    assert r.status_code in (404, 422)


def test_full_research_rejects_control_chars():
    """Null byte or carriage-return in the symbol kills the route."""
    # URL-encoded \n
    r = client.post("/api/v1/earnings/AA%0ABB/full-research")
    assert r.status_code == 422


# ───────────────────────── acceptance cases ─────────────────────────


def test_detail_accepts_plain_symbol():
    with patch(
        "services.earnings_screener.get_detail",
        AsyncMock(return_value=_stub_detail("AAPL")),
    ):
        r = client.get("/api/v1/earnings/AAPL/detail")
    assert r.status_code == 200


def test_detail_accepts_dot_suffix_brk_b():
    """BRK.B is the canonical dot-suffix ticker we must preserve."""
    with patch(
        "services.earnings_screener.get_detail",
        AsyncMock(return_value=_stub_detail("BRK.B")),
    ):
        r = client.get("/api/v1/earnings/BRK.B/detail")
    assert r.status_code == 200


def test_detail_accepts_dot_suffix_bf_b():
    with patch(
        "services.earnings_screener.get_detail",
        AsyncMock(return_value=_stub_detail("BF.B")),
    ):
        r = client.get("/api/v1/earnings/BF.B/detail")
    assert r.status_code == 200


def test_full_research_accepts_plain_symbol():
    from api.schemas.earnings import ClaudeFullResearch
    from api.routes import _rate_limit as rl
    rl._reset_for_tests()  # don't trip the B-50 limiter from a prior test
    fake = ClaudeFullResearch(
        thesis_paragraph="stub",
        comparable_setups=[],
        post_earnings_drift_playbook="stub",
        sector_backdrop="stub",
        analyst_consensus_delta="stub",
        what_would_change_my_mind="stub",
        confidence=0.5,
        model="claude-stub",
        generated_at=datetime.now(timezone.utc),
    )
    with patch(
        "services.earnings_screener.run_full_research",
        AsyncMock(return_value=fake),
    ):
        r = client.post("/api/v1/earnings/AAPL/full-research")
    assert r.status_code == 200
    rl._reset_for_tests()
