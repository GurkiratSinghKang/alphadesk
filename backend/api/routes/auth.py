from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from core.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    is_token_revoked,
    require_auth,
    verify_password,
)
from core.config import settings

router = APIRouter()

# Minimum password length when accepting new credentials (signup, password
# change, password reset). Existing bcrypt hashes with shorter passwords are
# NOT re-validated — this is a forward bar only. See security-audit-r3.md
# P1 "No password policy / no lockout on login".
MIN_PASSWORD_LENGTH = 12


def _enforce_password_policy(new_password: str) -> None:
    """Raise 400 if new_password fails the minimum-complexity bar.

    Kept deliberately simple: length-only. Character-class rules encourage
    users to pick `Password1!` and call it a day; 12+ chars of anything is
    a better lower bound than 8 chars of mixed classes.
    """
    if not isinstance(new_password, str) or len(new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )


# ---------------------------------------------------------------------------
# Admin role dependency
# ---------------------------------------------------------------------------
# Exported for use by routers that expose admin-only endpoints (e.g.
# strategies.py — `/admin/risk-monitor`, `/admin/leaderboard`).
#
# Applied to admin routes in future wave — see audit-reports/security-audit-r3.md
# P0 #1. This wave only defines + exports the dependency; strategies.py is
# owned by Wave 12 and will import this in a follow-up round.
#
# require_auth() returns the `sub` claim from the JWT (a username string).
# We compare that against the configured ADMIN_USERNAME. Any future role
# column / multi-user setup can swap this out without touching the call sites.
async def require_admin(username: str = Depends(require_auth)) -> str:
    """FastAPI dependency: require an authenticated admin.

    Raises 403 if the principal's username does not match
    ``settings.ADMIN_USERNAME``. In a multi-user future this should resolve
    against a proper role/permission record on the user row, but until then
    admin identity == "the singleton admin account".
    """
    if username != settings.ADMIN_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return username

# ---------------------------------------------------------------------------
# Login rate limiting: max 5 attempts per IP per 5-minute window (Redis-backed)
# TODO: /agents/chat and /pipeline/run are expensive endpoints and should also
#       be rate limited (those routes live in separate files).
# ---------------------------------------------------------------------------
_RATE_LIMIT_WINDOW = 300  # 5 minutes
_RATE_LIMIT_MAX = 5  # 5 attempts per window per IP (credential-stuffing defence)

# In-memory fallback when Redis is unreachable. Process-local; under multi-worker
# deployment each worker maintains its own table, which still bounds the blast
# radius. Keyed by client IP; value is a list of unix-epoch timestamps of recent
# failed attempts within the window.
_INMEM_ATTEMPTS: dict[str, list[float]] = {}
_INMEM_MAX_KEYS = 10_000  # protect against unbounded memory growth


def _inmem_check(client_ip: str) -> int:
    """Increment in-memory attempt counter and return current count within the window."""
    import time as _t

    now = _t.time()
    window_start = now - _RATE_LIMIT_WINDOW

    # Occasional cleanup so the dict does not grow unbounded across many IPs.
    if len(_INMEM_ATTEMPTS) > _INMEM_MAX_KEYS:
        _INMEM_ATTEMPTS.clear()

    hits = _INMEM_ATTEMPTS.setdefault(client_ip, [])
    # Drop stale timestamps
    hits[:] = [t for t in hits if t >= window_start]
    hits.append(now)
    return len(hits)


async def _check_rate_limit(client_ip: str) -> None:
    """Rate limit login attempts.

    FAIL CLOSED: this is the login endpoint — abuse here is catastrophic
    (credential stuffing, account takeover), so if Redis is down we fall back
    to a per-process in-memory counter instead of simply allowing every
    request through. The in-memory counter is process-local, so a multi-worker
    deployment will permit N * _RATE_LIMIT_MAX attempts while Redis is down,
    which is still dramatically lower than unlimited.
    """
    key = f"login_attempts:{client_ip}"
    count: int
    try:
        from core.redis import get_redis
        redis = await get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, _RATE_LIMIT_WINDOW, nx=True)
        results = await pipe.execute()
        count = int(results[0])
    except Exception as e:
        # Redis unavailable — degrade to in-memory counter rather than allowing
        # uncapped login attempts.
        logger.warning("Rate limit: Redis unavailable, using in-memory fallback: %s", e)
        count = _inmem_check(client_ip)

    if count > _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a few minutes.",
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
        )

def _set_token_cookies(response: JSONResponse, access_token: str, refresh_token: str, expires_in: int) -> None:
    """Set HttpOnly, Secure, SameSite cookies for JWT tokens."""
    is_prod = settings.is_production
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=expires_in,
        httponly=True,
        secure=is_prod,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        secure=is_prod,
        samesite="strict",
        path="/api/v1/auth",
    )


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login")
async def login(request: LoginRequest, req: Request):
    client_ip = req.headers.get("x-forwarded-for", "").split(",")[0].strip() or (req.client.host if req.client else "unknown")
    await _check_rate_limit(client_ip)

    # Strip whitespace from the submitted username BEFORE comparing against
    # the configured admin or counting toward the lockout. A trailing space
    # from a password-manager paste would otherwise be treated as a genuine
    # auth failure. See edge-cases-audit-r3.md I/P1.
    submitted_username = (request.username or "").strip()

    if (
        submitted_username != settings.ADMIN_USERNAME
        or not settings.ADMIN_PASSWORD_HASH
        or not verify_password(request.password, settings.ADMIN_PASSWORD_HASH)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    access_token = create_access_token(submitted_username)
    refresh_token = create_refresh_token(submitted_username)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    # Return tokens in body (for backward compat) AND set HttpOnly cookies
    response = JSONResponse(content={
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": expires_in,
    })
    _set_token_cookies(response, access_token, refresh_token, expires_in)
    return response


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshRequest) -> TokenResponse:
    payload = decode_token(request.refresh_token, expected_type="refresh")
    username = payload.get("sub", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if the old refresh token was already revoked (replay attack detection)
    jti = payload.get("jti")
    if jti and await is_token_revoked(jti):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    # Revoke OLD refresh token FIRST, before minting a new one. If revocation
    # fails (Redis blip), bail out — we cannot guarantee the old token won't
    # be replayed if we've already handed out a new pair.
    from core.auth import revoke_token
    try:
        await revoke_token(request.refresh_token)
    except Exception:
        logger.warning("refresh: failed to revoke old token — aborting", exc_info=True)
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    # Verify the revocation landed. revoke_token() swallows failures internally,
    # so we double-check by querying the blocklist.
    if jti and not await is_token_revoked(jti):
        logger.warning("refresh: revoke_token did not persist jti=%s — aborting", jti)
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    new_tokens = TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return new_tokens


@router.post("/logout")
async def logout(request: Request):
    """Clear HttpOnly auth cookies and revoke BOTH access and refresh tokens."""
    from core.auth import revoke_token

    # Revoke the current access token (if present)
    access_token = request.cookies.get("access_token")
    if access_token:
        try:
            await revoke_token(access_token)
        except Exception:
            logger.warning("logout: revoke access token failed", exc_info=True)

    # Revoke the refresh token too — otherwise POST /refresh could mint a new
    # access token right after logout. Check cookie first, then JSON body for
    # callers that send it that way.
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        # Non-blocking attempt to read body — some callers post JSON
        try:
            body = await request.json()
            if isinstance(body, dict):
                refresh_token = body.get("refresh_token")
        except Exception:
            pass

    if refresh_token:
        try:
            await revoke_token(refresh_token)
        except Exception:
            logger.warning("logout: revoke refresh token failed", exc_info=True)

    response = JSONResponse(content={"ok": True})
    is_prod = settings.is_production
    response.delete_cookie("access_token", path="/", secure=is_prod, samesite="strict", httponly=True)
    response.delete_cookie("refresh_token", path="/api/v1/auth", secure=is_prod, samesite="strict", httponly=True)
    return response
