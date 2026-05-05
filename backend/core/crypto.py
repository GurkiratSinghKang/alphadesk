from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import settings


class EncryptionKeyUnavailable(RuntimeError):
    """Raised when credential encryption is requested without a configured key."""


# Audit B-F7 (2026-05-05): the v1 ciphertext format derived the AES-256
# key with a single ``sha256(passphrase)`` call. With no KDF and no
# salt, a low-entropy passphrase (e.g. an operator who set
# BROKER_CREDENTIAL_ENCRYPTION_KEY to a memorable string) was
# brute-forceable at ~10⁹ guesses/sec on commodity GPUs. The v2 format
# adds a per-encryption 16-byte salt and 200_000 PBKDF2-HMAC-SHA256
# iterations, raising the per-guess cost by ~5 orders of magnitude.
#
# Backward compat: ``decrypt_secret`` reads both v1 (legacy) and v2
# blobs. ``encrypt_secret`` writes v2 going forward. Existing v1 rows
# in the BrokerConnection table continue to decrypt; on the next
# encrypted update they re-encrypt as v2 transparently.

_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16
_NONCE_BYTES = 12


def _legacy_key_v1() -> bytes:
    """Derive the v1 (sha256) key from the env passphrase. Decrypt-only."""
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(
            "BROKER_CREDENTIAL_ENCRYPTION_KEY is required to store broker credentials"
        )
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _derive_key_v2(salt: bytes) -> bytes:
    """Derive the v2 key from the env passphrase + a per-ciphertext salt."""
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(
            "BROKER_CREDENTIAL_ENCRYPTION_KEY is required to store broker credentials"
        )
    return hashlib.pbkdf2_hmac(
        "sha256",
        raw.encode("utf-8"),
        salt,
        _PBKDF2_ITERATIONS,
        dklen=32,
    )


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a user-supplied broker secret with AES-256-GCM (v2 format).

    v2 format: ``v2:{base64(salt || nonce || ciphertext)}``
    - 16-byte random salt (per-encryption)
    - 12-byte random nonce (per-encryption)
    - PBKDF2-HMAC-SHA256(passphrase, salt, 200000) → 32-byte key
    - AES-256-GCM ciphertext
    """
    salt = os.urandom(_SALT_BYTES)
    nonce = os.urandom(_NONCE_BYTES)
    key = _derive_key_v2(salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(salt + nonce + ciphertext).decode("ascii")
    return f"v2:{payload}"


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a ciphertext written by either v1 (legacy sha256) or v2 (PBKDF2)."""
    if ciphertext.startswith("v2:"):
        raw = base64.urlsafe_b64decode(ciphertext[3:].encode("ascii"))
        salt, nonce, encrypted = (
            raw[:_SALT_BYTES],
            raw[_SALT_BYTES : _SALT_BYTES + _NONCE_BYTES],
            raw[_SALT_BYTES + _NONCE_BYTES :],
        )
        key = _derive_key_v2(salt)
        return AESGCM(key).decrypt(nonce, encrypted, None).decode("utf-8")
    if ciphertext.startswith("v1:"):
        raw = base64.urlsafe_b64decode(ciphertext[3:].encode("ascii"))
        nonce, encrypted = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
        return AESGCM(_legacy_key_v1()).decrypt(nonce, encrypted, None).decode("utf-8")
    raise ValueError("Unsupported ciphertext version")
