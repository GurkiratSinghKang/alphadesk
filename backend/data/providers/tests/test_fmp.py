"""Integration tests for :class:`FMPEarningsProvider` and
:class:`FMPFundamentalsProvider`."""

from __future__ import annotations

from datetime import date

import pytest

from data.providers.fmp import FMPEarningsProvider, FMPFundamentalsProvider

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def earnings():
    with FMPEarningsProvider() as p:
        yield p


@pytest.fixture(scope="module")
def funds():
    with FMPFundamentalsProvider() as p:
        yield p


def test_calendar_returns_rows(earnings):
    df = earnings.calendar("2024-01-01", "2024-01-15")
    assert len(df) > 0
    cols = {
        "symbol", "date", "eps_actual", "eps_estimated",
        "revenue_actual", "revenue_estimated", "last_updated",
    }
    assert cols == set(df.columns)
    # At least some large-caps should have both actual and estimated EPS
    has_both = df[df["eps_actual"].notna() & df["eps_estimated"].notna()]
    assert len(has_both) > 0


def test_surprises_aapl(earnings):
    df = earnings.surprises("AAPL", "2019-01-01", "2024-12-31")
    assert len(df) >= 20
    assert "sue" in df.columns
    # SUE should be populated for later rows (needs ≥4 prior surprises)
    assert df["sue"].notna().sum() >= 10


def test_consensus_aapl(earnings):
    c = earnings.consensus("AAPL", date.today())
    assert c["symbol"] == "AAPL"
    # Either a future date, or None if the feed is lagging
    if c["next_earnings_date"] is not None:
        assert c["next_earnings_date"] >= date.today()


def test_statements_point_in_time(funds):
    out = funds.statements("AAPL", date(2023, 12, 31))
    assert set(out.keys()) == {"income", "balance", "cashflow", "profile"}
    inc = out["income"]
    assert not inc.empty
    # No rows filed after 2023-12-31
    import pandas as pd

    filing = pd.to_datetime(inc["filingDate"]).dt.date
    assert (filing <= date(2023, 12, 31)).all()


def test_piotroski_f_aapl(funds):
    score = funds.piotroski_f("AAPL", date(2023, 12, 31))
    assert isinstance(score, int)
    assert 0 <= score <= 9
