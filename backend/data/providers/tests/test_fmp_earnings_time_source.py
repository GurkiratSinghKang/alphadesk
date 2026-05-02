from __future__ import annotations

from datetime import date

from core.config import settings
from data.providers.fmp_earnings import FMPEarningsProvider


class _FakeHTTP:
    def get(self, path, params=None):
        assert path == "/earnings-calendar"
        return [
            {
                "symbol": "AAPL",
                "date": "2024-04-30",
                "epsActual": 1.2,
                "epsEstimated": 1.0,
                "time": None,
            },
            {
                "symbol": "MSFT",
                "date": "2024-04-30",
                "epsActual": 2.2,
                "epsEstimated": 2.0,
                "time": "bmo",
            },
        ]

    def close(self):
        return None


def test_calendar_applies_csv_announcement_time_source(tmp_path):
    source = tmp_path / "announcement-times.csv"
    source.write_text(
        "symbol,date,announcement_when\n"
        "AAPL,2024-04-30,AMC\n"
        "MSFT,2024-04-30,AMC\n"
    )
    provider = FMPEarningsProvider(api_key="fake")
    provider._http = _FakeHTTP()

    df = provider._calendar_cached(
        "2024-04-30",
        "2024-04-30",
        str(source),
    )

    rows = {r.symbol: r.announcement_when for r in df.itertuples(index=False)}
    assert rows == {"AAPL": "amc", "MSFT": "amc"}


def test_public_calendar_uses_configured_announcement_time_source(tmp_path, monkeypatch):
    source = tmp_path / "announcement-times.csv"
    source.write_text("symbol,date,report_time\nAAPL,2024-04-30,BMO\n")
    monkeypatch.setattr(settings, "EARNINGS_TIME_SOURCE_PATH", str(source))
    provider = FMPEarningsProvider(api_key="fake")
    provider._http = _FakeHTTP()

    df = provider.calendar("2024-04-30", "2024-04-30", symbols=["AAPL"])

    assert df.iloc[0]["announcement_when"] == "bmo"


def test_calendar_applies_json_mapping_announcement_time_source(tmp_path):
    source = tmp_path / "announcement-times.json"
    source.write_text('{"AAPL|2024-04-30": "BMO"}')
    provider = FMPEarningsProvider(api_key="fake")
    provider._http = _FakeHTTP()

    df = provider._calendar_cached(
        "2024-04-30",
        "2024-04-30",
        str(source),
    )

    aapl = df[df["symbol"] == "AAPL"].iloc[0]
    assert aapl["date"] == date(2024, 4, 30)
    assert aapl["announcement_when"] == "bmo"
