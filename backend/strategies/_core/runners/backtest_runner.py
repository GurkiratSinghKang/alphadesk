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
from strategies._core.providers import (
    BarProvider,
    EarningsProvider,
    FundamentalsProvider,
    OptionsChainProvider,
)
from strategies._core.reproducibility import get_git_sha
from strategies._core.snapshots import SnapshotWriter


def _await_sync(value: Any) -> Any:
    """Resolve awaitables for the synchronous backtest runner.

    Backtests are intentionally sync so they can run in research scripts and
    CLI flows. Async option providers are fine from that context, but an
    already-running event loop would deadlock, so fail loudly instead of
    silently dropping the option-chain input.
    """
    if not hasattr(value, "__await__"):
        return value
    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(value)
    raise RuntimeError(
        "BacktestRunner cannot resolve async providers inside an active event loop"
    )


class BacktestRunner:
    def __init__(
        self,
        strategy: Strategy,
        config: BacktestConfig,
        bar_provider: BarProvider,
        earnings_provider: EarningsProvider | None = None,
        fundamentals_provider: FundamentalsProvider | None = None,
        options_provider: OptionsChainProvider | None = None,
    ):
        self._strategy = strategy
        self._config = config
        self._bars = bar_provider
        self._earnings = earnings_provider
        self._fundamentals = fundamentals_provider
        self._options = options_provider
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
            bars_window = self._fetch_bars(
                symbols, asof, self._strategy.META.lookback_days, "1D"
            )
            intraday_bars: dict[str, pd.DataFrame] = {}
            for timeframe in tuple(getattr(self._strategy.META, "required_bars", ("daily",))):
                if timeframe == "daily":
                    continue
                intraday_bars[timeframe] = self._fetch_bars(
                    symbols, asof, self._strategy.META.lookback_days, timeframe
                )
            earnings_window = (
                self._earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
                if self._earnings else None
            )
            fundamentals_snap = (
                self._fundamentals.snapshot(symbols, asof) if self._fundamentals else None
            )
            options_chains: dict[str, pd.DataFrame] = {}
            if (
                getattr(self._strategy.META, "category", None) == "options"
                and self._options is not None
                and symbols
            ):
                options_chains = dict(
                    _await_sync(self._options.fetch_chains(symbols, asof))
                )

            # 3. Build frozen input with a deterministically-forked RNG
            bar_seed_seq = seed_seq.spawn(1)[0]
            bar_input = StrategyInput(
                asof=asof, mode="backtest",
                bars=bars_window, intraday_bars=intraday_bars,
                earnings=earnings_window, fundamentals=fundamentals_snap,
                options_chains=options_chains,
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
                sized_signals = self._size_signals(
                    result.signals, next_bars, bars_window, asof,
                )
                fills = self._executor.fill(sized_signals, next_bars, next_asof)
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
        bars = self._fetch_bars(symbols, asof, lookback_days=1, timeframe="1D")
        result: dict[str, pd.Series] = {}
        for sym in symbols:
            try:
                row = bars.xs((asof, sym))
                result[sym] = row
            except KeyError:
                continue
        return result

    def _fetch_bars(
        self,
        symbols: list[str],
        asof: date,
        lookback_days: int,
        timeframe: str,
    ) -> pd.DataFrame:
        """Call old or new BarProvider shims with a timeframe.

        Backtest fixtures and a few local providers still implement the
        pre-intraday ``fetch_window(symbols, asof, lookback_days)`` shape.
        Preserve that for daily bars, but require the richer signature for
        intraday requests so missing provider support fails visibly.
        """
        try:
            return self._bars.fetch_window(
                symbols, asof, lookback_days, timeframe=timeframe
            )
        except TypeError:
            if timeframe == "1D":
                return self._bars.fetch_window(symbols, asof, lookback_days)
            raise

    def _size_signals(
        self,
        signals,
        next_bars: dict[str, pd.Series],
        bars_window: pd.DataFrame,
        asof: date,
    ):
        """Translate ``target_weight`` signals into sized ``quantity`` signals.

        Mirrors the legacy engine's ``_queue_signal`` sizing rule:
            target_qty = floor(equity * weight / price)
            delta = target_qty - current_qty
        so emitted signals carry the signed delta as ``quantity`` while
        preserving their other fields (symbol, order_type, tag, ...). Signals
        that already carry ``quantity`` pass through unchanged.
        """
        from strategies._core.contracts import Signal  # local import to avoid cycles

        sized = []
        # Current holdings by symbol for the delta computation.
        current_qty: dict[str, int] = {}
        for p in self._portfolio.positions_snapshot():
            current_qty[p.symbol] = p.quantity

        # Mark-to-market price lookup for weight→share translation.
        mark_prices: dict[str, Decimal] = {}
        try:
            today = bars_window.xs(asof, level="date")
        except KeyError:
            today = pd.DataFrame()
        if not today.empty:
            for sym, row in today.iterrows():
                try:
                    mark_prices[sym] = Decimal(str(row["close"]))
                except Exception:
                    continue

        equity = self._portfolio.cash
        for p in self._portfolio.positions_snapshot():
            price = mark_prices.get(p.symbol, p.avg_entry_price)
            equity += price * Decimal(p.quantity)

        # Round-27 / persona-B P0: leverage cap. Pre-fix a strategy
        # emitting target_weight=2.0 (200% gross) would size accordingly,
        # cash would simply go negative without any RuntimeError, no
        # borrow cost, no haircut, no buying-power check. This is the
        # single biggest source of unrealistic backtest equity curves.
        # Cap gross weight at 100% by default (no leverage); emit a
        # single warning per asof when the strategy tries to exceed it.
        MAX_GROSS_LEVERAGE = Decimal("1.0")
        gross_weight = Decimal("0")
        target_weights: list[tuple[int, Decimal]] = []
        for i, s in enumerate(signals):
            if s.target_weight is not None:
                gross_weight += abs(Decimal(str(s.target_weight)))
                target_weights.append((i, abs(Decimal(str(s.target_weight)))))
        scale = Decimal("1.0")
        if gross_weight > MAX_GROSS_LEVERAGE:
            scale = MAX_GROSS_LEVERAGE / gross_weight
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "backtest leverage cap engaged: gross %.2f > %.2f cap; "
                "scaling weights by %.4f. Implement margin + overnight-"
                "funding logic before raising MAX_GROSS_LEVERAGE.",
                float(gross_weight), float(MAX_GROSS_LEVERAGE), float(scale),
            )

        for s in signals:
            if s.quantity is not None:
                sized.append(s)
                continue
            if s.target_weight is None:
                continue

            # Use next-bar open as the sizing reference when available — matches
            # MOO order semantics; fall back to today's close otherwise.
            nb = next_bars.get(s.symbol)
            price: Decimal | None = None
            if nb is not None:
                try:
                    price = Decimal(str(nb.get("open", nb.get("close"))))
                except Exception:
                    price = None
            if price is None or price <= 0:
                price = mark_prices.get(s.symbol)
            if price is None or price <= 0:
                continue

            scaled_weight = Decimal(str(s.target_weight)) * scale
            target_value = scaled_weight * equity
            target_qty = int((target_value / price).to_integral_value(rounding="ROUND_DOWN"))
            delta = target_qty - current_qty.get(s.symbol, 0)
            if delta == 0:
                continue

            sized.append(s.model_copy(update={"target_weight": None, "quantity": delta}))

        return sized

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

        # Round-6 / I-11: ``run_at`` is wall-clock, intrinsically
        # non-deterministic. It used to live on ``ReproMeta`` and made
        # the repro hash differ across replays with otherwise identical
        # inputs. Moved to ``BacktestResult.audit_metadata`` so it stays
        # available for the audit trail without contaminating the
        # determinism boundary.
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
                strategy_name=self._strategy.META.name,
                runner_version=RUNNER_VERSION,
                # Round-11 / AA-1.10 — stamp the strategy's paper_only
                # flag on every backtest result so a downstream replay
                # / promotion-check can refuse to deploy a paper-only
                # strategy as live without an explicit override.
                paper_only=getattr(self._strategy.META, "paper_only", False),
            ),
            audit_metadata={
                "run_at": datetime.now(timezone.utc).isoformat(),
            },
            warnings_by_asof={d: r.warnings for d, r in per_bar_results if r.warnings},
        )

    @staticmethod
    def _drawdown(equity: pd.Series) -> pd.Series:
        cummax = equity.cummax()
        return (equity - cummax) / cummax

    @staticmethod
    def _compute_metrics(equity_df: pd.DataFrame, daily_returns: pd.Series) -> dict[str, float]:
        # Round-27 / persona-B P1: drop the seed-bar NaN before stats so
        # ``pct_change()`` row-0 zero doesn't bias mean/std toward zero
        # and inflate Sharpe modestly on short backtests.
        clean_returns = daily_returns.dropna()
        if len(clean_returns) > 1:
            clean_returns = clean_returns.iloc[1:]
        mean, std = float(clean_returns.mean()), float(clean_returns.std())
        sharpe = (mean / std * (252 ** 0.5)) if std > 0 else 0.0
        total_ret = float(equity_df["equity"].iloc[-1] / equity_df["equity"].iloc[0] - 1) if len(equity_df) > 1 else 0.0
        days = max((equity_df.index[-1] - equity_df.index[0]).days, 1) if len(equity_df) > 1 else 1
        # Round-27 / persona-B P1: pre-fix a 1-day backtest with a 1% gain
        # extrapolated to (1.01 ** 365 - 1) = 3678% CAGR — meaningless
        # noise. Refuse to annualize when the window is too short to
        # support the claim; report ``cagr = nan`` instead so downstream
        # consumers can branch on it.
        if days < 30 or total_ret <= -1:
            cagr = float("nan")
        else:
            cagr = (1 + total_ret) ** (365 / days) - 1
        max_dd = float(equity_df["drawdown"].min()) if "drawdown" in equity_df else 0.0
        calmar = (cagr / abs(max_dd)) if (max_dd < 0 and not _isnan(cagr)) else 0.0
        return {
            "sharpe": sharpe, "cagr": cagr, "total_return": total_ret,
            "max_drawdown": max_dd, "calmar": calmar,
        }


def _isnan(x: float) -> bool:
    """Stdlib-free isnan check for the metrics aggregator."""
    return x != x
