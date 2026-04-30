from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_greeks_rejects_zero_strike() -> None:
    from api.routes.options import get_greeks

    with pytest.raises(HTTPException) as excinfo:
        await get_greeks("AAPL", 0, date.today() + timedelta(days=30), risk_free_rate=0.05)

    assert excinfo.value.status_code == 422


@pytest.mark.asyncio
async def test_greeks_rejects_unknown_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes.options import get_greeks
    import core.redis as redis_mod

    async def _empty_cache(key: str) -> Any:
        return {}

    monkeypatch.setattr(redis_mod, "cache_get", _empty_cache)

    with pytest.raises(HTTPException) as excinfo:
        await get_greeks("ZZZZZZ", 100, date.today() + timedelta(days=30), risk_free_rate=0.05)

    assert excinfo.value.status_code == 404
