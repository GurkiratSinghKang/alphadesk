from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
# Dedicated audit logger — emits auth-relevant events (login, logout, refresh,
# token revoke) so they can be shipped to a tamper-evident store separately
# from the app logs. Emits at INFO. See observability-audit-r4.md P1 #10.
audit_logger = logging.getLogger("alphadesk.audit")


def _client_ip(req: Request) -> str:
    """Best-effort resolve the caller's IP.

    Prefers X-Forwarded-For (we trust Caddy per ProxyHeadersMiddleware
    trusted_hosts in main.py). Falls back to request.client.host.
    """
    xff = req.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    return req.client.host if req.client else "unknown"


def _audit(event: str, *, user: str, ip: str, result: str, **extra: object) -> None:
    """Emit a structured auth audit record at INFO.

    The JSON formatter in core/logging.py promotes ``extra=`` kwargs to
    top-level fields, so a log aggregator can filter on ``event`` or
    ``user`` directly. The message string stays human-readable for plain-
    text viewers (``docker logs backend``).
    """
    audit_logger.info(
        "audit event=%s user=%s ip=%s result=%s",
        event,
        user,
        ip,
        result,
        extra={"event": event, "user": user, "ip": ip, "result": result, **extra},
    )

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

# Precomputed bcrypt hash used as the constant-time comparison target when
# the submitted username does NOT match ADMIN_USERNAME. Prevents a username-
# enumeration timing oracle (P37): without this, the login handler would
# short-circuit on unknown usernames and skip bcrypt entirely, so an
# attacker could distinguish "user exists, wrong password" (~100ms for
# bcrypt cost=14) from "user does not exist" (~sub-ms) and enumerate
# accounts. With the dummy-hash path, bcrypt runs on every request
# regardless of whether the username is real.
#
# The hash corresponds to a fixed throwaway string — it cannot match any
# real password submission because bcrypt collision resistance makes that
# infeasible. Precomputed at module load so we pay the cost once, not per
# request. Cost factor MUST match the production hash cost so timing
# between the real and dummy branches is indistinguishable; bcrypt defaults
# to cost=12, our admin hashes use cost=14, so we pin 14 here too.
_DUMMY_PASSWORD_HASH = (
    "$2b$14$z4t5/lWyhLyKZd2QmJSdE.39Hqtyc.RzbgdFxBGrJwC38RGNmahoG"
)

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


def _inmem_count(client_ip: str) -> int:
    """Return current count within the window WITHOUT incrementing.

    Used by the read-only check that runs before authentication. The
    increment happens later, only on failure, in `_inmem_record_failure`.
    """
    import time as _t

    now = _t.time()
    window_start = now - _RATE_LIMIT_WINDOW

    hits = _INMEM_ATTEMPTS.get(client_ip)
    if not hits:
        return 0
    # Drop stale timestamps in place so the list doesn't grow unboundedly.
    hits[:] = [t for t in hits if t >= window_start]
    return len(hits)


def _inmem_record_failure(client_ip: str) -> int:
    """Append a failed-attempt timestamp and return new count within the window."""
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


def _inmem_clear(client_ip: str) -> None:
    """Drop the failure log for this IP — called on successful authentication."""
    _INMEM_ATTEMPTS.pop(client_ip, None)


async def _check_rate_limit(client_ip: str) -> None:
    """Reject if this IP has exceeded the failed-attempt cap (READ ONLY).

    The cap counts FAILED login attempts only — this function never
    increments. Successful logins should NOT count toward the limit
    (persona-9 P0 #1: legitimate users were getting locked out after 5
    successful logins in 5 minutes). The increment now happens in
    `_record_login_failure`, called from the failure branch of `login`.

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
        raw = await redis.get(key)
        count = int(raw) if raw is not None else 0
    except Exception as e:
        # Redis unavailable — degrade to in-memory counter rather than allowing
        # uncapped login attempts. ``exc_info=True`` so the traceback reaches
        # the aggregator — without it, a recurring Redis fault is invisible
        # beyond the exception type name.
        logger.warning(
            "Rate limit: Redis unavailable, using in-memory fallback: %s",
            e,
            exc_info=True,
        )
        count = _inmem_count(client_ip)

    if count >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a few minutes.",
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
        )


async def _record_login_failure(client_ip: str) -> None:
    """Increment the failed-attempt counter for this IP.

    Called from the failure branch of `login` AFTER credential verification.
    Uses the same Redis-or-in-memory dual-track as `_check_rate_limit`. We
    do NOT raise from here — the failure branch raises 401 itself; this
    just makes sure the *next* attempt sees the bumped count.
    """
    key = f"login_attempts:{client_ip}"
    try:
        from core.redis import get_redis
        redis = await get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        # Apply the TTL only when the key is freshly minted so the rolling
        # window slides off as designed. If we set TTL on every incr the
        # window would extend with every failure (lockout-forever bug).
        pipe.expire(key, _RATE_LIMIT_WINDOW, nx=True)
        await pipe.execute()
    except Exception as e:
        logger.warning(
            "Rate limit: Redis unavailable for failure incr, using in-memory: %s",
            e,
            exc_info=True,
        )
        _inmem_record_failure(client_ip)


async def _clear_login_failures(client_ip: str) -> None:
    """Reset the failed-attempt counter for this IP.

    Called from the success branch of `login` so that a successful auth
    immediately wipes the slate (this is the spec — see persona-9 #1).
    Best-effort: a Redis blip during clear is non-fatal because the worst
    case is the user gets one fewer failed attempt before lockout.
    """
    key = f"login_attempts:{client_ip}"
    try:
        from core.redis import get_redis
        redis = await get_redis()
        await redis.delete(key)
    except Exception as e:
        logger.warning(
            "Rate limit: Redis unavailable for clear, using in-memory: %s",
            e,
            exc_info=True,
        )
    # Also clear the in-memory counter — covers both the "Redis is down"
    # path AND the "Redis is up but a previous failure landed in memory
    # because Redis was momentarily down" edge case.
    _inmem_clear(client_ip)

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
    client_ip = _client_ip(req)
    # Read-only check — only failures count toward the cap. See
    # `_check_rate_limit` docstring + persona-9 audit P0 #1.
    await _check_rate_limit(client_ip)

    # Strip whitespace from the submitted username BEFORE comparing against
    # the configured admin or counting toward the lockout. A trailing space
    # from a password-manager paste would otherwise be treated as a genuine
    # auth failure. See edge-cases-audit-r3.md I/P1.
    submitted_username = (request.username or "").strip()

    # P37 fix — username enumeration timing oracle.
    # Previously this branch short-circuited on a username mismatch and never
    # called bcrypt, so a non-existent account returned in ~sub-millisecond
    # while a real account took the full bcrypt-cost-14 latency (~100ms).
    # That delta let an attacker enumerate valid usernames by measuring
    # response time from outside the box.
    #
    # Fix: always run bcrypt, against ADMIN_PASSWORD_HASH if the username
    # matches, else against a precomputed dummy hash. Both paths pay the same
    # bcrypt cost, so the timing no longer leaks which usernames exist. We
    # also guard for an unconfigured admin (ADMIN_PASSWORD_HASH empty) by
    # falling back to the dummy hash there too.
    username_matches = submitted_username == settings.ADMIN_USERNAME
    target_hash = (
        settings.ADMIN_PASSWORD_HASH
        if username_matches and settings.ADMIN_PASSWORD_HASH
        else _DUMMY_PASSWORD_HASH
    )
    # verify_password can raise on a malformed hash string — guard so a
    # config error doesn't turn into a 500 (which is itself a timing/identity
    # side-channel). ``password_ok`` stays False on any exception.
    try:
        password_ok = verify_password(request.password, target_hash)
    except Exception:
        logger.warning("verify_password raised — treating as failed auth", exc_info=True)
        password_ok = False

    # Auth succeeds ONLY if (a) bcrypt matched AND (b) we compared against
    # the real admin hash. The dummy-hash branch can never succeed: a match
    # against the dummy hash would imply a bcrypt collision, and even then
    # the explicit ``username_matches`` gate blocks it.
    if not (
        username_matches
        and settings.ADMIN_PASSWORD_HASH
        and password_ok
    ):
        # Audit the failed attempt. ``user`` records the *submitted* username
        # so investigations can see attempts against non-existent accounts.
        _audit("login", user=submitted_username or "-", ip=client_ip, result="failure")
        # Bump the failed-attempt counter so the NEXT attempt sees the
        # higher count (and the IP eventually trips the lockout).
        await _record_login_failure(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    access_token = create_access_token(submitted_username)
    refresh_token = create_refresh_token(submitted_username)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    # Wipe the failure counter — successful auth resets the slate so the
    # user (or an honest sysadmin retesting after a typo) doesn't trip the
    # lockout on the next session.
    await _clear_login_failures(client_ip)

    # Audit the successful login. Do NOT log the tokens or password hash.
    _audit("login", user=submitted_username, ip=client_ip, result="success")

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
async def refresh(request: RefreshRequest, req: Request) -> TokenResponse:
    client_ip = _client_ip(req)

    try:
        payload = decode_token(request.refresh_token, expected_type="refresh")
    except Exception:
        # Bad / expired / tampered token. Audit the attempt (no username yet
        # since we couldn't decode) and re-raise so decode_token's HTTPException
        # surfaces to the caller.
        _audit("refresh", user="-", ip=client_ip, result="failure")
        raise

    username = payload.get("sub", "")
    if not username:
        _audit("refresh", user="-", ip=client_ip, result="failure")
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if the old refresh token was already revoked (replay attack detection)
    jti = payload.get("jti")
    if jti and await is_token_revoked(jti):
        _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoked")
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    # Revoke OLD refresh token FIRST, before minting a new one. If revocation
    # fails (Redis blip), bail out — we cannot guarantee the old token won't
    # be replayed if we've already handed out a new pair.
    from core.auth import revoke_token
    try:
        await revoke_token(request.refresh_token)
    except Exception:
        logger.warning("refresh: failed to revoke old token — aborting", exc_info=True)
        _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoke_failed")
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    # Verify the revocation landed. revoke_token() swallows failures internally,
    # so we double-check by querying the blocklist.
    if jti and not await is_token_revoked(jti):
        logger.warning("refresh: revoke_token did not persist jti=%s — aborting", jti)
        _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoke_not_persisted")
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    new_tokens = TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    _audit("refresh", user=username, ip=client_ip, result="success")

    return new_tokens


@router.post("/logout")
async def logout(request: Request):
    """Clear HttpOnly auth cookies and revoke BOTH access and refresh tokens."""
    from core.auth import revoke_token

    client_ip = _client_ip(request)

    # Best-effort resolve the logging-out user. If we can decode the access
    # token we get their username; otherwise we audit an anonymous logout.
    acting_user = "-"
    access_token = request.cookies.get("access_token")
    if access_token:
        try:
            payload = decode_token(access_token, expected_type="access")
            acting_user = payload.get("sub", "-") or "-"
        except Exception:
            # Token might be expired/invalid — still allow logout.
            logger.debug("logout: unable to decode access token for audit", exc_info=True)

    # Revoke the current access token (if present)
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
            # Body might not be JSON (curl -X POST with no body, e.g.). Not a
            # real error, but we no longer swallow silently — the old
            # ``except Exception: pass`` here hid genuine bugs. See
            # observability-audit-r4.md P0 #5.
            logger.debug("logout: no JSON body / body parse failed", exc_info=True)

    if refresh_token:
        try:
            await revoke_token(refresh_token)
        except Exception:
            logger.warning("logout: revoke refresh token failed", exc_info=True)

    _audit("logout", user=acting_user, ip=client_ip, result="success")

    response = JSONResponse(content={"ok": True})
    is_prod = settings.is_production
    response.delete_cookie("access_token", path="/", secure=is_prod, samesite="strict", httponly=True)
    response.delete_cookie("refresh_token", path="/api/v1/auth", secure=is_prod, samesite="strict", httponly=True)
    return response
