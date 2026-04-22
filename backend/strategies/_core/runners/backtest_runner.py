"""BacktestRunner — orchestrates bar-by-bar execution of a Strategy.

Owns: provider I/O, per-bar StrategyInput construction, seeded RNG
forking (for reproducibility), portfolio ledger, fill simulation,
result aggregation.

Does NOT: define alpha logic (that's in strategy.run()), perform any
live broker I/O (that's DailyPipelineRunner's job).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from strategies._core import RUNNER_VERSION
from strategies._core.contracts import (
    BacktestConfig,
    BacktestResult,
    ReproMeta,
    StrategyInput,
    StrategyParams,
    StrategyResult,
    Trade,
)
from strategies._core.fills import FillSimulator, Portfolio
from strategies._core.protocol import Strategy
from strategies._core.providers import BarProvider, EarningsProvider, FundamentalsProvider
from strategies._core.reproducibility import get_git_sha
from strategies._core.snapshots import SnapshotWriter


class BacktestRunner:
    def __init__(
        self,
        strategy: Strategy,
        config: BacktestConfig,
        bar_provider: BarProvider,
        earnings_provider: EarningsProvider | None = None,
        fundamentals_provider: FundamentalsProvider | None = None,
    ):
        self._strategy = strategy
        self._config = config
        self._bars = bar_provider
        self._earnings = earnings_provider
        self._fundamentals = fundamentals_provider
        self._executor = FillSimulator(config)
        self._portfolio = Portfolio(config.starting_cash)
        self._snapshotter = SnapshotWriter(config.snapshot_dir) if config.snapshot_dir else None

    def run(self, params: StrategyParams) -> BacktestResult:
        """Execute the full backtest. Deterministic given (strategy code, params, config, data)."""
        seed_seq = np.random.SeedSequence(self._config.seed)
        state: dict[str, Any] = {}
        per_bar_results: list[tuple[date, StrategyResult]] = []
        snapshot_ids: list[str] = []
        equity_rows: list[dict] = []

        trading_days = self._trading_days(self._config.start, self._config.end)
        for i, asof in enumerate(trading_days):
            # 1. Strategy declares universe
            symbols = self._strategy.universe(asof, state)
            if not symbols:
                equity_rows.append({
                    "date": asof, "cash": self._portfolio.cash,
                    "positions_value": Decimal("0"), "equity": self._portfolio.cash,
                })
                continue

            # 2. Pre-fetch data for the declared universe
            bars_window = self._bars.fetch_window(
                symbols, asof, self._strategy.META.lookback_days
            )
            earnings_window = (
                self._earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
                if self._earnings else None
            )
            fundamentals_snap = (
                self._fundamentals.snapshot(symbols, asof) if self._fundamentals else None
            )

            # 3. Build frozen input with a deterministically-forked RNG
            bar_seed_seq = seed_seq.spawn(1)[0]
            bar_input = StrategyInput(
                asof=asof, mode="backtest",
                bars=bars_window, earnings=earnings_window, fundamentals=fundamentals_snap,
                cash=self._portfolio.cash, equity=self._portfolio.equity,
                positions=self._portfolio.positions_snapshot(),
                state=dict(state),
                seed=int(bar_seed_seq.entropy),
                rng=np.random.default_rng(bar_seed_seq),
            )

            # 4. Optional snapshot
            if self._snapshotter:
                snapshot_ids.append(self._snapshotter.write(bar_input))

            # 5. Call the pure function
            result = self._strategy.run(bar_input, params)
            per_bar_results.append((asof, result))

            # 6. State merge (shallow)
            state = {**state, **result.state_update}

            # 7. Fill signals against next bar (if one exists)
            next_asof = trading_days[i + 1] if i + 1 < len(trading_days) else None
            if next_asof is not None and result.signals:
                next_bars = self._next_bars(symbols, next_asof)
                fills = self._executor.fill(result.signals, next_bars, next_asof)
                for fill in fills:
                    self._portfolio.apply_fill(fill)
                    state = {**state, **self._strategy.on_fill(fill, state)}

            # 8. Mark to market
            equity_rows.append(self._mark_to_market(asof, bars_window))

        # 9. Build result
        return self._build_result(
            per_bar_results=per_bar_results,
            equity_rows=equity_rows,
            snapshot_ids=snapshot_ids,
            params=params,
        )

    def _trading_days(self, start: date, end: date) -> list[date]:
        """Return list of trading days between start and end. Uses a simple
        Mon-Fri calendar for this reference implementation; real strategies
        will want a market calendar (pandas_market_calendars) — out of scope
        for Phase 1 (the old engine.py also used a naïve calendar)."""
        days = []
        d = start
        while d <= end:
            if d.weekday() < 5:  # Mon-Fri
                days.append(d)
            d += timedelta(days=1)
        return days

    def _next_bars(self, symbols: list[str], asof: date) -> dict[str, pd.Series]:
        bars = self._bars.fetch_window(symbols, asof, lookback_days=1)
        result: dict[str, pd.Series] = {}
        for sym in symbols:
            try:
                row = bars.xs((asof, sym))
                result[sym] = row
            except KeyError:
                continue
        return result

    def _mark_to_market(self, asof: date, bars_window: pd.DataFrame) -> dict:
        try:
            today = bars_window.xs(asof, level="date")
        except KeyError:
            today = pd.DataFrame()
        positions_value = Decimal("0")
        for p in self._portfolio.positions_snapshot():
            if p.symbol in today.index:
                positions_value += Decimal(str(today.loc[p.symbol, "close"])) * Decimal(p.quantity)
            else:
                positions_value += p.avg_entry_price * Decimal(p.quantity)
        return {
            "date": asof,
            "cash": self._portfolio.cash,
            "positions_value": positions_value,
            "equity": self._portfolio.cash + positions_value,
        }

    def _build_result(
        self,
        per_bar_results,
        equity_rows,
        snapshot_ids,
        params,
    ) -> BacktestResult:
        equity_df = pd.DataFrame(equity_rows).set_index("date")
        # Convert Decimal columns to float so pandas statistical functions work
        for col in ("cash", "positions_value", "equity"):
            if col in equity_df.columns:
                equity_df[col] = equity_df[col].astype(float)
        equity_df["drawdown"] = self._drawdown(equity_df["equity"])
        daily_returns = equity_df["equity"].pct_change().fillna(0)

        # Build reproducibility metadata
        import hashlib
        snapshot_root = (
            hashlib.sha256("".join(snapshot_ids).encode()).hexdigest()[:16]
            if snapshot_ids else ""
        )

        return BacktestResult(
            equity_curve=equity_df,
            daily_returns=daily_returns,
            trades=self._portfolio.closed_trades(),
            signals_emitted=[s for _, r in per_bar_results for s in r.signals],
            metrics=self._compute_metrics(equity_df, daily_returns),
            params=params.model_dump(mode="json"),
            start=self._config.start,
            end=self._config.end,
            repro=ReproMeta(
                git_sha=get_git_sha(),
                param_hash=type(params).param_hash(params),
                snapshot_root=snapshot_root,
                seed=self._config.seed,
                run_at=datetime.now(timezone.utc),
                strategy_name=self._strategy.META.name,
                runner_version=RUNNER_VERSION,
            ),
            warnings_by_asof={d: r.warnings for d, r in per_bar_results if r.warnings},
        )

    @staticmethod
    def _drawdown(equity: pd.Series) -> pd.Series:
        cummax = equity.cummax()
        return (equity - cummax) / cummax

    @staticmethod
    def _compute_metrics(equity_df: pd.DataFrame, daily_returns: pd.Series) -> dict[str, float]:
        mean, std = float(daily_returns.mean()), float(daily_returns.std())
        sharpe = (mean / std * (252 ** 0.5)) if std > 0 else 0.0
        total_ret = float(equity_df["equity"].iloc[-1] / equity_df["equity"].iloc[0] - 1) if len(equity_df) > 1 else 0.0
        days = max((equity_df.index[-1] - equity_df.index[0]).days, 1) if len(equity_df) > 1 else 1
        cagr = (1 + total_ret) ** (365 / days) - 1 if total_ret > -1 else -1.0
        max_dd = float(equity_df["drawdown"].min()) if "drawdown" in equity_df else 0.0
        calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0
        return {
            "sharpe": sharpe, "cagr": cagr, "total_return": total_ret,
            "max_drawdown": max_dd, "calmar": calmar,
        }
