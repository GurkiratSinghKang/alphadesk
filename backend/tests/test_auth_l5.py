"""Round-6 L-5 — JWT iss/aud/iat/nbf claim hardening."""
from __future__ import annotations

import os

# Set JWT secret BEFORE any module imports core.config so settings boots
# cleanly. tests/conftest.py adds the backend dir to sys.path; we need
# the env vars to land before the first ``from core.config import settings``
# runs in any imported helper.
os.environ.setdefault("JWT_SECRET", "test-secret-for-l5-" + "x" * 32)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SKIP_DB_INIT", "true")

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest


def _decode_unverified(token: str) -> dict[str, Any]:
    """Peek at the JWT payload without verifying — used to assert claims."""
    import jwt as _jwt

    return _jwt.decode(token, options={"verify_signature": False})


def test_access_token_carries_iss_aud_iat_nbf():
    """L-5: every newly-minted access token must include the new claims."""
    from core.auth import (
        JWT_AUDIENCE,
        JWT_ISSUER,
        create_access_token,
    )

    token = create_access_token("admin")
    payload = _decode_unverified(token)
    assert payload["iss"] == JWT_ISSUER
    assert payload["aud"] == JWT_AUDIENCE
    assert "iat" in payload
    assert "nbf" in payload
    # iat ≤ exp and iat ≈ now (within a few seconds).
    now = datetime.now(timezone.utc).timestamp()
    assert abs(int(payload["iat"]) - now) < 5
    assert int(payload["iat"]) <= int(payload["exp"])


def test_refresh_token_carries_iss_aud_iat_nbf():
    """Refresh tokens get the same claims."""
    from core.auth import (
        JWT_AUDIENCE,
        JWT_ISSUER,
        create_refresh_token,
    )

    token = create_refresh_token("admin")
    payload = _decode_unverified(token)
    assert payload["iss"] == JWT_ISSUER
    assert payload["aud"] == JWT_AUDIENCE
    assert "iat" in payload
    assert "nbf" in payload


def test_decode_token_accepts_round6_token():
    """A token minted now decodes cleanly under the new validator."""
    from core.auth import create_access_token, decode_token

    token = create_access_token("admin")
    payload = decode_token(token)
    assert payload["sub"] == "admin"


def test_decode_token_rejects_wrong_issuer():
    """A token with the wrong ``iss`` claim must 401."""
    import jwt as _jwt
    from fastapi import HTTPException

    from core.auth import ALGORITHM, JWT_AUDIENCE, decode_token
    from core.config import settings

    now = datetime.now(timezone.utc)
    bad = _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(hours=1),
            "iat": now,
            "nbf": now,
            "iss": "rogue-service",
            "aud": JWT_AUDIENCE,
            "type": "access",
            "jti": "x",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(bad)
    assert exc_info.value.status_code == 401
    assert "issuer" in exc_info.value.detail.lower()


def test_decode_token_rejects_wrong_audience():
    """A token with the wrong ``aud`` claim must 401."""
    import jwt as _jwt
    from fastapi import HTTPException

    from core.auth import ALGORITHM, JWT_ISSUER, decode_token
    from core.config import settings

    now = datetime.now(timezone.utc)
    bad = _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(hours=1),
            "iat": now,
            "nbf": now,
            "iss": JWT_ISSUER,
            "aud": "rogue-api",
            "type": "access",
            "jti": "x",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(bad)
    assert exc_info.value.status_code == 401
    assert "audience" in exc_info.value.detail.lower()


def test_decode_token_accepts_recent_legacy_token():
    """A legacy token (no iss/aud) minted within grace is accepted."""
    import jwt as _jwt

    from core.auth import ALGORITHM, decode_token
    from core.config import settings

    now = datetime.now(timezone.utc)
    legacy = _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(hours=1),
            "iat": now,  # fresh — within grace window
            "type": "access",
            "jti": "x",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    payload = decode_token(legacy)
    assert payload["sub"] == "admin"


def test_decode_token_rejects_old_legacy_token():
    """A legacy token older than the grace window must 401."""
    import jwt as _jwt
    from fastapi import HTTPException

    from core.auth import (
        ALGORITHM,
        LEGACY_TOKEN_GRACE_SECONDS,
        decode_token,
    )
    from core.config import settings

    now = datetime.now(timezone.utc)
    # iat well outside the grace window. exp also moved up to NOT trip
    # PyJWT's exp validator — we want decode_token's L-5 grace check
    # to fire, not the standard exp check.
    legacy = _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(hours=1),
            "iat": (
                now - timedelta(seconds=LEGACY_TOKEN_GRACE_SECONDS + 86400)
            ),
            "type": "access",
            "jti": "x",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(legacy)
    assert exc_info.value.status_code == 401
    assert "legacy token" in exc_info.value.detail.lower()


def test_decode_token_rejects_legacy_token_missing_iat():
    """A pre-Wave-2I token without iat at all must 401."""
    import jwt as _jwt
    from fastapi import HTTPException

    from core.auth import ALGORITHM, decode_token
    from core.config import settings

    now = datetime.now(timezone.utc)
    pre_wave_2i = _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(hours=1),
            "type": "access",
            "jti": "x",
            # no iat, no iss/aud, no pv/epoch
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(pre_wave_2i)
    assert exc_info.value.status_code == 401
