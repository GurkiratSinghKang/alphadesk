"""Round-6 L-10 + L-11 — ChatRequest pydantic validators."""
from __future__ import annotations

import os

# Set settings before any module imports core.config.
os.environ.setdefault("JWT_SECRET", "test-secret-for-l10-l11-" + "x" * 32)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SKIP_DB_INIT", "true")

import pytest


def test_conversation_id_accepts_alphanumeric_dash():
    """Plain alnum + dash IDs (e.g. UUIDs) are allowed."""
    from api.routes.agents import ChatRequest

    body = ChatRequest(
        message="hi",
        conversation_id="abc123-DEF",
    )
    assert body.conversation_id == "abc123-DEF"


def test_conversation_id_accepts_uuid_shape():
    """A UUID4 string passes."""
    from api.routes.agents import ChatRequest

    body = ChatRequest(
        message="hi",
        conversation_id="550e8400-e29b-41d4-a716-446655440000",
    )
    assert body.conversation_id is not None


def test_conversation_id_accepts_none():
    """The field is optional."""
    from api.routes.agents import ChatRequest

    body = ChatRequest(message="hi")
    assert body.conversation_id is None


def test_conversation_id_rejects_colon_separator():
    """A ``:`` would let an attacker break out of the Redis key prefix."""
    from api.routes.agents import ChatRequest

    with pytest.raises(ValueError):
        ChatRequest(message="hi", conversation_id="foo:bar")


def test_conversation_id_rejects_glob_chars():
    """Redis SCAN glob chars MUST not pass."""
    from api.routes.agents import ChatRequest

    for bad in ("foo*", "foo?", "foo[a-z]", "foo bar", "../escape"):
        with pytest.raises(ValueError):
            ChatRequest(message="hi", conversation_id=bad)


def test_conversation_id_rejects_too_long():
    """65+ chars is over the cap."""
    from api.routes.agents import ChatRequest

    with pytest.raises(ValueError):
        ChatRequest(message="hi", conversation_id="a" * 65)


def test_context_accepts_small_dict():
    """A typical context (a few keys, < 1 KB) passes."""
    from api.routes.agents import ChatRequest

    body = ChatRequest(
        message="hi",
        context={"symbol": "NVDA", "iv_rank": 78, "positions": []},
    )
    assert body.context["symbol"] == "NVDA"


def test_context_rejects_oversize_payload():
    """A 16 KB context (over the 8 KiB cap) is rejected."""
    from api.routes.agents import ChatRequest

    big_string = "x" * 16_000
    with pytest.raises(ValueError):
        ChatRequest(
            message="hi",
            context={"big": big_string},
        )


def test_context_accepts_empty_dict():
    """Empty default is fine."""
    from api.routes.agents import ChatRequest

    body = ChatRequest(message="hi")
    assert body.context == {}
