"""Unit tests for ``FMPFundamentalsProvider.sp500_constituents`` (Plan B.2).

These tests mock the FMP HTTP calls — no network access. The asof-walking
logic is the actual unit under test.
"""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from data.providers.fmp_fundamentals import FMPFundamentalsProvider


def _provider_with_fake(current_records: list[dict], history_records: list[dict]) -> FMPFundamentalsProvider:
    """Build a provider whose ``_sp500_current`` and ``_sp500_historical_changes``
    are stubbed to return deterministic DataFrames.

    Stubbing at the method level (not the HTTP layer) bypasses the
    ``@cached`` decorator's disk cache, so tests don't bleed across runs
    or get polluted by previous live-API calls.
    """
    p = FMPFundamentalsProvider.__new__(FMPFundamentalsProvider)
    current_df = pd.DataFrame(current_records)
    history_df = pd.DataFrame(history_records)
    if not history_df.empty and "date" in history_df.columns:
        history_df["date"] = pd.to_datetime(history_df["date"], errors="coerce").dt.date
        history_df = history_df.sort_values("date", ascending=False).reset_index(drop=True)
    # Bind stubs that ignore the cache decorator entirely.
    p._sp500_current = lambda: current_df  # type: ignore[method-assign]
    p._sp500_historical_changes = lambda: history_df  # type: ignore[method-assign]
    return p


def test_sp500_constituents_returns_current_for_today() -> None:
    """When asof is today (no future changes), return all current members."""
    current = [
        {"symbol": "AAPL", "name": "Apple Inc."},
        {"symbol": "MSFT", "name": "Microsoft Corp"},
        {"symbol": "TSLA", "name": "Tesla Inc"},
    ]
    p = _provider_with_fake(current, [])
    names = p.sp500_constituents(date.today())
    assert names == ["AAPL", "MSFT", "TSLA"]


def test_addition_after_asof_excluded() -> None:
    """A stock added AFTER asof should NOT be in the asof membership."""
    current = [
        {"symbol": "AAPL"},
        {"symbol": "MSFT"},
        {"symbol": "TSLA"},
    ]
    history = [
        # TSLA was added on 2020-12-18 (FMP's actual date)
        {
            "date": "2020-12-18",
            "symbol": "TSLA",
            "addedSecurity": "Tesla Inc",
            "removedTicker": "AIV",
            "removedSecurity": "Apartment Investment & Management",
        },
    ]
    p = _provider_with_fake(current, history)
    # asof BEFORE the add date — TSLA should not be a member, AIV should be
    pre = p.sp500_constituents(date(2020, 12, 17))
    assert "TSLA" not in pre
    assert "AIV" in pre
    # asof AFTER the add date — TSLA member, AIV no longer
    post = p.sp500_constituents(date(2020, 12, 19))
    assert "TSLA" in post
    assert "AIV" not in post


def test_replacement_swap_correct_at_both_sides() -> None:
    """A replacement event should swap one stock for another on the boundary."""
    current = [{"symbol": "AAPL"}, {"symbol": "MSFT"}, {"symbol": "CASY"}]
    history = [
        {
            "date": "2026-04-09",
            "symbol": "CASY",
            "addedSecurity": "Casey's General Stores",
            "removedTicker": "HOLX",
            "removedSecurity": "Hologic Inc.",
        },
    ]
    p = _provider_with_fake(current, history)
    pre = p.sp500_constituents(date(2026, 4, 8))
    post = p.sp500_constituents(date(2026, 4, 10))
    assert "CASY" not in pre and "HOLX" in pre
    assert "CASY" in post and "HOLX" not in post


def test_no_history_returns_current() -> None:
    """If FMP returns no historical changes, every asof returns the current list."""
    current = [{"symbol": "A"}, {"symbol": "B"}]
    p = _provider_with_fake(current, [])
    assert p.sp500_constituents(date(2019, 1, 1)) == ["A", "B"]
    assert p.sp500_constituents(date.today()) == ["A", "B"]


def test_empty_current_returns_empty() -> None:
    """If FMP returns nothing for the current list, return [] (caller falls back)."""
    p = _provider_with_fake([], [])
    assert p.sp500_constituents(date(2024, 1, 1)) == []


def test_returned_symbols_are_uppercase_and_sorted() -> None:
    """Symbols normalize to upper-case and the result is alphabetically sorted."""
    current = [
        {"symbol": "msft"},
        {"symbol": "AAPL"},
        {"symbol": "Brk-b"},
    ]
    p = _provider_with_fake(current, [])
    names = p.sp500_constituents(date.today())
    assert names == ["AAPL", "BRK-B", "MSFT"]


def test_asof_string_accepted() -> None:
    """asof can be a date, datetime, or ISO string — all should normalize."""
    current = [{"symbol": "A"}, {"symbol": "B"}]
    p = _provider_with_fake(current, [])
    assert p.sp500_constituents("2024-01-15") == ["A", "B"]


def test_invalid_asof_returns_empty() -> None:
    """A non-parseable asof returns [] (caller falls back to static seed)."""
    current = [{"symbol": "A"}]
    p = _provider_with_fake(current, [])
    assert p.sp500_constituents("not-a-date") == []


def test_multiple_changes_compose_correctly() -> None:
    """Walking back through several changes should compose."""
    current = [{"symbol": "C"}, {"symbol": "D"}, {"symbol": "E"}]
    history = [
        # newest first per FMP's convention (we re-sort anyway)
        {"date": "2024-06-01", "symbol": "E", "addedSecurity": "E Corp",
         "removedTicker": "X", "removedSecurity": "X Co"},
        {"date": "2024-03-01", "symbol": "D", "addedSecurity": "D Corp",
         "removedTicker": "Y", "removedSecurity": "Y Co"},
        {"date": "2024-01-01", "symbol": "C", "addedSecurity": "C Corp",
         "removedTicker": "Z", "removedSecurity": "Z Co"},
    ]
    p = _provider_with_fake(current, history)
    # Before all 3 changes: membership is X, Y, Z
    pre = p.sp500_constituents(date(2023, 12, 31))
    assert pre == ["X", "Y", "Z"]
    # After first change only (Z->C): C, Y, X
    mid1 = p.sp500_constituents(date(2024, 1, 15))
    assert mid1 == ["C", "X", "Y"]
    # After two changes (Z->C, Y->D): C, D, X
    mid2 = p.sp500_constituents(date(2024, 3, 15))
    assert mid2 == ["C", "D", "X"]
    # After all three: C, D, E (current)
    after = p.sp500_constituents(date(2024, 6, 15))
    assert after == ["C", "D", "E"]
