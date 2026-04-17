"""pytest configuration for provider tests.

Registers the ``integration`` marker so live-API tests can be selected or
skipped via ``pytest -m integration`` / ``pytest -m 'not integration'``.
"""

from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: test hits a real external API (Alpaca/Polygon/FMP). "
        "Requires API keys in .env.",
    )
    config.addinivalue_line(
        "markers",
        "slow: test takes >10s (e.g. paginates a full option chain). "
        "Select with 'pytest -m slow', skip with 'pytest -m \"not slow\"'.",
    )
