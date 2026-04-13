from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from core.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    is_token_revoked,
    verify_password,
)
from core.config import settings

router = APIRouter()

# ---------------------------------------------------------------------------
# Login rate limiting: max 5 attempts per IP per 5-minute window (Redis-backed)
# TODO: /agents/chat and /pipeline/run are expensive endpoints and should also
#       be rate limited (those routes live in separate files).
# ---------------------------------------------------------------------------
_RATE_LIMIT_WINDOW = 300  # 5 minutes
_RATE_LIMIT_MAX = 15


async def _check_rate_limit(client_ip: str) -> None:
    """Rate limit login attempts using Redis sliding window."""
    from core.redis import get_redis
    redis = await get_redis()
    if not redis:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    key = f"login_attempts:{client_ip}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _RATE_LIMIT_WINDOW)
        if count > _RATE_LIMIT_MAX:
            raise HTTPException(
                status_code=429,
                detail="Too many login attempts. Please try again in a few minutes.",
            )
    except HTTPException:
        raise
    except Exception as e:
        # Degrade gracefully — allow login when Redis is unavailable
        logger.warning("Rate limit check failed (Redis unavailable), allowing login: %s", e)

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

    if (
        request.username != settings.ADMIN_USERNAME
        or not settings.ADMIN_PASSWORD_HASH
        or not verify_password(request.password, settings.ADMIN_PASSWORD_HASH)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    access_token = create_access_token(request.username)
    refresh_token = create_refresh_token(request.username)
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

    new_tokens = TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    # Revoke the old refresh token so it cannot be reused
    from core.auth import revoke_token
    await revoke_token(request.refresh_token)

    return new_tokens


@router.post("/logout")
async def logout(request: Request):
    """Clear HttpOnly auth cookies and revoke the access token."""
    # Revoke the current access token
    token = request.cookies.get("access_token")
    if token:
        from core.auth import revoke_token
        await revoke_token(token)

    response = JSONResponse(content={"ok": True})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/v1/auth")
    return response
