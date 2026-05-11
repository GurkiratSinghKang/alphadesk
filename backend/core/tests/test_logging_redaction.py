"""Test redact_secrets — BUG-064 (audit 2026-05-11, M4-02 / M5-03).

httpx emits each outbound URL at INFO. Polygon and FMP keys leaked in
plaintext to backend.jsonl (300+ events in 32 min of capture). The
RedactingFilter in core/logging.py kills the leak at the formatter
level.
"""
from __future__ import annotations

import io
import json
import logging

from core.logging import JsonFormatter, redact_secrets


class TestRedactSecrets:
    def test_polygon_apikey_redacted(self) -> None:
        url = "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=tEOIGlik0K6EIEgYWHW3hDLTs8CYnfF9"
        out = redact_secrets(url)
        assert "tEOIGlik" not in out
        assert "apiKey=<REDACTED>" in out

    def test_fmp_apikey_redacted(self) -> None:
        url = "https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=UaSJgprABCDEFGHIJK12345"
        out = redact_secrets(url)
        assert "UaSJgpr" not in out
        assert "apikey=<REDACTED>" in out

    def test_generic_api_key_redacted(self) -> None:
        msg = "Calling vendor with api_key=secret12345 and other_param=keep_me"
        out = redact_secrets(msg)
        assert "secret12345" not in out
        assert "other_param=keep_me" in out

    def test_bearer_token_redacted(self) -> None:
        msg = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        out = redact_secrets(msg)
        assert "eyJhbGciOi" not in out
        assert "Bearer <REDACTED>" in out

    def test_multiple_secrets_one_message(self) -> None:
        msg = "url=https://x.example/?apiKey=AAAA&token=BBBB other=ok"
        out = redact_secrets(msg)
        assert "AAAA" not in out and "BBBB" not in out
        assert "other=ok" in out

    def test_no_secret_passthrough(self) -> None:
        msg = "Just a normal log line about portfolio positions"
        assert redact_secrets(msg) == msg

    def test_empty_and_none_safe(self) -> None:
        assert redact_secrets("") == ""
        assert redact_secrets(None) is None  # type: ignore[arg-type]

    def test_non_string_safe(self) -> None:
        # Should pass non-strings through unchanged.
        assert redact_secrets(42) == 42  # type: ignore[arg-type]
        assert redact_secrets({"k": "v"}) == {"k": "v"}  # type: ignore[arg-type]


class TestJsonFormatterRedacts:
    def _format(self, msg: str, **extras: object) -> dict:
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="x", lineno=1,
            msg=msg, args=(), exc_info=None,
        )
        for k, v in extras.items():
            setattr(record, k, v)
        out = JsonFormatter().format(record)
        return json.loads(out)

    def test_formatter_redacts_message(self) -> None:
        payload = self._format("HTTP GET https://api.polygon.io/?apiKey=hidden123")
        assert "hidden123" not in payload["message"]
        assert "<REDACTED>" in payload["message"]

    def test_formatter_redacts_string_extra(self) -> None:
        payload = self._format(
            "outbound", url="https://x/?apikey=leaky_token", method="GET"
        )
        assert payload["url"] == "https://x/?apikey=<REDACTED>"
        assert payload["method"] == "GET"  # untouched

    def test_formatter_non_string_extra_untouched(self) -> None:
        payload = self._format("stat", count=42, ok=True, item={"nested": "ok"})
        assert payload["count"] == 42
        assert payload["ok"] is True
        assert payload["item"] == {"nested": "ok"}
