"""Tests for ``core.crypto`` v3 (scrypt) KDF and the cross-version compat path.

Audit fix-D (2026-05-05). Covers:

* v3 round-trip with the scrypt-derived key.
* Per-encryption random salt → two encrypts of the same plaintext under
  the same passphrase produce different ciphertexts.
* Per-encryption random nonce → ciphertexts also differ in the nonce
  prefix so AES-GCM never reuses a key+nonce pair.
* Wrong passphrase → ``cryptography.exceptions.InvalidTag``.
* Missing passphrase → ``EncryptionKeyUnavailable``.
* Backward compat: v2 (PBKDF2) and v1 (legacy sha256) ciphertexts still
  decrypt under the unchanged passphrase.
* ``crypto_version_of`` recognises every prefix the module writes /
  reads.
"""
from __future__ import annotations

import base64
import hashlib
import os

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr

from core import config as config_module
from core import crypto


@pytest.fixture
def passphrase(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set a deterministic broker-credential passphrase for the test."""
    secret = "test-passphrase-do-not-use-in-prod"
    monkeypatch.setattr(
        config_module.settings,
        "BROKER_CREDENTIAL_ENCRYPTION_KEY",
        SecretStr(secret),
    )
    return secret


def test_v3_round_trip(passphrase: str) -> None:
    plaintext = "alpaca-paper-secret-XYZ"
    ciphertext = crypto.encrypt_secret(plaintext)
    assert ciphertext.startswith("v3:"), "encrypt_secret must write v3 going forward"
    assert crypto.decrypt_secret(ciphertext) == plaintext


def test_v3_per_encryption_salt_yields_distinct_ciphertexts(passphrase: str) -> None:
    """Encrypting the same plaintext twice must produce two distinct blobs.

    Per-encryption random 16-byte salt + 12-byte nonce together guarantee
    this — proves the salt isn't being held constant somewhere.
    """
    a = crypto.encrypt_secret("identical-plaintext")
    b = crypto.encrypt_secret("identical-plaintext")
    assert a != b
    # Strip the version prefix and confirm the salt bytes (first 16) differ.
    raw_a = base64.urlsafe_b64decode(a[3:].encode("ascii"))
    raw_b = base64.urlsafe_b64decode(b[3:].encode("ascii"))
    assert raw_a[:16] != raw_b[:16], "salt prefix must vary per encryption"
    # And the nonce bytes (next 12) differ — proves AES-GCM nonce randomness.
    assert raw_a[16:28] != raw_b[16:28], "nonce must vary per encryption"


def test_v3_decrypt_with_wrong_key_raises_invalid_tag(
    passphrase: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Tampered passphrase ⇒ AES-GCM auth-tag mismatch ⇒ InvalidTag."""
    ciphertext = crypto.encrypt_secret("alpaca-secret")
    # Rotate the passphrase to a different value.
    monkeypatch.setattr(
        config_module.settings,
        "BROKER_CREDENTIAL_ENCRYPTION_KEY",
        SecretStr("a-different-passphrase"),
    )
    with pytest.raises(InvalidTag):
        crypto.decrypt_secret(ciphertext)


def test_missing_passphrase_raises_encryption_key_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        config_module.settings,
        "BROKER_CREDENTIAL_ENCRYPTION_KEY",
        SecretStr(""),
    )
    with pytest.raises(crypto.EncryptionKeyUnavailable):
        crypto.encrypt_secret("anything")
    with pytest.raises(crypto.EncryptionKeyUnavailable):
        # Decrypt of a v3 blob also needs the passphrase to derive the key.
        crypto.decrypt_secret(
            "v3:" + base64.urlsafe_b64encode(os.urandom(60)).decode()
        )


def test_decrypt_v2_pbkdf2_legacy_blob(passphrase: str) -> None:
    """A v2 blob hand-crafted with PBKDF2 must still decrypt under v3 module."""
    salt = os.urandom(crypto._SALT_BYTES)
    nonce = os.urandom(crypto._NONCE_BYTES)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        crypto._PBKDF2_ITERATIONS,
        dklen=32,
    )
    plaintext = "legacy-v2-secret"
    encrypted = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    blob = "v2:" + base64.urlsafe_b64encode(salt + nonce + encrypted).decode("ascii")

    assert crypto.decrypt_secret(blob) == plaintext


def test_decrypt_v1_sha256_legacy_blob(passphrase: str) -> None:
    """A v1 blob (single sha256 key, no salt) must still decrypt for back-compat."""
    nonce = os.urandom(crypto._NONCE_BYTES)
    key = hashlib.sha256(passphrase.encode("utf-8")).digest()
    plaintext = "legacy-v1-secret"
    encrypted = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    blob = "v1:" + base64.urlsafe_b64encode(nonce + encrypted).decode("ascii")

    assert crypto.decrypt_secret(blob) == plaintext


def test_unsupported_prefix_raises_value_error(passphrase: str) -> None:
    with pytest.raises(ValueError):
        crypto.decrypt_secret("v99:abcdef")


def test_crypto_version_of_recognises_each_prefix() -> None:
    assert crypto.crypto_version_of("v3:xxx") == 3
    assert crypto.crypto_version_of("v2:xxx") == 2
    assert crypto.crypto_version_of("v1:xxx") == 1
    assert crypto.crypto_version_of("garbage") == 0
    assert crypto.CURRENT_CRYPTO_VERSION == 3


def test_v3_uses_scrypt_not_pbkdf2(passphrase: str) -> None:
    """Sanity-check the KDF migration: v3 derived key MUST NOT match a
    PBKDF2-derived key under the same salt + passphrase.

    If someone reverts ``_derive_key_v3`` back to ``pbkdf2_hmac`` while
    leaving the v3 prefix in place, this test catches it before the
    weaker KDF ships.
    """
    salt = os.urandom(crypto._SALT_BYTES)
    scrypt_key = crypto._derive_key_v3(salt)
    pbkdf2_key = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        crypto._PBKDF2_ITERATIONS,
        dklen=32,
    )
    assert scrypt_key != pbkdf2_key
    assert len(scrypt_key) == 32
