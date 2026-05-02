from __future__ import annotations

import logging
import re
import secrets
import time
from collections import deque
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from core.database import get_db
from core.http import client_ip

logger = logging.getLogger("alphadesk.access_requests")

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_RATE_WINDOW_S = 60 * 60
_RATE_MAX_PER_IP = 6
_RATE_HITS: dict[str, deque[float]] = {}

Instrument = Literal[
    "us_equities",
    "listed_options",
    "etfs",
    "futures",
    "crypto",
    "multi_asset",
]
CapitalBand = Literal[
    "under_250k",
    "250k_1m",
    "1m_10m",
    "10m_50m",
    "over_50m",
]
TradingMode = Literal["paper", "paper_to_live", "live"]


def _rate_check(ip: str) -> bool:
    now = time.monotonic()
    bucket = _RATE_HITS.get(ip)
    if bucket is None:
        bucket = deque(maxlen=_RATE_MAX_PER_IP * 2)
        _RATE_HITS[ip] = bucket
    while bucket and now - bucket[0] > _RATE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX_PER_IP:
        return False
    bucket.append(now)
    if len(_RATE_HITS) > 10_000:
        try:
            del _RATE_HITS[next(iter(_RATE_HITS))]
        except StopIteration:
            pass
    return True


def _public_id() -> str:
    return f"AR-{secrets.token_urlsafe(9).replace('-', '').replace('_', '')[:12].upper()}"


class AccessRequestPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    firm: str | None = Field(default=None, max_length=160)
    role: str | None = Field(default=None, max_length=120)
    jurisdiction: str = Field(min_length=2, max_length=80)
    capital_band: CapitalBand
    trading_mode: TradingMode
    instruments: list[Instrument] = Field(min_length=1, max_length=6)
    note: str = Field(min_length=20, max_length=2000)
    referral: str | None = Field(default=None, max_length=240)
    # Honeypot. Real users never see this field; bots often fill it.
    website: str | None = Field(default=None, max_length=200)

    @field_validator("name", "email", "firm", "role", "jurisdiction", "note", "referral", "website", mode="before")
    @classmethod
    def _strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        email = value.lower()
        if not _EMAIL_RE.match(email):
            raise ValueError("Enter a valid email address")
        return email

    @field_validator("instruments")
    @classmethod
    def _dedupe_instruments(cls, value: list[Instrument]) -> list[Instrument]:
        seen: set[str] = set()
        out: list[Instrument] = []
        for item in value:
            if item in seen:
                continue
            seen.add(item)
            out.append(item)
        if not out:
            raise ValueError("Select at least one instrument")
        return out


class AccessRequestResponse(BaseModel):
    ok: bool
    request_id: str
    status: str


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=AccessRequestResponse)
async def create_access_request(
    payload: AccessRequestPayload,
    request: Request,
    db=Depends(get_db),
) -> AccessRequestResponse:
    ip = client_ip(request)

    # Honeypot requests get a plausible success response but do not create
    # durable work for the operator.
    if payload.website:
        logger.info("access_request_honeypot", extra={"event": "access_request_honeypot", "ip": ip})
        return AccessRequestResponse(ok=True, request_id=_public_id(), status="received")

    if not _rate_check(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many access requests from this network. Please try again later.",
            headers={"Retry-After": str(_RATE_WINDOW_S)},
        )

    from core.audit import write_audit
    from data.storage.models import AccessRequest

    public_id = _public_id()
    user_agent = (request.headers.get("user-agent") or "")[:256] or None
    row = AccessRequest(
        public_id=public_id,
        status="received",
        name=payload.name,
        email=payload.email,
        firm=payload.firm or None,
        role=payload.role or None,
        jurisdiction=payload.jurisdiction,
        capital_band=payload.capital_band,
        trading_mode=payload.trading_mode,
        instruments=payload.instruments,
        note=payload.note,
        referral=payload.referral or None,
        client_ip=ip if ip and ip != "unknown" else None,
        user_agent=user_agent,
    )

    try:
        db.add(row)
        await db.flush()
    except Exception:
        logger.exception(
            "access_request_persist_failed",
            extra={"event": "access_request_persist_failed", "request_id": public_id},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Access request could not be saved. Please try again.",
        )

    request_id = getattr(request.state, "request_id", None)
    await write_audit(
        "access_request",
        username=None,
        ip=ip if ip and ip != "unknown" else None,
        request_id=request_id,
        details={
            "request_id": public_id,
            "capital_band": payload.capital_band,
            "trading_mode": payload.trading_mode,
            "instruments": payload.instruments,
            "has_referral": bool(payload.referral),
        },
    )

    return AccessRequestResponse(ok=True, request_id=public_id, status="received")
