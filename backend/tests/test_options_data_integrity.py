from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest


@pytest.mark.asyncio
async def test_fetch_real_chain_requires_real_spot_price():
    """OPRA snapshots plus synthetic spot must not be labelled real."""
    from services import options as opts

    opts._chain_cache.clear()
    with patch.object(opts, "_alpaca_keys_empty", return_value=False), \
         patch.object(opts, "_fetch_alpaca_spot", AsyncMock(return_value=None)):
        chain = await opts._fetch_real_chain("AAPL", None, None, None, None)

    assert chain is None


@pytest.mark.asyncio
async def test_fetch_real_iv_does_not_emit_same_snapshot_iv_rank_proxy():
    """Smile dispersion is not historical IV rank."""
    from services import options as opts

    expiry = date(2026, 1, 16)
    contracts = [
        opts.OptionContract(
            symbol=f"AAPL260116C00{strike:05d}000",
            underlying="AAPL",
            expiry=expiry,
            strike=float(strike),
            option_type=opts.OptionType.CALL,
            bid=1.0,
            ask=1.2,
            last=1.1,
            volume=100,
            open_interest=1000,
            iv=iv,
            delta=0.5,
            gamma=0.01,
            theta=-0.02,
            vega=0.1,
        )
        for strike, iv in [
            (90, 0.22),
            (95, 0.24),
            (100, 0.30),
            (105, 0.36),
            (110, 0.40),
        ]
    ]
    chain = opts.OptionChain(
        underlying="AAPL",
        spot_price=100.0,
        expirations=[expiry],
        contracts=contracts,
        fetched_at=datetime.now(timezone.utc),
        is_demo=False,
    )

    class _FakeBars:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def bars(self, *args, **kwargs):
            return pd.DataFrame({"close": [100.0, 101.0, 102.0]})

    opts._iv_cache.clear()
    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=chain)), \
         patch("data.providers.alpaca.AlpacaBarProvider", _FakeBars):
        iv = await opts._fetch_real_iv("AAPL")

    assert iv is not None
    assert iv.current_iv is not None
    assert iv.iv_rank is None
    assert iv.iv_percentile is None
    assert iv.is_demo is False
