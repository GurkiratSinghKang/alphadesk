"""B.17 — Stripe webhook signature verification tests.

Pins the HMAC-SHA256 verifier per the
https://stripe.com/docs/webhooks/signatures#verify-manually
specification. Stripe re-delivers events under network conditions;
the idempotency check + tolerance window are both load-bearing.
"""
from __future__ import annotations

import hashlib
import hmac
import time

import pytest


def _sign(payload: bytes, secret: str, ts: int) -> str:
    signed = f"{ts}.".encode("utf-8") + payload
    sig = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_verify_signature_happy_path() -> None:
    from services.billing.stripe_webhook import verify_signature

    secret = "whsec_test_secret"
    payload = b'{"id":"evt_1","type":"invoice.paid"}'
    ts = int(time.time())
    header = _sign(payload, secret, ts)
    # Should not raise.
    verify_signature(
        payload=payload,
        signature_header=header,
        secret=secret,
        now_unix=ts,
    )


def test_verify_signature_rejects_tampered_payload() -> None:
    from services.billing.stripe_webhook import (
        StripeSignatureError,
        verify_signature,
    )

    secret = "whsec_test_secret"
    payload = b'{"id":"evt_1","type":"invoice.paid"}'
    ts = int(time.time())
    header = _sign(payload, secret, ts)
    tampered = b'{"id":"evt_1","type":"invoice.paid","extra":1}'
    with pytest.raises(StripeSignatureError, match="No v1 signature matched"):
        verify_signature(
            payload=tampered,
            signature_header=header,
            secret=secret,
            now_unix=ts,
        )


def test_verify_signature_rejects_wrong_secret() -> None:
    from services.billing.stripe_webhook import (
        StripeSignatureError,
        verify_signature,
    )

    payload = b'{"id":"evt_1"}'
    ts = int(time.time())
    header = _sign(payload, "secret_a", ts)
    with pytest.raises(StripeSignatureError, match="No v1 signature matched"):
        verify_signature(
            payload=payload,
            signature_header=header,
            secret="secret_b",
            now_unix=ts,
        )


def test_verify_signature_rejects_outside_tolerance() -> None:
    from services.billing.stripe_webhook import (
        DEFAULT_TOLERANCE_SECONDS,
        StripeSignatureError,
        verify_signature,
    )

    secret = "whsec_test_secret"
    payload = b'{"id":"evt_1"}'
    old_ts = int(time.time()) - DEFAULT_TOLERANCE_SECONDS - 60
    header = _sign(payload, secret, old_ts)
    with pytest.raises(StripeSignatureError, match="outside tolerance"):
        verify_signature(
            payload=payload,
            signature_header=header,
            secret=secret,
        )


def test_verify_signature_rejects_missing_secret() -> None:
    from services.billing.stripe_webhook import (
        StripeSignatureError,
        verify_signature,
    )

    payload = b'{"id":"evt_1"}'
    ts = int(time.time())
    header = _sign(payload, "secret", ts)
    with pytest.raises(StripeSignatureError, match="not configured"):
        verify_signature(
            payload=payload,
            signature_header=header,
            secret="",
            now_unix=ts,
        )


def test_verify_signature_rejects_missing_header() -> None:
    from services.billing.stripe_webhook import (
        StripeSignatureError,
        verify_signature,
    )

    with pytest.raises(StripeSignatureError, match="Missing"):
        verify_signature(
            payload=b"{}",
            signature_header="",
            secret="secret",
        )


def test_verify_signature_rejects_malformed_header() -> None:
    from services.billing.stripe_webhook import (
        StripeSignatureError,
        verify_signature,
    )

    with pytest.raises(StripeSignatureError, match="missing"):
        verify_signature(
            payload=b"{}",
            signature_header="random_garbage",
            secret="secret",
        )
