"""FMP fundamentals provider: annual statements + Piotroski F-score."""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

import pandas as pd

from data.providers._fmp_http import FMPHTTP
from data.providers.cache import TTL_ANNUAL, cached


TTL_SP500_MEMBERSHIP = 60 * 60 * 24


class FMPFundamentalsProvider:
    """Satisfies :class:`backend.data.providers.base.FundamentalsProvider`."""

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._http = FMPHTTP(api_key, timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "FMPFundamentalsProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---- statements ---------------------------------------------------------
    def statements(self, symbol: str, asof: date | datetime | str) -> dict:
        sym = symbol.upper()
        asof_d = _to_date(asof)
        income = self._statement_frame(sym, "income-statement")
        balance = self._statement_frame(sym, "balance-sheet-statement")
        cashflow = self._statement_frame(sym, "cash-flow-statement")
        profile = self._profile_cached(sym)

        def _pit(df: pd.DataFrame) -> pd.DataFrame:
            if df.empty or "filingDate" not in df.columns:
                return df
            mask = pd.to_datetime(df["filingDate"]).dt.date <= asof_d
            return df[mask].reset_index(drop=True)

        return {
            "income": _pit(income),
            "balance": _pit(balance),
            "cashflow": _pit(cashflow),
            "profile": profile.iloc[0].to_dict() if not profile.empty else {},
        }

    @cached(ttl_seconds=TTL_ANNUAL)
    def _statement_frame(self, symbol: str, endpoint: str) -> pd.DataFrame:
        """Annual statements, newest first."""
        data = self._http.get(
            f"/{endpoint}", {"symbol": symbol, "period": "FY", "limit": 10}
        )
        if not data:
            return pd.DataFrame()
        df = pd.DataFrame(data)
        if "date" in df.columns:
            df = df.sort_values("date", ascending=False).reset_index(drop=True)
        return df

    @cached(ttl_seconds=TTL_ANNUAL)
    def _profile_cached(self, symbol: str) -> pd.DataFrame:
        data = self._http.get("/profile", {"symbol": symbol})
        if not data:
            return pd.DataFrame()
        return pd.DataFrame(data)

    # ---- sp500 point-in-time membership (Plan B.2) -------------------------
    @cached(ttl_seconds=TTL_SP500_MEMBERSHIP)
    def _sp500_current(self) -> pd.DataFrame:
        """Current S&P 500 constituents (FMP stable ``/sp500-constituent``)."""
        data = self._http.get("/sp500-constituent", {})
        if not data:
            return pd.DataFrame()
        return pd.DataFrame(data)

    @cached(ttl_seconds=TTL_SP500_MEMBERSHIP)
    def _sp500_historical_changes(self) -> pd.DataFrame:
        """Historical add/remove events for the S&P 500.

        FMP returns events newest-first; each row may represent an addition
        (``symbol``/``addedSecurity`` populated), a removal
        (``removedTicker``/``removedSecurity``), or a replacement (both).
        """
        data = self._http.get("/historical-sp500-constituent", {})
        if not data:
            return pd.DataFrame()
        df = pd.DataFrame(data)
        # Normalize the date column — FMP varies between "date" and "dateAdded"
        if "date" not in df.columns and "dateAdded" in df.columns:
            df["date"] = df["dateAdded"]
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
            df = df.sort_values("date", ascending=False).reset_index(drop=True)
        return df

    def sp500_constituents(self, asof: date | datetime | str) -> list[str]:
        """Return the S&P 500 constituent symbols as of ``asof``.

        Method: start from the current membership, then walk the historical
        change log backwards from today to ``asof``, undoing each change.

        For a change with ``date > asof``:
          - if a symbol was *added* after asof → remove it from the membership
          - if a symbol was *removed* after asof → add it back to the membership

        Returns an alphabetically-sorted list of upper-case ticker symbols.
        Returns an empty list if FMP is unreachable or returns no data; PEAD's
        ``load_universe()`` falls back to its static seed in that case.
        """
        asof_d = _to_date(asof)
        if asof_d is None:
            return []

        current = self._sp500_current()
        if current.empty or "symbol" not in current.columns:
            return []
        membership: set[str] = {
            str(s).upper() for s in current["symbol"].tolist() if s
        }

        changes = self._sp500_historical_changes()
        if not changes.empty and "date" in changes.columns:
            # Filter to changes that happened AFTER asof; undo them.
            future_changes = changes[changes["date"] > asof_d]
            for _, row in future_changes.iterrows():
                added_sym = row.get("symbol")
                removed_sym = row.get("removedTicker")
                if added_sym and isinstance(added_sym, str):
                    # This symbol was added after asof — at asof it wasn't a member yet.
                    membership.discard(added_sym.upper())
                if removed_sym and isinstance(removed_sym, str):
                    # This symbol was removed after asof — at asof it was still a member.
                    membership.add(removed_sym.upper())

        return sorted(membership)

    # ---- piotroski_f --------------------------------------------------------
    def piotroski_f(self, symbol: str, asof: date | datetime | str) -> int:
        """Piotroski (2000) F-score 0–9 from latest two annual statements.

        Tests:
          Profitability (4): NI>0, CFO>0, ROA Δ+, Accruals(CFO>NI)
          Leverage/liquidity/funding (3): LT-debt/assets Δ−, current ratio Δ+, no new issuance
          Operating efficiency (2): gross margin Δ+, asset turnover Δ+
        """
        s = self.statements(symbol, asof)
        inc, bal, cf = s["income"], s["balance"], s["cashflow"]
        if len(inc) < 2 or len(bal) < 2 or len(cf) < 2:
            raise ValueError(
                f"piotroski_f({symbol}, {asof}): need ≥2 annual statements, "
                f"have inc={len(inc)} bal={len(bal)} cf={len(cf)}"
            )

        i_now, i_prev = inc.iloc[0], inc.iloc[1]
        b_now, b_prev = bal.iloc[0], bal.iloc[1]
        c_now, c_prev = cf.iloc[0], cf.iloc[1]

        score = 0
        # 1. Net income > 0
        if _safe(i_now, "netIncome") > 0:
            score += 1
        # 2. CFO > 0
        cfo_now = _safe(c_now, "operatingCashFlow",
                        "netCashProvidedByOperatingActivities")
        if cfo_now > 0:
            score += 1
        # 3. ROA improvement
        ta_now = _safe(b_now, "totalAssets")
        ta_prev = _safe(b_prev, "totalAssets")
        roa_now = _safe(i_now, "netIncome") / ta_now if ta_now else float("nan")
        roa_prev = _safe(i_prev, "netIncome") / ta_prev if ta_prev else float("nan")
        if _gt(roa_now, roa_prev):
            score += 1
        # 4. Accruals: CFO > NI
        if _gt(cfo_now, _safe(i_now, "netIncome")):
            score += 1
        # 5. LT debt / assets decreased
        ltd_now = _safe(b_now, "longTermDebt")
        ltd_prev = _safe(b_prev, "longTermDebt")
        lev_now = ltd_now / ta_now if ta_now else float("nan")
        lev_prev = ltd_prev / ta_prev if ta_prev else float("nan")
        if _lt(lev_now, lev_prev):
            score += 1
        # 6. Current ratio improved
        cr_now = _ratio(_safe(b_now, "totalCurrentAssets"),
                        _safe(b_now, "totalCurrentLiabilities"))
        cr_prev = _ratio(_safe(b_prev, "totalCurrentAssets"),
                         _safe(b_prev, "totalCurrentLiabilities"))
        if _gt(cr_now, cr_prev):
            score += 1
        # 7. No net share issuance
        sh_now = _safe(i_now, "weightedAverageShsOut", "weightedAverageShsOutDil")
        sh_prev = _safe(i_prev, "weightedAverageShsOut", "weightedAverageShsOutDil")
        if sh_now and sh_prev and sh_now <= sh_prev:
            score += 1
        # 8. Gross margin improved
        rev_now = _safe(i_now, "revenue")
        rev_prev = _safe(i_prev, "revenue")
        gm_now = _safe(i_now, "grossProfit") / rev_now if rev_now else float("nan")
        gm_prev = _safe(i_prev, "grossProfit") / rev_prev if rev_prev else float("nan")
        if _gt(gm_now, gm_prev):
            score += 1
        # 9. Asset turnover improved
        at_now = rev_now / ta_now if ta_now else float("nan")
        at_prev = rev_prev / ta_prev if ta_prev else float("nan")
        if _gt(at_now, at_prev):
            score += 1

        return int(score)


# --- helpers ---------------------------------------------------------------
def _to_date(s: Any) -> date | None:
    if s is None:
        return None
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    try:
        return datetime.fromisoformat(str(s)[:10]).date()
    except (TypeError, ValueError):
        return None


def _safe(row: pd.Series, *keys: str) -> float:
    for k in keys:
        v = row.get(k)
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return 0.0


def _ratio(n: float, d: float) -> float:
    if d == 0 or d is None or (isinstance(d, float) and math.isnan(d)):
        return float("nan")
    return n / d


def _gt(a: float, b: float) -> bool:
    return (a is not None and b is not None
            and not math.isnan(a) and not math.isnan(b)
            and a > b)


def _lt(a: float, b: float) -> bool:
    return (a is not None and b is not None
            and not math.isnan(a) and not math.isnan(b)
            and a < b)
