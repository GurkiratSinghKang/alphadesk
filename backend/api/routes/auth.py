from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from core.config import settings

router = APIRouter()

def _set_token_cookies(response: JSONResponse, access_token: str, refresh_token: str, expires_in: int) -> None:
    """Set HttpOnly, Secure, SameSite cookies for JWT tokens."""
    is_prod = settings.ENVIRONMENT == "prod"
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
async def login(request: LoginRequest):
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

    return TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
