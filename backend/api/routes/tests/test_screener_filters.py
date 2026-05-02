from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.routes.screener import ScreenRequest, ScreenerFilter


def test_screener_numeric_filter_rejects_list_for_gt() -> None:
    with pytest.raises(ValidationError, match="one numeric value"):
        ScreenerFilter(field="price", op="gt", value=[10])


def test_screener_sector_filter_requires_string_list_in() -> None:
    with pytest.raises(ValidationError, match="sector filters"):
        ScreenerFilter(field="sector", op="eq", value=1)


def test_screener_accepts_volume_and_market_cap_filters() -> None:
    req = ScreenRequest(
        filters=[
            {"field": "volume", "op": "gte", "value": 1_000_000},
            {"field": "market_cap", "op": "between", "value": [10_000_000_000, 200_000_000_000]},
            {"field": "sector", "op": "in", "value": ["Financial Services"]},
        ],
    )
    assert len(req.filters) == 3
