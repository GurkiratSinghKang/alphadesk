from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import settings


class EncryptionKeyUnavailable(RuntimeError):
    """Raised when credential encryption is requested without a configured key."""


def _derive_key() -> bytes:
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(
            "BROKER_CREDENTIAL_ENCRYPTION_KEY is required to store broker credentials"
        )
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a user-supplied broker secret with AES-256-GCM.

    The configured secret is hashed to a 32-byte key, so operators can provide
    a normal high-entropy env secret instead of hand-encoding raw key bytes.
    """
    nonce = os.urandom(12)
    ciphertext = AESGCM(_derive_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")
    return f"v1:{payload}"


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext.startswith("v1:"):
        raise ValueError("Unsupported ciphertext version")
    raw = base64.urlsafe_b64decode(ciphertext[3:].encode("ascii"))
    nonce, encrypted = raw[:12], raw[12:]
    return AESGCM(_derive_key()).decrypt(nonce, encrypted, None).decode("utf-8")
