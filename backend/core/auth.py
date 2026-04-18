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


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "access", "jti": str(uuid.uuid4())},
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "refresh", "jti": str(uuid.uuid4())},
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_value, algorithms=[ALGORITHM])
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    return payload


async def is_token_revoked(jti: str) -> bool:
    """Check if a token has been revoked.

    FAILS OPEN on Redis unavailability (returns False — treat as not revoked).

    Rationale:
      * The token revocation blocklist is defence-in-depth. The primary auth
        check is the JWT signature + expiry, which runs entirely in-process
        and is unaffected by Redis state.
      * The previous fail-closed behaviour meant a 5-second Redis restart
        logged out every user across every browser tab — a self-inflicted DoS
        that was far more likely to bite us than a token-revocation bypass.
      * To keep *some* defence during an outage, we cache recent lookups for
        _REVOCATION_CACHE_TTL_SEC so revocations made shortly before the
        outage remain effective.

    Behaviour:
      * Redis up, jti in blocklist -> True, cache answer.
      * Redis up, jti not in blocklist -> False, cache answer.
      * Redis down, cache hit -> return cached value (possibly stale but
        better than nothing).
      * Redis down, no cache -> False + warning log (fail open).
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
            logger.warning(
                "Redis unavailable in is_token_revoked — failing OPEN "
                "(defence-in-depth check skipped; JWT sig+exp still enforced)"
            )
            _last_redis_warning_ts = now

        # Fall back to cached answer if we have one that's still within its TTL.
        if cached is not None:
            revoked, expiry = cached
            if expiry >= now:
                return revoked

        # Last resort: fail open. The JWT signature + expiry checks are the
        # primary auth mechanism and run just fine without Redis.
        return False


async def revoke_token(token: str) -> None:
    """Add a token to the revocation blocklist."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_value, algorithms=[ALGORITHM], options={"verify_exp": False})
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

    # Check revocation
    jti = payload.get("jti")
    if jti and await is_token_revoked(jti):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    username: str | None = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return username
