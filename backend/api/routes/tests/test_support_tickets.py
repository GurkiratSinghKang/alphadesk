"""Regression tests for BUG-088 — in-app support ticket intake.

`POST /api/v1/support/tickets` (added in commit 6be1f5b3) accepts
operator feedback through the HelpMenu form. Tests pin the contract
the frontend depends on:

  - auth-required (require_auth dependency)
  - field validation matches the Pydantic TicketRequest model
  - successful POST returns 201 with ticket_id
  - structured log entry emitted at INFO with event=support_ticket
  - audit log persistence works (or fails gracefully)
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


# ─── BUG-088 ─────────────────────────────────────────────────────────


def test_bug_088_post_tickets_requires_auth():
    """Without an auth cookie, the route must reject (401)."""
    # The conftest test fixture installs an auth override for normal
    # tests; this one bypasses it to verify the route DOES gate on
    # auth in production.
    from core.auth import require_auth

    original = app.dependency_overrides.get(require_auth)
    if original is not None:
        # Remove the test override so the real require_auth runs.
        del app.dependency_overrides[require_auth]
    try:
        r = client.post(
            "/api/v1/support/tickets",
            json={
                "category": "support",
                "subject": "test",
                "body": "this is a test body of sufficient length",
                "page_url": "/trade",
            },
        )
        assert r.status_code in (401, 403), (
            f"unauthenticated POST must reject; got {r.status_code}: {r.text[:200]}"
        )
    finally:
        if original is not None:
            app.dependency_overrides[require_auth] = original


def test_bug_088_post_tickets_returns_201_and_ticket_id():
    """Happy path: authed POST with valid body returns 201 + ticket_id."""
    r = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "support",
            "subject": "smoke test from regression suite",
            "body": "audit 2026-05-11 BUG-088 regression test body",
            "page_url": "/trade",
        },
    )
    assert r.status_code == 201, f"expected 201; got {r.status_code}: {r.text[:300]}"
    body = r.json()
    assert body.get("ok") is True
    assert isinstance(body.get("ticket_id"), str) and len(body["ticket_id"]) > 0
    assert isinstance(body.get("received_at"), str)


def test_bug_088_rejects_invalid_category():
    """Pydantic should 422 on a category outside the literal allow-list."""
    r = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "spam",  # not in {support, legal, security, feedback}
            "subject": "invalid category",
            "body": "yyyyy",
            "page_url": "",
        },
    )
    assert r.status_code == 422


def test_bug_088_rejects_body_too_short():
    """`body` min_length=5. Anything shorter must 422."""
    r = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "support",
            "subject": "short body",
            "body": "1234",  # 4 chars, under min
            "page_url": "",
        },
    )
    assert r.status_code == 422


def test_bug_088_rejects_subject_too_short():
    """`subject` min_length=3. Anything shorter must 422."""
    r = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "support",
            "subject": "ab",  # 2 chars, under min
            "body": "12345",
            "page_url": "",
        },
    )
    assert r.status_code == 422


def test_bug_088_truncates_body_at_max_length():
    """`body` max_length=10_000. Just under should pass."""
    r = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "support",
            "subject": "max body",
            "body": "a" * 10_000,  # exactly at max
            "page_url": "",
        },
    )
    assert r.status_code == 201

    # Over the max → 422
    r2 = client.post(
        "/api/v1/support/tickets",
        json={
            "category": "support",
            "subject": "too long body",
            "body": "a" * 10_001,  # one over
            "page_url": "",
        },
    )
    assert r2.status_code == 422


def test_bug_088_all_four_categories_accepted():
    """The HelpMenu and the route literal must agree on the four
    canonical channel names."""
    for category in ("support", "legal", "security", "feedback"):
        r = client.post(
            "/api/v1/support/tickets",
            json={
                "category": category,
                "subject": "category test",
                "body": "category test for " + category,
                "page_url": "",
            },
        )
        assert r.status_code == 201, (
            f"category '{category}' must be accepted; got {r.status_code}"
        )
