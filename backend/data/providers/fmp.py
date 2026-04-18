"""Financial Modeling Prep adapters: earnings + fundamentals.

FMP's v3 API was retired 2025-08-31; we use the ``/stable/`` endpoints
exclusively. Implementation split across :mod:`_fmp_http` (shared HTTP layer),
:mod:`fmp_earnings` (earnings calendar / surprises / consensus) and
:mod:`fmp_fundamentals` (statements + Piotroski F-score). ``fmp.py``
re-exports the public classes.

API reference: https://site.financialmodelingprep.com/developer/docs
"""

from __future__ import annotations

from data.providers.fmp_earnings import FMPEarningsProvider
from data.providers.fmp_fundamentals import FMPFundamentalsProvider

__all__ = ["FMPEarningsProvider", "FMPFundamentalsProvider"]


if __name__ == "__main__":
    import logging
    from datetime import date

    logging.basicConfig(level=logging.INFO)

    print("=== FMPEarningsProvider.calendar(2024-01-01 .. 2024-01-15) ===")
    with FMPEarningsProvider() as ep:
        cal = ep.calendar("2024-01-01", "2024-01-15")
        print(f"calendar rows: {len(cal)}")
        sample = cal[cal["eps_actual"].notna() & cal["eps_estimated"].notna()].head(5)
        print(sample)

        print("\n=== surprises(AAPL, 2019-01-01 .. 2024-12-31) ===")
        sp = ep.surprises("AAPL", "2019-01-01", "2024-12-31")
        print(f"rows: {len(sp)}")
        print(sp.tail(6))

        print("\n=== consensus(AAPL, today) ===")
        print(ep.consensus("AAPL", date.today()))

    print("\n=== FMPFundamentalsProvider.piotroski_f(AAPL, 2023-12-31) ===")
    with FMPFundamentalsProvider() as fp:
        print(f"Piotroski F-score: {fp.piotroski_f('AAPL', date(2023, 12, 31))}")
