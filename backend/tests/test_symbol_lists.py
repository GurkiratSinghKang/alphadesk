"""Sanity tests for the curated symbol-list module (Batch V).

These are static-data shape checks, not behavioral tests. They guard
against accidental regressions when ops edits ``data/symbol_lists.py``
directly (typos, duplicate entries, lower-case symbols, etc.) and against
the original modules drifting from the canonical definitions. The
behavioral tests for the earnings screener still live in
``test_earnings_screener.py``.
"""
from __future__ import annotations

import re

import pytest


# Standard US-listed equity ticker shape: 1-5 uppercase letters. ``BRK.B``
# is the documented exception (Berkshire B-shares) and is allowed in the
# curated universe.
_TICKER_RE = re.compile(r"^[A-Z]{1,5}$")


@pytest.fixture(scope="module")
def lists():
    """Return all the lists in one fixture so each test gets a single
    import at module load.
    """
    from data import symbol_lists as sl

    return sl


def test_curated_universe_minimum_size(lists):
    """The curated universe is the trade-decision surface — if it falls
    below ~100 names, something has been deleted accidentally."""
    assert len(lists.CURATED_OPTIONABLE_UNIVERSE) >= 100


def test_curated_universe_unique(lists):
    """``frozenset`` already enforces uniqueness, but include this so the
    test guards behavior even if the type changes."""
    universe = lists.CURATED_OPTIONABLE_UNIVERSE
    assert len(universe) == len(set(universe))


def test_curated_universe_ticker_shape(lists):
    """Every symbol must be uppercase ASCII matching ``^[A-Z]{1,5}$``,
    with ``BRK.B`` documented as the only exception."""
    for sym in lists.CURATED_OPTIONABLE_UNIVERSE:
        if sym == "BRK.B":
            continue
        assert _TICKER_RE.match(sym), f"bad ticker shape: {sym!r}"


def test_headline_symbols_subset_of_universe(lists):
    """Headline symbols are the always-rescue mega-caps; if any is
    missing from the curated universe the rescue logic would surface a
    name that the rest of the screener immediately filters out."""
    headlines = set(lists.HEADLINE_EARNINGS_SYMBOLS)
    assert headlines.issubset(set(lists.CURATED_OPTIONABLE_UNIVERSE))


def test_bmo_amc_values_are_canonical(lists):
    """The schema's ReportTime literal only accepts BMO/AMC/DMT (uppercase).
    The fallback map should never emit anything else."""
    allowed = {"BMO", "AMC"}
    for sym, value in lists.BMO_AMC_FALLBACK_MAP.items():
        assert value in allowed, f"{sym!r}: {value!r} not in {allowed}"


def test_bmo_amc_keys_are_uppercase(lists):
    for sym in lists.BMO_AMC_FALLBACK_MAP:
        assert sym == sym.upper(), f"{sym!r} should be uppercase"


def test_demo_tradeable_symbols_are_uppercase(lists):
    for sym in lists.DEMO_TRADEABLE_SYMBOLS:
        assert sym == sym.upper(), f"{sym!r} should be uppercase"


def test_demo_base_prices_keys_in_demo_universe(lists):
    """Anchors for demo-quote synthesis must be tickers we'd actually
    serve demo data for — otherwise the anchor is dead weight."""
    for sym in lists.DEMO_BASE_PRICES_MARKET:
        assert sym in lists.DEMO_TRADEABLE_SYMBOLS, (
            f"{sym!r} has a demo price but isn't in DEMO_TRADEABLE_SYMBOLS"
        )


def test_demo_base_prices_positive(lists):
    """Demo prices are pinned at sane levels so synthesized quotes don't
    look obviously wrong (e.g. negative or zero)."""
    for sym, price in lists.DEMO_BASE_PRICES_MARKET.items():
        assert price > 0, f"{sym}: {price}"
    for sym, price in lists.DEMO_BASE_PRICES_OPTIONS.items():
        assert price > 0, f"{sym}: {price}"


def test_demo_base_iv_in_reasonable_range(lists):
    """Demo IV values should be in the [0.05, 1.5] band — anything
    outside that is almost certainly a typo (e.g. 0.5 → 5)."""
    for sym, iv in lists.DEMO_BASE_IV.items():
        assert 0.05 <= iv <= 1.5, f"{sym}: IV={iv} out of band"


def test_demo_volatility_in_reasonable_range(lists):
    """Demo intraday vol multipliers are tiny (single-digit %) — guard
    against accidental decimal-shift typos."""
    assert 0.001 <= lists.DEMO_DEFAULT_VOLATILITY <= 0.1
    for sym, vol in lists.DEMO_VOLATILITY.items():
        assert 0.001 <= vol <= 0.1, f"{sym}: vol={vol} out of band"


def test_re_export_from_earnings_screener_matches(lists):
    """The original module re-exports the curated universe and the BMO/AMC
    fallback under their pre-Batch-V names so existing importers still
    work. This regression-guards the indirection."""
    from services import earnings_screener as es

    assert es.CURATED_OPTIONABLE_UNIVERSE == lists.CURATED_OPTIONABLE_UNIVERSE
    assert es._CURATED_REPORT_TIME_FALLBACK == lists.BMO_AMC_FALLBACK_MAP
    assert es._HEADLINE_EARNINGS_SYMBOLS == lists.HEADLINE_EARNINGS_SYMBOLS


def test_re_export_from_market_matches(lists):
    from services import market as m

    assert m._DEMO_BASE_PRICES == lists.DEMO_BASE_PRICES_MARKET
    assert m._DEMO_VOLATILITY == lists.DEMO_VOLATILITY
    assert m._DEFAULT_VOLATILITY == lists.DEMO_DEFAULT_VOLATILITY
    assert m._VALID_DEMO_SYMBOLS == lists.DEMO_TRADEABLE_SYMBOLS


def test_re_export_from_options_matches(lists):
    from services import options as o

    assert o._DEMO_BASE_PRICES == lists.DEMO_BASE_PRICES_OPTIONS
    assert o._DEMO_BASE_IV == lists.DEMO_BASE_IV
