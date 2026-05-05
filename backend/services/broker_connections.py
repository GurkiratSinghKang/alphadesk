from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import select

from core.config import settings
from core.crypto import EncryptionKeyUnavailable, decrypt_secret, encrypt_secret


class BrokerCredentialError(RuntimeError):
    pass


BrokerProvider = Literal["alpaca", "ibkr", "etrade", "schwab"]


SUPPORTED_BROKERS: dict[str, dict[str, Any]] = {
    "alpaca": {
        "label": "Alpaca",
        "auth_model": "api_key_secret",
        "account_envs": ["paper", "live"],
        "trading_enabled": True,
        "reconciliation_enabled": True,
        "fields": ["api_key", "secret_key"],
    },
    "ibkr": {
        "label": "Interactive Brokers",
        "auth_model": "client_portal_gateway",
        "account_envs": ["paper", "live"],
        "trading_enabled": False,
        "reconciliation_enabled": False,
        "fields": ["gateway_url", "account_id"],
    },
    "etrade": {
        "label": "E*TRADE",
        "auth_model": "oauth1",
        "account_envs": ["paper", "live"],
        "trading_enabled": False,
        "reconciliation_enabled": False,
        "fields": ["consumer_key", "consumer_secret", "oauth_token", "oauth_token_secret", "account_id_key"],
    },
    "schwab": {
        "label": "Schwab",
        "auth_model": "oauth2_refresh_token",
        "account_envs": ["live"],
        "trading_enabled": False,
        "reconciliation_enabled": False,
        "fields": ["client_id", "client_secret", "refresh_token", "redirect_uri"],
    },
}


@dataclass(frozen=True)
class AlpacaCredentials:
    api_key: str
    secret_key: str
    base_url: str
    account_env: str
    source: str
    broker_connection_id: int | None = None

    @property
    def headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.secret_key,
        }


def _base_url_for_env(account_env: str) -> str:
    # Batch W (HARDCODING-SWEEP C-1/C-2): hostnames live in Settings.
    return (
        settings.ALPACA_LIVE_BASE_URL
        if account_env == "live"
        else settings.ALPACA_PAPER_BASE_URL
    )


def _account_env_from_settings() -> str:
    return "live" if settings.LIVE_TRADING_ENABLED else "paper"


def _env_credentials() -> AlpacaCredentials | None:
    api_key = settings.ALPACA_API_KEY.get_secret_value()
    secret = settings.ALPACA_SECRET_KEY.get_secret_value()
    if not api_key or not secret:
        return None
    return AlpacaCredentials(
        api_key=api_key,
        secret_key=secret,
        base_url=settings.ALPACA_BASE_URL,
        account_env=_account_env_from_settings(),
        source="environment",
    )


async def get_alpaca_credentials(
    username: str | None = None,
    *,
    account_env: str | None = None,
    allow_env_fallback: bool = True,
) -> AlpacaCredentials | None:
    """Return user-owned Alpaca credentials, falling back to env keys."""
    target_env = account_env or _account_env_from_settings()
    if username and not settings.SKIP_DB_INIT:
        try:
            from core.database import _get_session_factory
            from data.storage.models import BrokerConnection

            factory = _get_session_factory()
            async with factory() as db:
                row = (
                    await db.execute(
                        select(BrokerConnection)
                        .where(BrokerConnection.username == username)
                        .where(BrokerConnection.provider == "alpaca")
                        .where(BrokerConnection.account_env == target_env)
                        .where(BrokerConnection.status == "active")
                        .order_by(BrokerConnection.is_default.desc(), BrokerConnection.updated_at.desc())
                    )
                ).scalars().first()
                if row is not None:
                    try:
                        primary = decrypt_secret(row.api_key_ciphertext)
                        secret_payload = decrypt_secret(row.secret_key_ciphertext)
                        try:
                            bundle = json.loads(secret_payload)
                        except json.JSONDecodeError:
                            bundle = {"secret_key": secret_payload}
                        return AlpacaCredentials(
                            api_key=str(bundle.get("api_key") or primary),
                            secret_key=str(bundle.get("secret_key") or ""),
                            base_url=_base_url_for_env(row.account_env),
                            account_env=row.account_env,
                            source="user",
                            broker_connection_id=int(row.id),
                        )
                    except EncryptionKeyUnavailable as exc:
                        raise BrokerCredentialError(str(exc)) from exc
        except BrokerCredentialError:
            raise
        except Exception:
            # DB outages should not break legacy single-admin deployments that
            # still use env credentials.
            if not allow_env_fallback:
                raise
    return _env_credentials() if allow_env_fallback else None


async def verify_alpaca_credentials(
    *,
    api_key: str,
    secret_key: str,
    account_env: str,
) -> dict[str, Any]:
    base_url = _base_url_for_env(account_env)
    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": secret_key,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base_url}/v2/account", headers=headers)
    if resp.status_code != 200:
        raise BrokerCredentialError("Alpaca rejected these credentials")
    return resp.json() or {}


def supported_brokers_to_dict() -> list[dict[str, Any]]:
    return [
        {"provider": provider, **meta}
        for provider, meta in SUPPORTED_BROKERS.items()
    ]


def _json_secret(credentials: dict[str, Any]) -> str:
    return json.dumps(credentials, sort_keys=True, separators=(",", ":"))


def _required(credentials: dict[str, Any], key: str) -> str:
    value = str(credentials.get(key) or "").strip()
    if not value:
        raise BrokerCredentialError(f"{key} is required")
    return value


def _last4(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned[-4:] if cleaned else None


def _etrade_base_url(account_env: str) -> str:
    # Batch W (HARDCODING-SWEEP C-3): hostnames live in Settings.
    return (
        settings.ETRADE_LIVE_BASE_URL
        if account_env == "live"
        else settings.ETRADE_SANDBOX_BASE_URL
    )


def _oauth1_quote(value: str) -> str:
    return quote(value, safe="~")


def _oauth1_header(
    *,
    method: str,
    url: str,
    consumer_key: str,
    consumer_secret: str,
    token: str,
    token_secret: str,
) -> str:
    oauth_params = {
        "oauth_consumer_key": consumer_key,
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": token,
        "oauth_version": "1.0",
    }
    encoded_params = "&".join(
        f"{_oauth1_quote(k)}={_oauth1_quote(v)}"
        for k, v in sorted(oauth_params.items())
    )
    base_string = "&".join([
        method.upper(),
        _oauth1_quote(url),
        _oauth1_quote(encoded_params),
    ])
    signing_key = f"{_oauth1_quote(consumer_secret)}&{_oauth1_quote(token_secret)}"
    digest = hmac.new(
        signing_key.encode("utf-8"),
        base_string.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    oauth_params["oauth_signature"] = base64.b64encode(digest).decode("ascii")
    return "OAuth " + ",".join(
        f'{_oauth1_quote(k)}="{_oauth1_quote(v)}"'
        for k, v in sorted(oauth_params.items())
    )


def _validate_ibkr_gateway_url(gateway_url: str) -> str:
    parsed = urlparse(gateway_url)
    host = (parsed.hostname or "").lower()
    allowed_hosts = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}
    if parsed.scheme != "https" or host not in allowed_hosts:
        raise BrokerCredentialError(
            "IBKR gateway URL must be an HTTPS loopback or host.docker.internal address"
        )
    return gateway_url


async def verify_ibkr_connection(
    *,
    gateway_url: str,
    account_id: str | None = None,
) -> dict[str, Any]:
    base_url = _validate_ibkr_gateway_url(gateway_url).rstrip("/")
    if not base_url.endswith("/v1/api"):
        base_url = f"{base_url}/v1/api"
    async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
        resp = await client.get(f"{base_url}/iserver/auth/status")
    if resp.status_code != 200:
        raise BrokerCredentialError("IBKR Client Portal Gateway did not return an authenticated status")
    body = resp.json() or {}
    authenticated = bool(body.get("authenticated") or body.get("authStatus", {}).get("authenticated"))
    connected = bool(body.get("connected") or body.get("authStatus", {}).get("connected"))
    if not connected or not authenticated:
        raise BrokerCredentialError("IBKR gateway is reachable but the brokerage session is not authenticated")
    return {
        "connected": connected,
        "authenticated": authenticated,
        "gateway_url": base_url,
        "account_id": account_id,
        "message": body.get("message"),
    }


async def verify_etrade_connection(
    *,
    consumer_key: str,
    consumer_secret: str,
    oauth_token: str,
    oauth_token_secret: str,
    account_env: str,
) -> dict[str, Any]:
    url = f"{_etrade_base_url(account_env)}/v1/accounts/list.json"
    header = _oauth1_header(
        method="GET",
        url=url,
        consumer_key=consumer_key,
        consumer_secret=consumer_secret,
        token=oauth_token,
        token_secret=oauth_token_secret,
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers={"Authorization": header, "Accept": "application/json"})
    if resp.status_code != 200:
        raise BrokerCredentialError("E*TRADE rejected these OAuth credentials")
    return resp.json() or {}


async def verify_schwab_connection(
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    # Batch W (HARDCODING-SWEEP C-4): host lives in Settings.
    token_url = f"{settings.SCHWAB_API_BASE_URL}/v1/oauth/token"
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            token_url,
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
    if resp.status_code != 200:
        raise BrokerCredentialError("Schwab rejected these OAuth credentials")
    body = resp.json() or {}
    expires_in = int(body.get("expires_in") or 1800)
    return {
        "access_token": body.get("access_token"),
        "refresh_token": body.get("refresh_token") or refresh_token,
        "token_type": body.get("token_type"),
        "scope": body.get("scope"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "redirect_uri": redirect_uri,
    }


async def verify_broker_credentials(
    *,
    provider: BrokerProvider,
    account_env: str,
    credentials: dict[str, Any],
) -> dict[str, Any]:
    if provider == "alpaca":
        return await verify_alpaca_credentials(
            api_key=_required(credentials, "api_key"),
            secret_key=_required(credentials, "secret_key"),
            account_env=account_env,
        )
    if provider == "ibkr":
        return await verify_ibkr_connection(
            gateway_url=_required(credentials, "gateway_url"),
            account_id=str(credentials.get("account_id") or "").strip() or None,
        )
    if provider == "etrade":
        return await verify_etrade_connection(
            consumer_key=_required(credentials, "consumer_key"),
            consumer_secret=_required(credentials, "consumer_secret"),
            oauth_token=_required(credentials, "oauth_token"),
            oauth_token_secret=_required(credentials, "oauth_token_secret"),
            account_env=account_env,
        )
    if provider == "schwab":
        return await verify_schwab_connection(
            client_id=_required(credentials, "client_id"),
            client_secret=_required(credentials, "client_secret"),
            refresh_token=_required(credentials, "refresh_token"),
            redirect_uri=str(credentials.get("redirect_uri") or "").strip() or None,
        )
    raise BrokerCredentialError(f"Unsupported broker provider: {provider}")


async def upsert_broker_connection(
    *,
    username: str,
    provider: BrokerProvider,
    account_env: str,
    credentials: dict[str, Any],
    display_name: str | None = None,
) -> Any:
    if provider not in SUPPORTED_BROKERS:
        raise BrokerCredentialError(f"Unsupported broker provider: {provider}")
    if account_env not in SUPPORTED_BROKERS[provider]["account_envs"]:
        raise BrokerCredentialError(f"{provider} does not support {account_env} connections")
    if settings.SKIP_DB_INIT:
        raise BrokerCredentialError("User database is disabled")

    verification = await verify_broker_credentials(
        provider=provider,
        account_env=account_env,
        credentials=credentials,
    )

    if provider == "alpaca":
        primary_id = _required(credentials, "api_key")
        broker_account_id = str(verification.get("account_number") or verification.get("id") or "")
        metadata = {
            "account_number": verification.get("account_number"),
            "status": verification.get("status"),
            "currency": verification.get("currency"),
            "trading_blocked": verification.get("trading_blocked"),
        }
    elif provider == "ibkr":
        primary_id = str(credentials.get("account_id") or verification.get("gateway_url") or "ibkr")
        broker_account_id = str(credentials.get("account_id") or "")
        metadata = {
            "gateway_url": verification.get("gateway_url"),
            "connected": verification.get("connected"),
            "authenticated": verification.get("authenticated"),
        }
    elif provider == "etrade":
        primary_id = _required(credentials, "consumer_key")
        broker_account_id = str(credentials.get("account_id_key") or "")
        metadata = {"account_id_key": broker_account_id}
    else:
        primary_id = _required(credentials, "client_id")
        broker_account_id = ""
        credentials = {**credentials, **{k: v for k, v in verification.items() if v is not None}}
        metadata = {
            "scope": verification.get("scope"),
            "token_type": verification.get("token_type"),
            "access_token_expires_at": verification.get("expires_at"),
        }

    metadata.update({
        "auth_model": SUPPORTED_BROKERS[provider]["auth_model"],
        "credential_fields": SUPPORTED_BROKERS[provider]["fields"],
        "trading_enabled": SUPPORTED_BROKERS[provider]["trading_enabled"],
        "reconciliation_enabled": SUPPORTED_BROKERS[provider]["reconciliation_enabled"],
    })

    from core.database import _get_session_factory
    from data.storage.models import BrokerConnection

    now = datetime.now(timezone.utc)
    encrypted_primary = encrypt_secret(primary_id)
    encrypted_bundle = encrypt_secret(_json_secret(credentials))
    factory = _get_session_factory()
    async with factory() as db:
        row = (
            await db.execute(
                select(BrokerConnection)
                .where(BrokerConnection.username == username)
                .where(BrokerConnection.provider == provider)
                .where(BrokerConnection.account_env == account_env)
            )
        ).scalar_one_or_none()
        if row is None:
            row = BrokerConnection(
                username=username,
                provider=provider,
                account_env=account_env,
                api_key_ciphertext=encrypted_primary,
                secret_key_ciphertext=encrypted_bundle,
                key_last4=_last4(primary_id),
                display_name=display_name,
                status="active",
                is_default=provider == "alpaca",
            )
            db.add(row)
        else:
            row.api_key_ciphertext = encrypted_primary
            row.secret_key_ciphertext = encrypted_bundle
            row.key_last4 = _last4(primary_id)
            row.display_name = display_name
            row.status = "active"
            row.last_error = None
        row.verified_at = now
        row.broker_account_id = broker_account_id
        row.broker_metadata = metadata
        await db.commit()
        await db.refresh(row)
        return row


async def upsert_alpaca_connection(
    *,
    username: str,
    api_key: str,
    secret_key: str,
    account_env: str,
    display_name: str | None = None,
) -> Any:
    return await upsert_broker_connection(
        username=username,
        provider="alpaca",
        account_env=account_env,
        credentials={"api_key": api_key, "secret_key": secret_key},
        display_name=display_name,
    )


def broker_connection_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "account_env": row.account_env,
        "display_name": row.display_name,
        "key_last4": row.key_last4,
        "status": row.status,
        "is_default": row.is_default,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "last_sync_at": row.last_sync_at.isoformat() if row.last_sync_at else None,
        "last_error": row.last_error,
        "broker_account_id": row.broker_account_id,
        "metadata": row.broker_metadata or {},
    }
