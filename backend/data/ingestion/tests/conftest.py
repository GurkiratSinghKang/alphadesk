"""pytest configuration for ingestion tests."""
from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: test hits a real DB or external API.",
    )
