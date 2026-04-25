from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

# In-process cache of revocation lookups, so a brief Redis blip doesn't 401
# every authenticated request while it's down. Keyed by jti, value is
# (revoked_bool, unix_epoch_expiry_of_this_cache_entry). Short TTL keeps the
# blast radius of a rogue cached answer small.
_REVOCATION_CACHE: dict[str, tuple[bool, float]] = {}
_REVOCATION_CACHE_TTL_SEC = 60  # cache a known-good lookup for 60s
_REVOCATION_CACHE_MAX = 50_000  # bound memory

# Flag so we don't spam a warning on every request during a Redis outage.
_last_redis_warning_ts: float = 0.0

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError

from core.config import settings

bearer_scheme = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"

# JWT clock-skew tolerance (Fix 4, P83-4). Tor users routinely drift ±30s
# because their system clocks are NTP-starved over .onion paths. Without
# leeway, a login that travels through two hops can 401 on the first
# authenticated request if the exit node's clock is ahead of the server.
# 60s is the pragmatic upper bound: long enough for every real-world drift
# we've seen, short enough that a stolen token doesn't outlive its nominal
# expiry for more than a minute.
JWT_CLOCK_SKEW_LEEWAY_SECONDS = 60

# Round-6 L-5: JWT issuer + audience claims. Without these, a token
# signed with our secret could in theory be accepted by another
# service that shares the secret. Issuer pins the ``alphadesk`` brand
# into every token; audience pins the API surface so a token minted
# for an auxiliary tool can't be accepted on the user-facing API.
JWT_ISSUER = "alphadesk"
JWT_AUDIENCE = "alphadesk-api"

# Round-6 L-5: backwards-compat window. Tokens minted before this
# rollout (without ``iss``/``aud``) are accepted as long as their
# ``iat`` is younger than ``LEGACY_TOKEN_GRACE_SECONDS`` (default 30
# days — the refresh token max lifetime). After the grace window, every
# token must carry the new claims or it 401s.
LEGACY_TOKEN_GRACE_SECONDS = 30 * 24 * 3600


# ---------------------------------------------------------------------------
# Password-version and session-epoch stores (Wave 2I, Fix 1 + Fix 3).
# ---------------------------------------------------------------------------
# Both counters live in Redis under the key prefixes ``password_version:`` and
# ``session_epoch:``. Every access token carries the issuing-time values as
# ``pv`` and ``epoch`` claims; ``require_auth`` rejects the token if the
# claim is strictly less than the current server-side counter.
#
# Fix 1 — POST /auth/change-password bumps ``password_version``. This
# invalidates every outstanding access AND refresh token for the user because
# they were minted under the prior pv value. This replaces the old behaviour
# where a compromised password remained dangerous for the full refresh-token
# lifetime (up to 30 days).
#
# Fix 3 — POST /auth/logout-all bumps ``session_epoch`` for the same effect
# without touching the password. Useful when the user suspects a stolen
# cookie but does not want to change credentials (or wants to kick every
# other device while staying logged in themselves — the caller gets a fresh
# pair of cookies in the same response, minted against the new epoch).
#
# Fail-closed: Redis unavailability during the counter READ means we cannot
# prove the token is still valid, so we reject. This is consistent with the
# revocation blocklist's stance — a stolen token must NOT ride out a Redis
# outage. Users re-login; security holds.

_PASSWORD_VERSION_KEY_PREFIX = "password_version:"
_SESSION_EPOCH_KEY_PREFIX = "session_epoch:"


async def get_password_version(username: str) -> int:
    """Return the current password_version for ``username`` (default 1).

    Raises HTTPException(503) on Redis error so ``require_auth`` can fail
    closed. The 503 bubbles up as a 503 response body rather than 401 so the
    caller can distinguish "Redis is down" from "your token is bad".
    """
    try:
        from core.redis import get_redis
        r = await get_redis()
        raw = await r.get(f"{_PASSWORD_VERSION_KEY_PREFIX}{username}")
        return int(raw) if raw is not None else 1
    except Exception:
        logger.warning("get_password_version: redis unavailable", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth backend unavailable, please retry",
        )


async def bump_password_version(username: str) -> int:
    """Increment ``password_version:{username}`` and return the new value.

    The public default (``get_password_version`` when the key is missing)
    is 1 — that's the value embedded in every token minted by the initial
    login. So a bump has to move PAST 1 to invalidate those tokens, which
    means the first bump must land on 2 (not 1).

    Native Redis INCR on a missing key returns 1, which matches "we now
    have a counter" semantics but fails the "bigger than the tokens in
    flight" invariant we need. So we seed the key to the current effective
    value (1 if missing, else the stored integer) and then increment.

    The seed + incr isn't atomic, but the tiny race window (two admins
    changing the password at the exact same millisecond) lands on a
    consistent strictly-greater value in both branches, which is all the
    invariant requires.
    """
    from core.redis import get_redis
    r = await get_redis()
    key = f"{_PASSWORD_VERSION_KEY_PREFIX}{username}"
    raw = await r.get(key)
    current = int(raw) if raw is not None else 1
    new_val = current + 1
    await r.set(key, str(new_val))
    return new_val


async def get_session_epoch(username: str) -> int:
    """Return the current session_epoch for ``username`` (default 1).

    Same failure semantics as ``get_password_version`` — 503 on Redis error.
    """
    try:
        from core.redis import get_redis
        r = await get_redis()
        raw = await r.get(f"{_SESSION_EPOCH_KEY_PREFIX}{username}")
        return int(raw) if raw is not None else 1
    except Exception:
        logger.warning("get_session_epoch: redis unavailable", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth backend unavailable, please retry",
        )


async def bump_session_epoch(username: str) -> int:
    """Increment ``session_epoch:{username}`` and return the new value.

    See ``bump_password_version`` for the seed-then-incr rationale — same
    invariant (bump must land strictly greater than the tokens currently
    in flight, which are all at epoch=1).
    """
    from core.redis import get_redis
    r = await get_redis()
    key = f"{_SESSION_EPOCH_KEY_PREFIX}{username}"
    raw = await r.get(key)
    current = int(raw) if raw is not None else 1
    new_val = current + 1
    await r.set(key, str(new_val))
    return new_val


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(
    subject: str,
    *,
    password_version: int = 1,
    session_epoch: int = 1,
) -> str:
    """Mint a short-lived access token.

    ``password_version`` and ``session_epoch`` are snapshotted into the token
    so later revocation checks (Fix 1, Fix 3) can compare against the live
    server-side counters. Callers that don't supply them default to 1, which
    matches the "never rotated" baseline. Production callers always pass the
    current counters from Redis.

    Round-6 L-5: tokens now carry the standard registered claims
    ``iss`` (issuer = alphadesk), ``aud`` (audience = alphadesk-api),
    ``iat`` (issued-at), and ``nbf`` (not-before).
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {
            "sub": subject,
            "exp": expire,
            "iat": now,
            "nbf": now,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "type": "access",
            "jti": str(uuid.uuid4()),
            "pv": int(password_version),
            "epoch": int(session_epoch),
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def create_refresh_token(
    subject: str,
    *,
    password_version: int = 1,
    session_epoch: int = 1,
) -> str:
    """Mint a long-lived refresh token.

    Round-6 L-5: same ``iss``/``aud``/``iat``/``nbf`` claims as the
    access token — see :func:`create_access_token` for the rationale.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {
            "sub": subject,
            "exp": expire,
            "iat": now,
            "nbf": now,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "type": "refresh",
            "jti": str(uuid.uuid4()),
            "pv": int(password_version),
            "epoch": int(session_epoch),
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure.

    Applies ``JWT_CLOCK_SKEW_LEEWAY_SECONDS`` of leeway on exp/nbf to tolerate
    ±60s drift — see Fix 4 (P83-4). Without leeway, Tor users whose exit-
    node clock drifts past the server got 401 on their first authenticated
    request, because system clocks over .onion paths are NTP-starved.

    Round-6 L-5: enforces ``iss``/``aud`` for tokens that carry them.
    Tokens minted before the rollout (lacking those claims) are accepted
    only if their ``iat`` falls inside :data:`LEGACY_TOKEN_GRACE_SECONDS`
    of "now"; older legacy tokens 401 so an attacker who stashed a token
    from a previous deployment can't replay it indefinitely.
    """
    # First decode WITHOUT enforcing iss/aud so we can detect legacy
    # tokens and fall through to the grace path. The signature, exp,
    # and nbf are still validated.
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_value,
            algorithms=[ALGORITHM],
            leeway=JWT_CLOCK_SKEW_LEEWAY_SECONDS,
            options={"verify_aud": False, "verify_iss": False},
        )
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    # Round-6 L-5: enforce iss/aud when present, allow grace window
    # for legacy tokens.
    issuer = payload.get("iss")
    audience = payload.get("aud")
    if issuer is not None or audience is not None:
        if issuer != JWT_ISSUER:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token issuer"
            )
        if audience != JWT_AUDIENCE:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token audience"
            )
    else:
        iat = payload.get("iat")
        if iat is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing required claims"
            )
        try:
            iat_ts = float(iat)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has invalid iat"
            )
        if (
            datetime.now(timezone.utc).timestamp() - iat_ts
            > LEGACY_TOKEN_GRACE_SECONDS
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Legacy token outside grace window — please re-login",
            )

    return payload


async def is_token_revoked(jti: str) -> bool:
    """Check if a token has been revoked.

    FAILS CLOSED on Redis unavailability (returns True — treat as revoked).

    Rationale (P39 reversal of prior fail-open stance):
      * A stolen refresh or access cookie remains dangerous until the token's
        natural expiry — potentially days for refresh tokens. If Redis is
        down we cannot confirm the blocklist, and the prior behaviour
        ("return False, trust the signature") meant a compromised cookie
        continued working through the outage. That is the worse failure
        mode: an attacker with a captured cookie can ride out a Redis blip,
        while legitimate users can simply re-login.
      * Re-login is a mild UX papercut; silently honouring a stolen token
        during an outage is a security incident.
      * The in-process cache is still consulted first, so brief outages that
        fall within _REVOCATION_CACHE_TTL_SEC of a successful lookup don't
        log anyone out. Only outages longer than the cache TTL force
        re-login.

    Behaviour:
      * Redis up, jti in blocklist -> True, cache answer.
      * Redis up, jti not in blocklist -> False, cache answer.
      * Redis down, cache hit within TTL -> return cached value (lets brief
        blips be invisible).
      * Redis down, no cache -> True + error log (fail closed).
    """
    now = time.time()

    # Cache cleanup — amortised.
    if len(_REVOCATION_CACHE) > _REVOCATION_CACHE_MAX:
        _REVOCATION_CACHE.clear()

    cached = _REVOCATION_CACHE.get(jti)

    try:
        from core.redis import get_redis
        r = await get_redis()
        raw = await r.get(f"revoked:{jti}")
        revoked = raw is not None
        _REVOCATION_CACHE[jti] = (revoked, now + _REVOCATION_CACHE_TTL_SEC)
        return revoked
    except Exception:
        # Redis unavailable.
        global _last_redis_warning_ts
        if now - _last_redis_warning_ts > 30:
            logger.error(
                "Redis unavailable in is_token_revoked — failing CLOSED "
                "(all tokens treated as revoked until Redis recovers). "
                "Users will need to re-login."
            )
            _last_redis_warning_ts = now

        # Fall back to cached answer if we have one that's still within its TTL.
        # This keeps brief Redis blips invisible: if we confirmed this jti was
        # (or wasn't) revoked within the last _REVOCATION_CACHE_TTL_SEC, trust
        # that answer.
        if cached is not None:
            revoked, expiry = cached
            if expiry >= now:
                return revoked

        # Last resort: fail CLOSED. Better to force re-login than to leave
        # stolen cookies live through a Redis outage.
        return True


async def revoke_token(token: str) -> None:
    """Add a token to the revocation blocklist."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_value,
            algorithms=[ALGORITHM],
            options={"verify_exp": False},
            leeway=JWT_CLOCK_SKEW_LEEWAY_SECONDS,
        )
        jti = payload.get("jti")
        if jti:
            from core.redis import cache_set
            # Keep in blocklist until token would have expired anyway
            ttl = max(int(payload.get("exp", 0) - datetime.now(timezone.utc).timestamp()), 0)
            await cache_set(f"revoked:{jti}", {"revoked": True}, ttl_seconds=max(ttl, 60))
    except Exception:
        logger.warning("Token revocation failed", exc_info=True)


async def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — validates Bearer token (header or HttpOnly cookie) and returns username."""
    token: str | None = None

    # 1. Try Authorization header first
    if credentials is not None:
        token = credentials.credentials
    else:
        # 2. Fall back to HttpOnly cookie
        token = request.cookies.get("access_token")

    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(token, expected_type="access")

    # Check revocation blocklist (per-jti kill switch)
    jti = payload.get("jti")
    if jti and await is_token_revoked(jti):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    username: str | None = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    # Password-version check (Fix 1, P81-2). A token minted before the user
    # most recent password change carries a strictly smaller ``pv`` than the
    # current server-side counter. Reject.
    # Legacy tokens (minted pre-Wave-2I) have no ``pv`` claim; treat them as
    # pv=1 so the first password change still invalidates them when the
    # server-side counter bumps to 2.
    token_pv = int(payload.get("pv", 1))
    current_pv = await get_password_version(username)
    if token_pv < current_pv:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalidated by password change",
        )

    # Session-epoch check (Fix 3, P81-6). logout-all bumps this counter to
    # nuke every live session without requiring a password change.
    token_epoch = int(payload.get("epoch", 1))
    current_epoch = await get_session_epoch(username)
    if token_epoch < current_epoch:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidated",
        )

    return username
