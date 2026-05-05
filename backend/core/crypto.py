from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from core.config import settings


class EncryptionKeyUnavailable(RuntimeError):
    """Raised when credential encryption is requested without a configured key."""


# Audit B-F7 (2026-05-05): the v1 ciphertext format derived the AES-256
# key with a single ``sha256(passphrase)`` call. With no KDF and no
# salt, a low-entropy passphrase (e.g. an operator who set
# BROKER_CREDENTIAL_ENCRYPTION_KEY to a memorable string) was
# brute-forceable at ~10^9 guesses/sec on commodity GPUs. The v2 format
# adds a per-encryption 16-byte salt and 200_000 PBKDF2-HMAC-SHA256
# iterations, raising the per-guess cost by ~5 orders of magnitude.
#
# Audit fix-D (2026-05-05): v3 upgrades the KDF from PBKDF2 (compute-
# hard only) to ``cryptography.hazmat.primitives.kdf.scrypt.Scrypt``
# (memory-hard: N=2^14, r=8, p=1, 32-byte output). Scrypt forces an
# attacker to spend ~16MB of RAM per guess, which neutralises the
# GPU/ASIC speedup that PBKDF2 still leaves on the table.
#
# Per-encryption random salt (NOT a fixed env-var salt): the original
# audit prompt suggested adding a ``BROKER_CREDENTIAL_ENCRYPTION_SALT``
# env var. We keep the v2 design's per-encryption random salt instead
# because:
#   * A fixed env salt makes every row's KDF derive the SAME key, so
#     a precomputed scrypt table works against every row at once.
#   * A per-encryption random salt forces the attacker to redo the
#     full scrypt derivation per row (no precomputation gain).
#   * Salt secrecy adds zero security — salts are public by design;
#     keeping the salt as an env var only adds an operational footgun
#     (lose the env, lose every credential).
# So v3 carries the salt inside the ciphertext, the same way v2 did.
#
# Backward compat: ``decrypt_secret`` reads v1 (legacy sha256), v2
# (PBKDF2), and v3 (scrypt) blobs. ``encrypt_secret`` writes v3 going
# forward. Existing v1/v2 rows in ``broker_connections`` continue to
# decrypt; on the next encrypted update they re-encrypt as v3
# transparently. ``scripts/migrate_broker_credential_encryption.py``
# bulk re-encrypts in place so v1/v2 ciphertexts can be removed from
# the live DB without waiting for organic refresh.

_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16
_NONCE_BYTES = 12

# Scrypt parameters (RFC 7914 / OWASP guidance for password storage).
# N=2^14, r=8, p=1 → ~16MB RAM, ~10ms CPU per derivation on commodity
# hardware. Tuned for "interactive" responsiveness on the encrypt path
# (broker-credential save is a low-frequency interactive action).
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_KEY_LEN = 32

CURRENT_CRYPTO_VERSION = 3


def _legacy_key_v1() -> bytes:
    """Derive the v1 (sha256) key from the env passphrase. Decrypt-only."""
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(
            "BROKER_CREDENTIAL_ENCRYPTION_KEY is required to store broker credentials"
        )
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _derive_key_v2(salt: bytes) -> bytes:
    """Derive the v2 key (PBKDF2-HMAC-SHA256) from the env passphrase + salt.

    Decrypt-only. The v3 path (scrypt) replaces it on encrypt.
    """
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


def _derive_key_v3(salt: bytes) -> bytes:
    """Derive the v3 key (scrypt, memory-hard) from the env passphrase + salt."""
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(
            "BROKER_CREDENTIAL_ENCRYPTION_KEY is required to store broker credentials"
        )
    kdf = Scrypt(
        salt=salt,
        length=_SCRYPT_KEY_LEN,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
    )
    return kdf.derive(raw.encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a user-supplied broker secret with AES-256-GCM (v3 format).

    v3 format: ``v3:{base64(salt || nonce || ciphertext)}``
    - 16-byte random salt (per-encryption)
    - 12-byte random nonce (per-encryption)
    - scrypt(passphrase, salt, N=2^14, r=8, p=1) → 32-byte key
    - AES-256-GCM ciphertext (auth-tag appended by AESGCM)
    """
    salt = os.urandom(_SALT_BYTES)
    nonce = os.urandom(_NONCE_BYTES)
    key = _derive_key_v3(salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(salt + nonce + ciphertext).decode("ascii")
    return f"v3:{payload}"


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a ciphertext written by v1 (legacy sha256), v2 (PBKDF2), or v3 (scrypt)."""
    if ciphertext.startswith("v3:"):
        raw = base64.urlsafe_b64decode(ciphertext[3:].encode("ascii"))
        salt, nonce, encrypted = (
            raw[:_SALT_BYTES],
            raw[_SALT_BYTES : _SALT_BYTES + _NONCE_BYTES],
            raw[_SALT_BYTES + _NONCE_BYTES :],
        )
        key = _derive_key_v3(salt)
        return AESGCM(key).decrypt(nonce, encrypted, None).decode("utf-8")
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


def crypto_version_of(ciphertext: str) -> int:
    """Return the format version embedded in a ciphertext prefix.

    Used by the bulk migration script to filter rows already at the
    target version. Returns 0 for unrecognized blobs (caller decides
    whether to skip or error).
    """
    if ciphertext.startswith("v3:"):
        return 3
    if ciphertext.startswith("v2:"):
        return 2
    if ciphertext.startswith("v1:"):
        return 1
    return 0
