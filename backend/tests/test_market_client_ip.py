from __future__ import annotations

from types import SimpleNamespace

from api.routes.market import _client_ip


def test_market_client_ip_ignores_raw_forwarded_for() -> None:
    request = SimpleNamespace(
        client=SimpleNamespace(host="203.0.113.44"),
        headers={"x-forwarded-for": "198.51.100.99"},
    )

    assert _client_ip(request) == "203.0.113.44"


def test_market_client_ip_falls_back_to_unknown_without_client() -> None:
    request = SimpleNamespace(client=None, headers={})

    assert _client_ip(request) == "unknown"
