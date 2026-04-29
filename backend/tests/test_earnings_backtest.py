from services.earnings_backtest import run_event_backtest, simulate_event_trade


def test_simulate_iron_condor_wins_when_realized_move_stays_inside_expected():
    trade = simulate_event_trade({
        "symbol": "NVDA",
        "report_date": "2026-04-23",
        "top_setup": "iron condor",
        "expected_move_pct": 0.07,
        "realized_move_pct": 0.03,
        "premium_yield_call_atm": 0.035,
        "premium_yield_put_atm": 0.034,
        "edge_score": 83.4,
    })
    assert trade.win is True
    assert trade.return_pct > 0
    assert trade.reason == "realized move stayed inside expected move"


def test_simulate_long_straddle_loses_when_move_does_not_cover_debit():
    trade = simulate_event_trade({
        "symbol": "TSLA",
        "report_date": "2026-04-24",
        "setup": "long straddle",
        "expected_move_pct": 0.09,
        "realized_move_pct": 0.04,
        "premium_yield_call_atm": 0.031,
        "premium_yield_put_atm": 0.032,
        "edge_score": 61.2,
    })
    assert trade.win is False
    assert trade.return_pct < 0


def test_simulate_bull_call_spread_wins_when_rally_clears_debit():
    trade = simulate_event_trade({
        "symbol": "AAPL",
        "report_date": "2026-04-24",
        "setup": "bull call spread",
        "expected_move_pct": 0.05,
        "realized_move_pct": 0.06,
        "premium_yield_call_atm": 0.035,
    })

    assert trade.win is True
    assert trade.return_pct > 0
    assert trade.reason == "post-report rally cleared debit hurdle"


def test_simulate_bear_put_spread_wins_when_selloff_clears_debit():
    trade = simulate_event_trade({
        "symbol": "MSFT",
        "report_date": "2026-04-24",
        "setup": "bear put spread",
        "expected_move_pct": 0.05,
        "realized_move_pct": -0.055,
        "premium_yield_put_atm": 0.032,
    })

    assert trade.win is True
    assert trade.return_pct > 0
    assert trade.reason == "post-report selloff cleared debit hurdle"


def test_simulate_long_call_wins_when_rally_clears_debit():
    trade = simulate_event_trade({
        "symbol": "NVDA",
        "report_date": "2026-04-24",
        "setup": "long call",
        "expected_move_pct": 0.05,
        "realized_move_pct": 0.08,
        "premium_yield_call_atm": 0.030,
    })

    assert trade.win is True
    assert trade.return_pct > 0
    assert trade.reason == "post-report rally cleared debit hurdle"


def test_simulate_long_put_loses_when_selloff_does_not_cover_debit():
    trade = simulate_event_trade({
        "symbol": "META",
        "report_date": "2026-04-24",
        "setup": "long put",
        "expected_move_pct": 0.05,
        "realized_move_pct": -0.02,
        "premium_yield_put_atm": 0.040,
    })

    assert trade.win is False
    assert trade.return_pct < 0
    assert trade.reason == "post-report selloff did not clear debit hurdle"


def test_run_event_backtest_filters_by_edge_and_reports_metrics():
    result = run_event_backtest(
        [
            {
                "symbol": "NVDA",
                "report_date": "2026-04-23",
                "top_setup": "iron condor",
                "expected_move_pct": 0.07,
                "realized_move_pct": 0.03,
                "premium_yield_call_atm": 0.035,
                "premium_yield_put_atm": 0.034,
                "edge_score": 83.4,
            },
            {
                "symbol": "META",
                "report_date": "2026-04-24",
                "top_setup": "bull put spread",
                "expected_move_pct": 0.06,
                "realized_move_pct": -0.12,
                "premium_yield_put_atm": 0.026,
                "edge_score": 77.0,
            },
            {
                "symbol": "LOWEDGE",
                "report_date": "2026-04-25",
                "top_setup": "iron condor",
                "expected_move_pct": 0.06,
                "realized_move_pct": 0.01,
                "premium_yield_call_atm": 0.02,
                "premium_yield_put_atm": 0.02,
                "edge_score": 20.0,
            },
        ],
        min_edge_score=70,
        risk_fraction=0.02,
    )
    assert result["metrics"]["events"] == 2
    assert result["metrics"]["win_rate"] == 0.5
    assert result["metrics"]["max_drawdown_pct"] >= 0
    assert [t["symbol"] for t in result["trades"]] == ["NVDA", "META"]


def test_run_event_backtest_records_skipped_rows():
    result = run_event_backtest([
        {
            "symbol": "BAD",
            "report_date": "2026-04-23",
            "top_setup": "short strangle",
            "expected_move_pct": 0.07,
            "realized_move_pct": 0.03,
        },
    ])
    assert result["metrics"]["events"] == 0
    assert result["skipped"][0]["reason"].startswith("unsupported earnings setup")
