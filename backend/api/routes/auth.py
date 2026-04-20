from __future__ import annotations

import logging
import secrets
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


def _is_browser_client(req: Request) -> bool:
    """Heuristic: should this request be treated as a browser?

    BUG-044: the ``/login`` response previously leaked the JWT pair in the
    JSON body alongside the HttpOnly Set-Cookie. That body is readable by
    any script on the page (XSS, browser extensions, etc.), which defeats
    the HttpOnly protection for browser sessions.

    Browser clients are identified as those that do NOT explicitly announce
    themselves as a scripted/mobile caller via the ``X-Client`` header.
    Known non-browser values: ``cli``, ``ios``, ``android``. When a request
    has an ``Origin`` header (always set on cross-origin fetch) or a
    ``User-Agent`` that looks like a browser AND no ``X-Client`` override,
    we treat it as a browser and suppress the tokens in the body.

    Returning ``True`` means: return ``{"ok": true, "expires_in": N}`` and
    rely on the HttpOnly cookies for session continuity.
    """
    x_client = (req.headers.get("x-client") or "").strip().lower()
    if x_client in {"cli", "ios", "android", "mobile", "api"}:
        return False
    # Default: treat anything without an explicit non-browser X-Client as
    # a browser. Safer default — legit CLI integrations must opt in.
    return True


async def _audit(
    event: str,
    *,
    user: str,
    ip: str,
    result: str,
    req: Request | None = None,
    **extra: object,
) -> None:
    """Emit a structured auth audit record AND persist to ``audit_log``.

    Wave 3K (persona-87 P1 #1): previously the compliance trail was
    stdout-only, so a container rotation evaporated the record beyond
    whatever the aggregator had already shipped.  Delegates to
    ``core.audit.write_audit`` which:

      1. Emits the same structured log record (``alphadesk.audit``) that
         existing log-aggregation pipelines already consume — no change
         to downstream tooling.
      2. Appends a row to the durable ``audit_log`` Postgres table so the
         trail survives container churn.

    The helper is now async because DB persistence is async; every caller
    in this file was already inside an async handler so the await is
    trivial.  ``request_id`` is read from ``req.state.request_id`` when a
    request is available, falling back to ``REQUEST_ID.get()`` otherwise
    (e.g. logout's failure branches that don't carry the full request).
    """
    from core.audit import write_audit
    from core.logging import REQUEST_ID

    request_id: str | None = None
    if req is not None:
        request_id = getattr(req.state, "request_id", None)
    if request_id is None:
        rid = REQUEST_ID.get()
        request_id = rid if rid and rid != "-" else None

    details: dict[str, object] = {"result": result, **extra}
    await write_audit(
        event,
        username=user if user and user != "-" else None,
        ip=ip if ip and ip != "unknown" else None,
        request_id=request_id,
        details=details,
    )

from core.auth import (
    bump_password_version,
    bump_session_epoch,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_version,
    get_session_epoch,
    hash_password,
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
# Login rate limiting (Wave 2I Fix 5 — P83-1): per (IP, username) pair PLUS a
# per-IP absolute bot-defense cap.
# ---------------------------------------------------------------------------
# Prior behaviour: ``login_attempts:{ip}`` — 5 failed attempts on ANY username
# from one IP tripped the lockout. On a shared exit node (Tor, corporate NAT)
# one user's typos could lock out every other user sharing that IP.
#
# New behaviour:
#   * ``login_attempts:{ip}:{username}`` — 5 failed attempts per (IP, username)
#     pair. A typo storm from user-A on IP-X does NOT affect user-B on the
#     same IP. This is the primary lockout.
#   * ``login_attempts_ip:{ip}`` — 100 failed attempts per IP per window.
#     Bot-defense backstop. A genuine user hitting this from one IP is
#     vanishingly unlikely; a credential-stuffing script iterating usernames
#     would trip it.
#
# TODO: /agents/chat and /pipeline/run are expensive endpoints and should also
#       be rate limited (those routes live in separate files).
# ---------------------------------------------------------------------------
_RATE_LIMIT_WINDOW = 300  # 5 minutes
_RATE_LIMIT_MAX_PER_PAIR = 5  # 5 attempts per window per (IP, username) pair
_RATE_LIMIT_MAX_PER_IP = 100  # 100 attempts per window per IP (bot defense)

# In-memory fallback when Redis is unreachable. Process-local; under multi-worker
# deployment each worker maintains its own table, which still bounds the blast
# radius. Keyed by the rate-limit key (either ``ip:username`` or bare ``ip``);
# value is a list of unix-epoch timestamps of recent failed attempts within the
# window.
_INMEM_ATTEMPTS: dict[str, list[float]] = {}
_INMEM_MAX_KEYS = 10_000  # protect against unbounded memory growth


def _pair_key(client_ip: str, username: str) -> str:
    """Redis/in-memory key for per-(IP, username) failure count."""
    return f"login_attempts:{client_ip}:{username}"


def _ip_key(client_ip: str) -> str:
    """Redis/in-memory key for the per-IP absolute bot-defense cap."""
    return f"login_attempts_ip:{client_ip}"


def _inmem_count(key: str) -> int:
    """Return current count within the window WITHOUT incrementing.

    Used by the read-only check that runs before authentication. The
    increment happens later, only on failure, in `_inmem_record_failure`.
    """
    import time as _t

    now = _t.time()
    window_start = now - _RATE_LIMIT_WINDOW

    hits = _INMEM_ATTEMPTS.get(key)
    if not hits:
        return 0
    # Drop stale timestamps in place so the list doesn't grow unboundedly.
    hits[:] = [t for t in hits if t >= window_start]
    return len(hits)


def _inmem_record_failure(key: str) -> int:
    """Append a failed-attempt timestamp and return new count within the window."""
    import time as _t

    now = _t.time()
    window_start = now - _RATE_LIMIT_WINDOW

    # Occasional cleanup so the dict does not grow unbounded across many IPs.
    if len(_INMEM_ATTEMPTS) > _INMEM_MAX_KEYS:
        _INMEM_ATTEMPTS.clear()

    hits = _INMEM_ATTEMPTS.setdefault(key, [])
    # Drop stale timestamps
    hits[:] = [t for t in hits if t >= window_start]
    hits.append(now)
    return len(hits)


def _inmem_clear(key: str) -> None:
    """Drop the failure log for this key — called on successful authentication."""
    _INMEM_ATTEMPTS.pop(key, None)


async def _get_count(key: str) -> int:
    """Read current failure count for ``key``. Redis-first, in-memory fallback."""
    try:
        from core.redis import get_redis
        redis = await get_redis()
        raw = await redis.get(key)
        return int(raw) if raw is not None else 0
    except Exception as e:
        logger.warning(
            "Rate limit: Redis unavailable for read %s, using in-memory fallback: %s",
            key,
            e,
            exc_info=True,
        )
        return _inmem_count(key)


async def _check_rate_limit(client_ip: str, username: str) -> None:
    """Reject if this (IP, username) pair OR this IP has exceeded its failure cap.

    The cap counts FAILED login attempts only — this function never
    increments. Successful logins should NOT count toward the limit
    (persona-9 P0 #1: legitimate users were getting locked out after 5
    successful logins in 5 minutes). The increment now happens in
    `_record_login_failure`, called from the failure branch of `login`.

    FAIL CLOSED: this is the login endpoint — abuse here is catastrophic
    (credential stuffing, account takeover), so if Redis is down we fall back
    to a per-process in-memory counter instead of simply allowing every
    request through. The in-memory counter is process-local, so a multi-worker
    deployment will permit N * cap attempts while Redis is down, which is
    still dramatically lower than unlimited.
    """
    pair_count = await _get_count(_pair_key(client_ip, username))
    if pair_count >= _RATE_LIMIT_MAX_PER_PAIR:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a few minutes.",
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
        )

    ip_count = await _get_count(_ip_key(client_ip))
    if ip_count >= _RATE_LIMIT_MAX_PER_IP:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts from this network. Please try again later.",
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
        )


async def _incr_one(key: str) -> None:
    """Bump ``key`` by 1 in Redis with a sliding TTL, with in-memory fallback."""
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
            "Rate limit: Redis unavailable for incr %s, using in-memory: %s",
            key,
            e,
            exc_info=True,
        )
        _inmem_record_failure(key)


async def _record_login_failure(client_ip: str, username: str) -> None:
    """Increment both the per-pair AND the per-IP failure counters.

    Called from the failure branch of `login` AFTER credential verification.
    Uses the same Redis-or-in-memory dual-track as `_check_rate_limit`. We
    do NOT raise from here — the failure branch raises 401 itself; this
    just makes sure the *next* attempt sees the bumped count.
    """
    await _incr_one(_pair_key(client_ip, username))
    await _incr_one(_ip_key(client_ip))


async def _clear_one(key: str) -> None:
    try:
        from core.redis import get_redis
        redis = await get_redis()
        await redis.delete(key)
    except Exception as e:
        logger.warning(
            "Rate limit: Redis unavailable for clear %s, using in-memory: %s",
            key,
            e,
            exc_info=True,
        )
    # Also clear the in-memory counter — covers both the "Redis is down"
    # path AND the "Redis is up but a previous failure landed in memory
    # because Redis was momentarily down" edge case.
    _inmem_clear(key)


async def _clear_login_failures(client_ip: str, username: str) -> None:
    """Reset the per-pair and per-IP failure counters on successful login.

    Called from the success branch of `login` so that a successful auth
    immediately wipes the slate (persona-9 #1). Best-effort: a Redis blip
    during clear is non-fatal because the worst case is the user gets one
    fewer failed attempt before lockout.
    """
    await _clear_one(_pair_key(client_ip, username))
    await _clear_one(_ip_key(client_ip))


def _set_token_cookies(response: JSONResponse, access_token: str, refresh_token: str, expires_in: int) -> None:
    """Set HttpOnly, Secure, SameSite cookies for JWT tokens.

    Wave 2I Fix 7 (P83-2): switched ``samesite`` from ``strict`` to ``lax``.
    Rationale: ``strict`` breaks cross-origin auth flows (following a link
    from an external page to a protected route loses the cookie on the very
    first navigation) and the CSRF angle it mitigates is already handled
    at two other layers:
      * ``frame-ancestors 'none'`` CSP blocks clickjacking / iframe-based
        CSRF.
      * The API accepts Bearer tokens via Authorization header on the
        Origin-less path, which is the preferred mode for scripted clients
        and doesn't round-trip cookies at all.
    ``lax`` still blocks cross-site POST, which is the dangerous vector for
    CSRF; it only relaxes top-level GET/navigation.
    """
    is_prod = settings.is_production
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=expires_in,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        path="/api/v1/auth",
    )


class LoginRequest(BaseModel):
    username: str
    password: str
    # Optional TOTP code for when 2FA is enrolled. When a user has enrolled
    # (``totp:{username}`` key exists in Redis) this field is REQUIRED; the
    # login handler rejects with 401 + ``detail="totp_required"`` so the
    # frontend knows to prompt. Skeleton only — full rollout in a later wave.
    totp_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    # BUG-044: made optional so browser clients can rely on the HttpOnly
    # ``refresh_token`` cookie (path=/api/v1/auth) instead of receiving the
    # token in the login JSON body. CLI / iOS callers that send
    # ``X-Client: cli`` (or ``ios``) still get the token in the body and can
    # continue to POST it explicitly.
    refresh_token: str | None = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class TotpVerifyRequest(BaseModel):
    code: str


# ---------------------------------------------------------------------------
# TOTP (2FA) skeleton — Wave 2I Fix 2 (P81-1)
# ---------------------------------------------------------------------------
# Secret storage layout:
#   * ``totp:{username}`` — base32 TOTP secret (set after successful
#     ``/auth/2fa/verify`` confirmation of a freshly-enrolled secret).
#   * ``totp_pending:{username}`` — base32 secret generated by
#     ``/auth/2fa/enroll`` but not yet confirmed. Expires after 10 minutes.
# Enrolling while already-enrolled is rejected; you have to ``/disable``
# first. Skeleton only — the login flow enforces TOTP when ``totp:{u}`` is
# set, but device recovery / backup codes are deferred.

_TOTP_PENDING_TTL_SECONDS = 600  # 10 min window to confirm enrollment


def _require_pyotp():
    """Import pyotp lazily so tests that mock away Redis don't need it installed.

    Raises 503 if the dependency isn't present — surfaces the misconfig
    clearly instead of a generic import error.
    """
    try:
        import pyotp  # type: ignore
        return pyotp
    except ImportError:
        logger.error("pyotp is not installed — 2FA endpoints require it")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="2FA backend unavailable",
        )


async def _get_totp_secret(username: str) -> str | None:
    """Return the confirmed TOTP secret for ``username`` or None if not enrolled."""
    try:
        from core.redis import get_redis
        r = await get_redis()
        return await r.get(f"totp:{username}")
    except Exception:
        logger.warning("totp: redis unavailable for secret read", exc_info=True)
        return None


@router.post("/login")
async def login(request: LoginRequest, req: Request):
    client_ip = _client_ip(req)
    # Strip whitespace from the submitted username BEFORE comparing against
    # the configured admin or counting toward the lockout. A trailing space
    # from a password-manager paste would otherwise be treated as a genuine
    # auth failure. See edge-cases-audit-r3.md I/P1.
    submitted_username = (request.username or "").strip()

    # Read-only check — only failures count toward the cap. Keyed by
    # (IP, username) pair so one user's typos don't starve other users on
    # the same exit node, plus a per-IP backstop for bot defense. See
    # `_check_rate_limit` docstring + Wave 2I Fix 5 (P83-1).
    await _check_rate_limit(client_ip, submitted_username)

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
        await _audit("login", user=submitted_username or "-", ip=client_ip, result="failure", req=req)
        # Bump the failed-attempt counters so the NEXT attempt sees the
        # higher count (and the IP / pair eventually trips the lockout).
        await _record_login_failure(client_ip, submitted_username or "-")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # TOTP check (Wave 2I Fix 2 — P81-1 skeleton). If the user has enrolled
    # we REQUIRE a valid TOTP code before minting tokens. The code is
    # verified with a ±1 step (30s) window by pyotp default; that's the
    # recommended setting for mild clock drift without significantly
    # widening the brute-force window.
    totp_secret = await _get_totp_secret(submitted_username)
    if totp_secret:
        code = (request.totp_code or "").strip()
        if not code:
            await _audit("login", user=submitted_username, ip=client_ip, result="totp_required", req=req)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="totp_required",
            )
        pyotp = _require_pyotp()
        if not pyotp.TOTP(totp_secret).verify(code, valid_window=1):
            await _audit("login", user=submitted_username, ip=client_ip, result="totp_failure", req=req)
            await _record_login_failure(client_ip, submitted_username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid TOTP code",
            )

    # Snapshot the current password_version + session_epoch into the minted
    # tokens so a later change-password / logout-all can invalidate them by
    # bumping the server-side counter (Fix 1, Fix 3).
    pv = await get_password_version(submitted_username)
    epoch = await get_session_epoch(submitted_username)

    access_token = create_access_token(submitted_username, password_version=pv, session_epoch=epoch)
    refresh_token = create_refresh_token(submitted_username, password_version=pv, session_epoch=epoch)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    # Wipe the failure counters — successful auth resets the slate so the
    # user (or an honest sysadmin retesting after a typo) doesn't trip the
    # lockout on the next session.
    await _clear_login_failures(client_ip, submitted_username)

    # Audit the successful login. Do NOT log the tokens or password hash.
    await _audit("login", user=submitted_username, ip=client_ip, result="success", req=req)

    # BUG-044: do not leak the JWT pair in the JSON body for browser clients.
    # Browsers rely on the HttpOnly ``access_token`` / ``refresh_token``
    # cookies set below — the body echo was a defence-in-depth regression
    # since any script on the page could read it. Explicit non-browser
    # clients (CLI / iOS / Android) opt in via ``X-Client:`` and still
    # receive the tokens so they can persist them in Keychain etc.
    if _is_browser_client(req):
        body_payload: dict[str, object] = {
            "ok": True,
            "expires_in": expires_in,
        }
    else:
        body_payload = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in,
        }
    response = JSONResponse(content=body_payload)
    _set_token_cookies(response, access_token, refresh_token, expires_in)
    return response


@router.post("/refresh")
async def refresh(request: RefreshRequest, req: Request):
    client_ip = _client_ip(req)

    # BUG-044: browser clients no longer receive the refresh token in the
    # login JSON body, so the refresh handler must fall back to reading it
    # from the HttpOnly ``refresh_token`` cookie (path=/api/v1/auth). CLI /
    # iOS callers continue to POST the token in the body as before.
    submitted_token = request.refresh_token or req.cookies.get("refresh_token") or ""
    if not submitted_token:
        await _audit("refresh", user="-", ip=client_ip, result="failure", reason="no_token", req=req)
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        payload = decode_token(submitted_token, expected_type="refresh")
    except Exception:
        # Bad / expired / tampered token. Audit the attempt (no username yet
        # since we couldn't decode) and re-raise so decode_token's HTTPException
        # surfaces to the caller.
        await _audit("refresh", user="-", ip=client_ip, result="failure", req=req)
        raise

    username = payload.get("sub", "")
    if not username:
        await _audit("refresh", user="-", ip=client_ip, result="failure", req=req)
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if the old refresh token was already revoked (replay attack detection)
    jti = payload.get("jti")
    if jti and await is_token_revoked(jti):
        await _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoked", req=req)
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    # Wave 2I: refuse refresh tokens minted before the latest password change
    # or logout-all. Matches ``require_auth``'s check for access tokens.
    token_pv = int(payload.get("pv", 1))
    current_pv = await get_password_version(username)
    if token_pv < current_pv:
        await _audit("refresh", user=username, ip=client_ip, result="failure", reason="password_changed", req=req)
        raise HTTPException(status_code=401, detail="Token invalidated by password change")
    token_epoch = int(payload.get("epoch", 1))
    current_epoch = await get_session_epoch(username)
    if token_epoch < current_epoch:
        await _audit("refresh", user=username, ip=client_ip, result="failure", reason="logged_out_all", req=req)
        raise HTTPException(status_code=401, detail="Session invalidated")

    # Revoke OLD refresh token FIRST, before minting a new one. If revocation
    # fails (Redis blip), bail out — we cannot guarantee the old token won't
    # be replayed if we've already handed out a new pair.
    from core.auth import revoke_token
    try:
        await revoke_token(submitted_token)
    except Exception:
        logger.warning("refresh: failed to revoke old token — aborting", exc_info=True)
        await _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoke_failed", req=req)
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    # Verify the revocation landed. revoke_token() swallows failures internally,
    # so we double-check by querying the blocklist.
    if jti and not await is_token_revoked(jti):
        logger.warning("refresh: revoke_token did not persist jti=%s — aborting", jti)
        await _audit("refresh", user=username, ip=client_ip, result="failure", reason="revoke_not_persisted", req=req)
        raise HTTPException(status_code=503, detail="Token service unavailable, please retry")

    new_access = create_access_token(username, password_version=current_pv, session_epoch=current_epoch)
    new_refresh = create_refresh_token(username, password_version=current_pv, session_epoch=current_epoch)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    await _audit("refresh", user=username, ip=client_ip, result="success", req=req)

    # BUG-044: mirror the login behaviour — browser clients get a body
    # without the JWT material (the HttpOnly cookies below carry the
    # session). CLI / iOS clients keep receiving the full token pair.
    if _is_browser_client(req):
        body_payload: dict[str, object] = {"ok": True, "expires_in": expires_in}
    else:
        body_payload = {
            "access_token": new_access,
            "refresh_token": new_refresh,
            "token_type": "bearer",
            "expires_in": expires_in,
        }
    response = JSONResponse(content=body_payload)
    _set_token_cookies(response, new_access, new_refresh, expires_in)
    return response


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

    await _audit("logout", user=acting_user, ip=client_ip, result="success", req=request)

    response = JSONResponse(content={"ok": True})
    is_prod = settings.is_production
    response.delete_cookie("access_token", path="/", secure=is_prod, samesite="lax", httponly=True)
    response.delete_cookie("refresh_token", path="/api/v1/auth", secure=is_prod, samesite="lax", httponly=True)
    return response


# ---------------------------------------------------------------------------
# Wave 2I — password change (Fix 1 / P81-2)
# ---------------------------------------------------------------------------
# Constraint: ``ADMIN_PASSWORD_HASH`` is loaded from env via pydantic-settings.
# We CANNOT rewrite the runtime env from inside a FastAPI handler (the new
# bcrypt hash would vanish on the next worker restart, and writing to the
# .env file from application code introduces a much larger attack surface
# than the fix is worth on a single-admin deployment).
#
# The pragmatic compromise (option (a) in the Wave 2I brief):
#   * Verify the old password against ``ADMIN_PASSWORD_HASH``.
#   * Run the new password through ``_enforce_password_policy``.
#   * BUMP ``password_version`` — this invalidates every outstanding access
#     AND refresh token immediately, as required by P81-2.
#   * Tell the caller that the hash itself was not rotated (operator must
#     rotate ``ADMIN_PASSWORD_HASH`` in the env and redeploy).
#
# This limitation is documented in the response body so the frontend can
# surface it to the admin. A future wave can swap ``ADMIN_PASSWORD_HASH``
# for a Redis-stored runtime hash (option (b)) when the product is ready
# to give up the env-var single-source-of-truth guarantee.

@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    req: Request,
    username: str = Depends(require_auth),
):
    client_ip = _client_ip(req)

    # Verify the old password against the admin hash. Only the configured
    # admin can change *their own* password on this endpoint; any other
    # ``sub`` is a misconfigured token and gets 403.
    if username != settings.ADMIN_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change only supported for the admin account",
        )
    if not settings.ADMIN_PASSWORD_HASH:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin password not configured",
        )

    try:
        old_ok = verify_password(request.old_password, settings.ADMIN_PASSWORD_HASH)
    except Exception:
        logger.warning("change-password: verify_password raised", exc_info=True)
        old_ok = False

    if not old_ok:
        await _audit("change_password", user=username, ip=client_ip, result="failure", reason="bad_old_password", req=req)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Old password incorrect",
        )

    # Enforce password policy on the new password (12+ chars). This is the
    # "dead-code wake-up" step from the Wave 2I brief: the policy function
    # existed but had no caller.
    _enforce_password_policy(request.new_password)
    if request.new_password == request.old_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from old password",
        )

    new_hash = hash_password(request.new_password)

    # Bump password_version — this is the session-invalidation mechanism. It
    # runs BEFORE we return the new hash to the caller so, even in the
    # env-rotation-deferred mode, every live token is immediately dead.
    new_pv = await bump_password_version(username)

    await _audit(
        "change_password",
        user=username,
        ip=client_ip,
        result="success",
        new_password_version=new_pv,
        req=req,
    )

    # Return the new bcrypt hash so the operator can paste it into the env /
    # secret store. The message is explicit about the limitation so the UI
    # can render it verbatim instead of pretending the rotation landed in
    # the backing store.
    return {
        "ok": True,
        "password_version": new_pv,
        "new_password_hash": new_hash,
        "message": (
            "Password change acknowledged. All existing sessions have been "
            "invalidated. NOTE: ADMIN_PASSWORD_HASH is env-var-managed and "
            "was NOT rotated server-side — paste the returned hash into "
            "your environment config and redeploy for the new password to "
            "take effect on future logins."
        ),
    }


# ---------------------------------------------------------------------------
# Wave 2I — logout-all (Fix 3 / P81-6)
# ---------------------------------------------------------------------------

@router.post("/logout-all")
async def logout_all(
    req: Request,
    username: str = Depends(require_auth),
):
    """Invalidate every outstanding token for the authenticated user.

    Bumps ``session_epoch:{username}`` — the snapshotted ``epoch`` claim in
    each existing token now compares strictly less than the new server-side
    counter, so ``require_auth`` rejects them on the next request.

    Returns a fresh token pair for the caller so they stay logged in on the
    device that issued the request. The old tokens on that device also die
    (they're part of the same epoch), but the new pair is minted against
    the bumped epoch and is valid.
    """
    client_ip = _client_ip(req)

    new_epoch = await bump_session_epoch(username)
    pv = await get_password_version(username)

    access_token = create_access_token(username, password_version=pv, session_epoch=new_epoch)
    refresh_token = create_refresh_token(username, password_version=pv, session_epoch=new_epoch)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    await _audit(
        "logout_all",
        user=username,
        ip=client_ip,
        result="success",
        new_session_epoch=new_epoch,
        req=req,
    )

    # BUG-044: scrub the JWT pair from the response body for browser clients.
    if _is_browser_client(req):
        body_payload: dict[str, object] = {
            "ok": True,
            "session_epoch": new_epoch,
            "expires_in": expires_in,
        }
    else:
        body_payload = {
            "ok": True,
            "session_epoch": new_epoch,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in,
        }
    response = JSONResponse(content=body_payload)
    _set_token_cookies(response, access_token, refresh_token, expires_in)
    return response


# ---------------------------------------------------------------------------
# Wave 2I — 2FA skeleton (Fix 2 / P81-1)
# ---------------------------------------------------------------------------
# Endpoints:
#   * POST /auth/2fa/enroll — mint a new TOTP secret, store under
#     ``totp_pending:{user}`` for 10 minutes, return the secret + the
#     otpauth:// provisioning URI so the caller can render a QR.
#   * POST /auth/2fa/verify — consume the pending secret; if the submitted
#     TOTP code verifies, promote to ``totp:{user}`` (no expiry) and 2FA is
#     active from this point.
#   * POST /auth/2fa/disable — delete ``totp:{user}``. Requires a valid
#     TOTP code (prevents hijacked-session disablement).
#
# All three endpoints are auth-gated; you must already be logged in (have a
# valid access token for the authenticated username) to manage your own 2FA.

@router.post("/2fa/enroll")
async def totp_enroll(
    req: Request,
    username: str = Depends(require_auth),
):
    pyotp = _require_pyotp()
    # Refuse to regenerate a secret if the user is already enrolled — doing
    # so would silently lock them out of the old authenticator app.
    existing = await _get_totp_secret(username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="2FA already enrolled — call /2fa/disable first",
        )

    secret = pyotp.random_base32()
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
        name=username,
        issuer_name=settings.APP_NAME,
    )

    from core.redis import cache_set
    await cache_set(
        f"totp_pending:{username}",
        {"secret": secret},
        ttl_seconds=_TOTP_PENDING_TTL_SECONDS,
    )

    await _audit("totp_enroll", user=username, ip=_client_ip(req), result="success", req=req)

    # Secret is returned in base32 (and embedded in the provisioning URI) so
    # an authenticator app can be set up manually or via QR. The caller MUST
    # call /2fa/verify within 10 minutes to activate.
    return {
        "ok": True,
        "secret": secret,
        "provisioning_uri": provisioning_uri,
        "expires_in_seconds": _TOTP_PENDING_TTL_SECONDS,
    }


@router.post("/2fa/verify")
async def totp_verify(
    body: TotpVerifyRequest,
    req: Request,
    username: str = Depends(require_auth),
):
    pyotp = _require_pyotp()

    from core.redis import cache_get
    pending = await cache_get(f"totp_pending:{username}")
    if not isinstance(pending, dict) or "secret" not in pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending enrollment — call /2fa/enroll first",
        )

    secret = str(pending["secret"])
    code = (body.code or "").strip()
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        await _audit("totp_verify", user=username, ip=_client_ip(req), result="failure", req=req)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code",
        )

    # Promote pending -> confirmed. No TTL: the secret persists until the
    # user explicitly disables 2FA.
    from core.redis import get_redis
    r = await get_redis()
    await r.set(f"totp:{username}", secret)
    await r.delete(f"totp_pending:{username}")

    await _audit("totp_verify", user=username, ip=_client_ip(req), result="success", req=req)
    return {"ok": True, "enrolled": True}


@router.post("/2fa/disable")
async def totp_disable(
    body: TotpVerifyRequest,
    req: Request,
    username: str = Depends(require_auth),
):
    """Disable 2FA for the authenticated user.

    Requires a valid current TOTP code (prevents session-hijack disablement).
    """
    pyotp = _require_pyotp()

    secret = await _get_totp_secret(username)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enrolled",
        )

    code = (body.code or "").strip()
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        await _audit("totp_disable", user=username, ip=_client_ip(req), result="failure", req=req)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code",
        )

    from core.redis import get_redis
    r = await get_redis()
    await r.delete(f"totp:{username}")
    await r.delete(f"totp_pending:{username}")

    await _audit("totp_disable", user=username, ip=_client_ip(req), result="success", req=req)
    return {"ok": True, "enrolled": False}
