"""Polygon market-data adapters.

Two independent providers live behind this module:

* :class:`PolygonStockBarProvider` — equity OHLCV bars (redundant with Alpaca
  but kept as a failover and source cross-check).
* :class:`PolygonOptionsProvider` — chain snapshots, contract aggregates and
  historical ATM implied-volatility series.

Implementation is split across :mod:`_polygon_http` (shared HTTP layer),
:mod:`polygon_bars` (stock bars) and :mod:`polygon_options` (options chain +
contract bars + IV) so each file stays under 400 LoC. ``polygon.py`` re-exports
the public classes so callers can write ``from ...polygon import X``.

API reference: https://polygon.io/docs/stocks, https://polygon.io/docs/options.
"""

from __future__ import annotations

from data.providers.polygon_bars import PolygonStockBarProvider
from data.providers.polygon_options import PolygonOptionsProvider

__all__ = ["PolygonStockBarProvider", "PolygonOptionsProvider"]


if __name__ == "__main__":
    import logging
    from datetime import date

    import httpx

    logging.basicConfig(level=logging.INFO)

    print("=== PolygonStockBarProvider ===")
    try:
        with PolygonStockBarProvider() as bp:
            df = bp.bars(["SPY"], "2024-01-02", "2024-01-05")
            print(df)
    except httpx.HTTPStatusError as exc:
        print(f"  (skipped: {exc.response.status_code} — "
              f"stock bars require Polygon Stocks plan, not Options Developer)")

    print("\n=== PolygonOptionsProvider.chain_snapshot (live) ===")
    with PolygonOptionsProvider() as op:
        chain = op.chain_snapshot("SPY", date.today())
        print(f"live chain rows: {len(chain)}")
        print(chain.head())

        print("\n=== contract_bars(O:SPY240119C00475000, 2024-01-02..12) ===")
        cb = op.contract_bars("O:SPY240119C00475000", "2024-01-02", "2024-01-12")
        print(cb)
        assert len(cb) >= 7, f"expected >=7 rows, got {len(cb)}"
        print("contract_bars OK")
