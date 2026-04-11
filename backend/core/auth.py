from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt
from jose import JWTError, jwt

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
        {"sub": subject, "exp": expire, "type": "refresh"},
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_value, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    return payload


async def is_token_revoked(jti: str) -> bool:
    """Check if a token has been revoked."""
    try:
        from core.redis import cache_get
        return await cache_get(f"revoked:{jti}") is not None
    except Exception:
        return False  # If Redis is down, don't block auth


async def revoke_token(token: str) -> None:
    """Add a token to the revocation blocklist."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_value, algorithms=[ALGORITHM])
        jti = payload.get("jti")
        if jti:
            from core.redis import cache_set
            # Keep in blocklist until token would have expired anyway
            ttl = max(int(payload.get("exp", 0) - datetime.now(timezone.utc).timestamp()), 0)
            await cache_set(f"revoked:{jti}", {"revoked": True}, ttl_seconds=max(ttl, 60))
    except Exception:
        pass


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
