"""Coverage for the outbound-prompt PII scrubber.

Wave 6γ (Round 5 deferred + persona-108) expanded the scrub patterns
to cover bearer tokens, JWTs, and Alpaca API keys in addition to the
original username / UUID / IP / email set. Every outbound Claude prompt
flows through ``_scrub_pii`` via ``BaseAgent._build_prompt`` — if any
of these patterns leak, the token lands in a sub-processor's system.

This module drives the patterns DIRECTLY rather than through a full
agent run. The chokepoint is the regex set; the agent plumbing is
covered elsewhere.
"""

from __future__ import annotations


def test_bearer_token_scrubbed() -> None:
    """``Bearer <token>`` → ``Bearer <TOKEN>``.

    Covers the common Authorization-header shape that tends to sneak
    into agent context dumps ("I called the broker with headers
    Authorization: Bearer abc..."). Keeps the scheme name so the
    downstream prompt still reads naturally.
    """
    from agents.base import _scrub_pii

    # Typical header value.
    txt = "Authorization header was Bearer eyJhbGci0iJIUzI1NiJ9 last call"
    out = _scrub_pii(txt)
    assert "Bearer <TOKEN>" in out
    assert "eyJhbGci0iJIUzI1NiJ9" not in out

    # With punctuation / underscores in the token body.
    txt2 = "Bearer abc_def.123-xyz on the line"
    out2 = _scrub_pii(txt2)
    assert "abc_def.123-xyz" not in out2
    assert "Bearer <TOKEN>" in out2


def test_jwt_scrubbed() -> None:
    """A full three-segment JWT is redacted.

    Every JWT in the wild starts ``eyJ`` (the base64 encoding of the
    opening two chars of the header JSON). The pattern requires two
    ``eyJ``-prefix segments plus a signature segment — conservative
    enough to avoid matching arbitrary base64url strings.
    """
    from agents.base import _scrub_pii

    jwt = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTZ9"
        ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    )
    txt = f"Session token is {jwt} please do not leak"
    out = _scrub_pii(txt)
    assert "<JWT>" in out
    assert jwt not in out
    # And the unsigned segments individually should also be gone.
    assert "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" not in out


def test_jwt_scrub_is_idempotent() -> None:
    """Running the scrub twice is a no-op — required for the build-
    prompt chokepoint where upstream callers might already have
    pre-sanitised partial prompts."""
    from agents.base import _scrub_pii

    jwt = "eyJabc.eyJdef.xyz123"
    once = _scrub_pii(f"tok={jwt}")
    twice = _scrub_pii(once)
    assert once == twice
    assert "<JWT>" in twice


def test_alpaca_key_scrubbed() -> None:
    """Alpaca key-id (``PK...``) is redacted to ``<ALPACA_KEY>``.

    The key-id prefix plus a long upper-alnum tail is distinctive; we
    keep a 16-char floor to avoid chewing up short ticker-like
    substrings like ``PKX`` or ``PKG``.
    """
    from agents.base import _scrub_pii

    key = "PKABCDEFGHIJKLMNOP12345"
    txt = f"The broker credential is {key} for this run"
    out = _scrub_pii(txt)
    assert "<ALPACA_KEY>" in out
    assert key not in out


def test_alpaca_secret_scrubbed() -> None:
    """Alpaca secret (``SK...``) is redacted to ``<ALPACA_SECRET>``."""
    from agents.base import _scrub_pii

    sec = "SKXYZ9876543210ABCDEF"
    txt = f"SECRET={sec} — never log"
    out = _scrub_pii(txt)
    assert "<ALPACA_SECRET>" in out
    assert sec not in out


def test_alpaca_short_prefix_not_scrubbed() -> None:
    """A short PK/SK-prefix run MUST NOT be scrubbed.

    The 16-char floor prevents the redactor from mangling legitimate
    text like the ``SK`` ticker or a phrase that mentions "PKG" in
    passing. Regression guard — shortening the floor below 16 would
    re-introduce false positives on short tickers.
    """
    from agents.base import _scrub_pii

    short = "SK trades in Thailand; PKG is Packaging Corp"
    out = _scrub_pii(short)
    assert "<ALPACA_KEY>" not in out
    assert "<ALPACA_SECRET>" not in out
    assert "SK" in out and "PKG" in out


def test_existing_patterns_still_work() -> None:
    """Regression guard on the pre-existing IP / UUID / email patterns —
    the new credential patterns must scrub BEFORE the old ones, not
    replace them."""
    from agents.base import _scrub_pii

    txt = (
        "client ip 192.0.2.42, broker order id "
        "11111111-2222-3333-4444-555555555555, email user@example.com"
    )
    out = _scrub_pii(txt)
    assert "<IP>" in out and "192.0.2.42" not in out
    assert "<BROKER_ORDER_ID>" in out
    assert "<EMAIL>" in out and "user@example.com" not in out
