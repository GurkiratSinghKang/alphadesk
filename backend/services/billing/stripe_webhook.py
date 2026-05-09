"""B.17 — Stripe webhook signature verification + idempotent ingest.

Per the redesign plan §B.17 risk register: avoid PCI-DSS scope by
routing all card collection through Stripe-hosted Checkout. The
webhook receiver must (1) verify the Stripe-Signature header before
trusting the payload, and (2) be idempotent — Stripe re-delivers
events under network conditions, so we key on ``event.id`` and
return 200 silently on a duplicate.

This module ships the pure verifier + handler; the route shim in
api/routes lights up in the Phase 1.x billing follow-up. The
reconciler (daily job that catches up on missed webhooks via the
Stripe API) ships separately in scripts/billing_reconcile.py.

Design notes:
  - We DO NOT depend on the official ``stripe`` SDK for signature
    verification — the algorithm is HMAC-SHA256 + a fixed schema
    documented at https://stripe.com/docs/webhooks/signatures#verify-manually.
    Implementing it inline keeps the dependency surface narrow and
    makes the verification logic auditable.
  - Webhook secrets live in env: ``STRIPE_WEBHOOK_SECRET``.
  - Tolerance window for replay protection: 5 minutes (Stripe
    default; configurable via ``STRIPE_WEBHOOK_TOLERANCE_S``).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any

from sqlalchemy import select


logger = logging.getLogger("alphadesk.v2.billing.stripe_webhook")

DEFAULT_TOLERANCE_SECONDS = 300


class StripeSignatureError(Exception):
    """Raised when the Stripe-Signature header fails verification."""


def _parse_signature_header(header: str) -> dict[str, str]:
    """Parse the Stripe-Signature header into a key→value dict.

    Header format: ``t=1234,v1=signature1,v0=signature0``.
    """
    out: dict[str, str] = {}
    for part in header.split(","):
        if "=" not in part:
            continue
        k, _, v = part.strip().partition("=")
        out[k.strip()] = v.strip()
    return out


def verify_signature(
    *,
    payload: bytes,
    signature_header: str,
    secret: str,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now_unix: int | None = None,
) -> None:
    """Raise ``StripeSignatureError`` if the payload doesn't verify.

    Implements the Stripe-documented HMAC-SHA256 verification:
    1. Extract `t` (timestamp) + at least one `v1` signature from
       the header.
    2. Compose the signed payload as ``f"{t}.{payload_text}"``.
    3. Compute HMAC-SHA256(secret, signed_payload).
    4. Constant-time compare against every `v1` value.
    5. Reject if the timestamp is older than tolerance_seconds.
    """
    if not signature_header:
        raise StripeSignatureError("Missing Stripe-Signature header")
    if not secret:
        raise StripeSignatureError("Stripe webhook secret not configured")

    parts = _parse_signature_header(signature_header)
    timestamp = parts.get("t")
    if timestamp is None:
        raise StripeSignatureError("Header missing t= timestamp")
    try:
        t_int = int(timestamp)
    except ValueError as exc:
        raise StripeSignatureError(f"Bad timestamp {timestamp!r}") from exc

    now = now_unix if now_unix is not None else int(time.time())
    if abs(now - t_int) > tolerance_seconds:
        raise StripeSignatureError(
            f"Timestamp {t_int} outside tolerance window of {tolerance_seconds}s "
            f"from now {now}"
        )

    candidates = [v for k, v in parts.items() if k.startswith("v1")]
    if not candidates:
        raise StripeSignatureError("Header missing any v1= signature")

    signed_payload = f"{timestamp}.".encode("utf-8") + payload
    expected = hmac.new(
        secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    for candidate in candidates:
        if hmac.compare_digest(expected, candidate):
            return

    raise StripeSignatureError("No v1 signature matched")


async def ingest_webhook(
    payload: bytes,
    signature_header: str,
    db,
    *,
    secret: str | None = None,
) -> dict[str, Any]:
    """Verify + persist a Stripe webhook event.

    Verifies the signature, parses the JSON, and inserts a
    BillingEvent row keyed on ``event.id``. Returns
    ``{"status": "ok", "duplicate": bool, "event_id": str}``.

    Idempotency: a UNIQUE constraint on the BillingEvent ``payload->>id``
    isn't possible without a generated column, so we instead query by
    JSON path before insert. The race-prone path returns
    ``duplicate=True``; concurrent identical webhook deliveries are
    documented as benign by Stripe.
    """
    from data.storage.models import BillingEvent

    secret = secret or os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    verify_signature(
        payload=payload,
        signature_header=signature_header,
        secret=secret,
    )
    try:
        event = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StripeSignatureError(f"Payload not valid JSON: {exc}") from exc

    event_id = event.get("id")
    kind = event.get("type")
    if not event_id or not kind:
        raise StripeSignatureError("Event missing id or type")

    # Idempotency check — don't insert the same Stripe event twice.
    # Stripe documents this as a normal occurrence under network
    # retries; the reconciler also handles missed events.
    from sqlalchemy import text

    existing = (
        await db.execute(
            text(
                "SELECT id FROM billing_event "
                "WHERE payload @> CAST(:probe AS JSONB) LIMIT 1"
            ).bindparams(probe=json.dumps({"id": event_id}))
        )
    ).first()
    if existing:
        return {"status": "ok", "duplicate": True, "event_id": event_id}

    row = BillingEvent(kind=kind, payload=event)
    db.add(row)
    await db.commit()
    return {"status": "ok", "duplicate": False, "event_id": event_id}


__all__ = [
    "DEFAULT_TOLERANCE_SECONDS",
    "StripeSignatureError",
    "verify_signature",
    "ingest_webhook",
]
