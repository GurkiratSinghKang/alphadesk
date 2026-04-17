"""Event-driven backtest engine.

Bar-by-bar loop:

  for each trading session T in [start, end]:
      load bars for every member of the strategy's universe on T
      mark positions to T's close
      apply dividends (ex-date T) and splits (effective T)
      process strategy.manage() -> exit / adjust signals
      fill any staged orders eligible on T (MOO at T.open, intraday STOP/TP,
          MKT/MOC at T.close)
      ask strategy.generate_signals() and queue them for T+1
      charge borrow cost on open shorts
      snapshot equity, record trades

No look-ahead: signals emitted on T can only fill at T.close (MOC / MKT) or
at T+1.open (MOO) and afterwards. Strategies that need intraday context must
pick the order type that matches the rule.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from backend.backtest.costs import CostModel, DefaultCostModel
from backend.backtest.execution import ExecutionSimulator
from backend.backtest.metrics import summary_dict
from backend.backtest.portfolio import Portfolio
from backend.backtest.types import (
    AssetClass,
    BacktestResult,
    Bar,
    Context,
    Fill,
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)

# Resolve the real provider / strategy protocols if teams F2 / F4 have
# delivered them; otherwise fall back to the local stubs. Downstream code in
# this module only needs duck typing so the fallback is purely cosmetic.
try:  # pragma: no cover - import-time wiring
    from backend.data.providers.base import (
        BarProvider,
        OptionsProvider,
        EarningsProvider,
        FundamentalsProvider,
        CalendarProvider,
    )
except Exception:  # pragma: no cover
    from backend.backtest.types import (
        BarProvider,
        OptionsProvider,
        EarningsProvider,
        FundamentalsProvider,
        CalendarProvider,
    )

try:  # pragma: no cover - import-time wiring
    from backend.strategies.base import Strategy
except Exception:  # pragma: no cover
    from backend.backtest.types import Strategy  # type: ignore


def _d(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


@dataclass
class EngineConfig:
    start: date
    end: date
    starting_cash: Decimal = Decimal("100000")
    timeframe: str = "1D"
    benchmark: Optional[str] = None
    rf: float = 0.0
    seed: int = 42
    progress_cb: Optional[Any] = None  # callable(asof: date) -> None


class BacktestEngine:
    """Run a strategy against a bar provider between ``start`` and ``end``."""

    def __init__(
        self,
        strategy: Strategy,
        bar_provider: BarProvider,
        config: EngineConfig,
        *,
        options_provider: Optional[OptionsProvider] = None,
        earnings_provider: Optional[EarningsProvider] = None,
        fundamentals_provider: Optional[FundamentalsProvider] = None,
        calendar_provider: Optional[CalendarProvider] = None,
        cost_model: Optional[CostModel] = None,
        strategy_params: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.strategy = strategy
        self.bar_provider = bar_provider
        self.options_provider = options_provider
        self.earnings_provider = earnings_provider
        self.fundamentals_provider = fundamentals_provider
        self.calendar_provider = calendar_provider
        self.cost_model = cost_model or DefaultCostModel()
        self.config = config
        self.strategy_params = dict(strategy_params or {})

        self.portfolio = Portfolio(starting_cash=config.starting_cash)
        self.portfolio.borrow_rate = self.cost_model.borrow_rate(
            "__default__"
        )
        self.executor = ExecutionSimulator(self.cost_model)

        # Deterministic RNG for any strategy that asks for one via Context.
        self._rng = np.random.default_rng(config.seed)

        # Configure the strategy with its params.
        try:
            self.strategy.configure(self.strategy_params)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def run(self) -> BacktestResult:
        cfg = self.config
        sessions = self._resolve_sessions(cfg.start, cfg.end)

        # Pre-load the universe bars we expect to need. Lookback is best-effort
        # -- providers slice on demand.
        lookback = int(getattr(self.strategy, "required_lookback_days", 0) or 0)
        fetch_start = cfg.start - timedelta(days=max(lookback, 5))
        fetch_end = cfg.end

        # Build a per-session universe and fill in a (symbol, date) -> Bar
        # cache. We fetch the union of all symbols ever requested in one go
        # per strategy request for efficiency.
        symbol_seen: set[str] = set()

        ctx = self._build_context(cfg.start)

        # Records for the equity curve.
        equity_rows: list[dict[str, Any]] = []
        fills: list[Fill] = []
        daily_notional: dict[date, Decimal] = {}

        for idx, session in enumerate(sessions):
            ctx.asof = session

            # 1. Ask the strategy what its universe is today.
            try:
                universe_today = list(self.strategy.universe(session, ctx))
            except Exception:
                universe_today = []

            new_syms = [s for s in universe_today if s not in symbol_seen]
            for s in new_syms:
                symbol_seen.add(s)

            # 2. Pull bars for each symbol we care about today (universe +
            # open positions). For a daily backtest we fetch one row.
            active_syms = set(universe_today) | {
                p.symbol for p in self.portfolio.positions
                if p.asset_class is AssetClass.EQUITY
            }
            bars_by_symbol = self._bars_for_session(
                session, active_syms, fetch_start, fetch_end
            )

            # 3. Corporate actions: dividends + splits from the bars we just
            # loaded.
            dividends = {
                sym: bar.dividend
                for sym, bar in bars_by_symbol.items()
                if bar is not None and bar.dividend and bar.dividend != 0
            }
            splits = {
                sym: bar.split_ratio
                for sym, bar in bars_by_symbol.items()
                if bar is not None and bar.split_ratio and bar.split_ratio != 1
            }
            if splits:
                self.portfolio.apply_splits(splits)
            if dividends:
                self.portfolio.apply_dividends(dividends)

            # 4. Fill MOO orders using today's open first (they were staged
            # on bar T-1).
            session_fills: list[Fill] = []
            for sym, bar in bars_by_symbol.items():
                if bar is None:
                    continue
                filled = self.executor.fill_bar(bar)
                session_fills.extend(filled)

            for f in session_fills:
                self.portfolio.apply_fill(f)
                try:
                    self.strategy.on_fill(f, ctx)
                except Exception:
                    pass

            # 5. Mark-to-market mid-day so strategy.manage() sees up-to-date
            # P&L.
            mark_prices = {
                sym: bar.close
                for sym, bar in bars_by_symbol.items()
                if bar is not None
            }
            self.portfolio.mark_to_market(mark_prices)
            self._sync_ctx(ctx, session)

            # 6. Let the strategy manage existing positions (exits, trims).
            try:
                manage_signals: Iterable[Signal] = (
                    self.strategy.manage(session, ctx) or []
                )
            except Exception:
                manage_signals = []

            for s in manage_signals:
                self._queue_signal(s, session, bars_by_symbol, mark_prices)

            # 7. Fill orders that are eligible on today's close (MKT, MOC,
            # intraday STOP/TP that were staged before today).
            close_fills: list[Fill] = []
            for sym, bar in bars_by_symbol.items():
                if bar is None:
                    continue
                close_fills.extend(self.executor.fill_bar(bar))
            for f in close_fills:
                self.portfolio.apply_fill(f)
                try:
                    self.strategy.on_fill(f, ctx)
                except Exception:
                    pass

            session_fills.extend(close_fills)
            fills.extend(session_fills)

            # 8. Borrow cost accrual once per day.
            self.portfolio.accrue_borrow_cost(
                datetime.combine(session, datetime.min.time())
            )

            # 9. Ask the strategy for fresh signals (eligible T+1 MOO / same-bar
            # MOC depending on order_type).
            self.portfolio.mark_to_market(mark_prices)
            self._sync_ctx(ctx, session)
            try:
                new_signals: Iterable[Signal] = (
                    self.strategy.generate_signals(session, ctx) or []
                )
            except Exception:
                new_signals = []

            for s in new_signals:
                self._queue_signal(s, session, bars_by_symbol, mark_prices)

            # 10. Fills queued with MOC order_type will be executed
            # immediately on today's close. Run the executor one more time.
            moc_fills: list[Fill] = []
            for sym, bar in bars_by_symbol.items():
                if bar is None:
                    continue
                moc_fills.extend(self.executor.fill_bar(bar))
            for f in moc_fills:
                self.portfolio.apply_fill(f)
                try:
                    self.strategy.on_fill(f, ctx)
                except Exception:
                    pass
            fills.extend(moc_fills)

            # 11. Record daily notional (for turnover) and equity snapshot.
            notional = sum(
                (Decimal(abs(f.quantity)) * f.price for f in session_fills + moc_fills),
                Decimal("0"),
            )
            daily_notional[session] = notional

            self.portfolio.mark_to_market(mark_prices)
            equity = self.portfolio.current_equity(mark_prices)
            positions_value = self.portfolio.positions_value(mark_prices)
            equity_rows.append(
                {
                    "date": session,
                    "cash": float(self.portfolio.cash),
                    "positions_value": float(positions_value),
                    "equity": float(equity),
                    "notional_traded": float(notional),
                }
            )

            if cfg.progress_cb is not None:
                try:
                    cfg.progress_cb(session)
                except Exception:
                    pass

        # Compile the result.
        eq_df = pd.DataFrame(equity_rows)
        if not eq_df.empty:
            eq_df["date"] = pd.to_datetime(eq_df["date"])
            eq_df = eq_df.set_index("date")
        returns = eq_df["equity"].pct_change().dropna() if not eq_df.empty else pd.Series(dtype=float)

        benchmark_returns = None
        if cfg.benchmark:
            benchmark_returns = self._load_benchmark(cfg.benchmark, sessions)

        trade_pnls = pd.Series(
            [float(t.pnl) for t in self.portfolio.trades if t.is_closed],
            dtype=float,
        )
        metrics = summary_dict(
            equity=eq_df["equity"] if not eq_df.empty else pd.Series([float(cfg.starting_cash)]),
            returns=returns,
            trade_pnls=trade_pnls,
            benchmark_returns=benchmark_returns,
            daily_notional=eq_df["notional_traded"] if not eq_df.empty else None,
            rf=cfg.rf,
        )

        return BacktestResult(
            equity_curve=eq_df,
            trades=list(self.portfolio.trades),
            fills=fills,
            daily_returns=returns,
            metrics=metrics,
            params=dict(self.strategy_params),
            start=cfg.start,
            end=cfg.end,
            strategy_name=getattr(self.strategy, "name", type(self.strategy).__name__),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve_sessions(self, start: date, end: date) -> list[date]:
        """Return the list of trading sessions between start and end.

        Calendars may return pandas.Timestamp/DatetimeIndex, datetime, or date.
        Normalise to plain ``datetime.date`` so downstream provider calls
        receive a consistent type.
        """

        def _to_date(d: Any) -> date:
            if isinstance(d, datetime):
                return d.date()
            if isinstance(d, date):
                return d
            return pd.Timestamp(d).date()

        if self.calendar_provider is not None and hasattr(
            self.calendar_provider, "sessions"
        ):
            try:
                raw = list(self.calendar_provider.sessions(start, end))
                if raw:
                    return [_to_date(d) for d in raw]
            except Exception:
                pass
        # Fallback: business-day calendar (Mon-Fri, no holidays).
        idx = pd.bdate_range(start=start, end=end)
        return [d.date() for d in idx]

    def _build_context(self, asof: date) -> Context:
        return Context(
            asof=asof,
            cash=self.portfolio.cash,
            equity=self.portfolio.current_equity(),
            positions=list(self.portfolio.positions),
            bar_provider=self.bar_provider,
            options_provider=self.options_provider,
            earnings_provider=self.earnings_provider,
            fundamentals_provider=self.fundamentals_provider,
            calendar_provider=self.calendar_provider,
            params=dict(self.strategy_params),
        )

    def _sync_ctx(self, ctx: Context, session: date) -> None:
        ctx.asof = session
        ctx.cash = self.portfolio.cash
        ctx.equity = self.portfolio.current_equity()
        ctx.positions = list(self.portfolio.positions)

    def _bars_for_session(
        self,
        session: date,
        symbols: Iterable[str],
        fetch_start: date,
        fetch_end: date,
    ) -> dict[str, Optional[Bar]]:
        """Fetch a single session's bar for each symbol via the provider."""

        out: dict[str, Optional[Bar]] = {}
        syms = list(symbols)
        if not syms:
            return out
        try:
            df = self.bar_provider.bars(
                syms, session, session, tf=self.config.timeframe
            )
        except Exception:
            df = None

        if df is None:
            for s in syms:
                out[s] = None
            return out

        df = pd.DataFrame(df)
        if df.empty:
            for s in syms:
                out[s] = None
            return out

        # Normalise column names / handle common shapes.
        cols = {c.lower(): c for c in df.columns}
        sym_col = cols.get("symbol") or cols.get("ticker")
        ts_col = (
            cols.get("timestamp") or cols.get("date") or cols.get("ts")
        )

        # Group to rows per symbol.
        for sym in syms:
            bar = None
            try:
                if sym_col is not None:
                    sub = df[df[sym_col] == sym]
                else:
                    # provider returned only one symbol's frame
                    sub = df if len(syms) == 1 else df
                if sub is None or sub.empty:
                    bar = None
                else:
                    row = sub.iloc[0]
                    ts = self._coerce_ts(row, ts_col, session)
                    bar = Bar(
                        symbol=sym,
                        ts=ts,
                        open=_d(row[cols.get("open", "open")]),
                        high=_d(row[cols.get("high", "high")]),
                        low=_d(row[cols.get("low", "low")]),
                        close=_d(row[cols.get("close", "close")]),
                        volume=int(row[cols["volume"]]) if "volume" in cols else 0,
                        adjusted_close=_d(row[cols["adjusted_close"]])
                        if "adjusted_close" in cols
                        else None,
                        split_ratio=_d(row[cols["split_ratio"]])
                        if "split_ratio" in cols
                        else Decimal("1"),
                        dividend=_d(row[cols["dividend"]])
                        if "dividend" in cols
                        else Decimal("0"),
                    )
            except Exception:
                bar = None
            out[sym] = bar
        return out

    @staticmethod
    def _coerce_ts(row, ts_col, fallback: date) -> datetime:
        if ts_col is not None:
            v = row[ts_col]
            if isinstance(v, datetime):
                return v
            if isinstance(v, date):
                return datetime.combine(v, datetime.min.time())
            try:
                return pd.Timestamp(v).to_pydatetime()
            except Exception:
                pass
        return datetime.combine(fallback, datetime.min.time())

    def _queue_signal(
        self,
        signal: Signal,
        session: date,
        bars_by_symbol: Mapping[str, Optional[Bar]],
        mark_prices: Mapping[str, Decimal],
    ) -> None:
        """Translate a strategy signal into a queued order."""

        bar = bars_by_symbol.get(signal.symbol)
        ts = bar.ts if bar is not None else datetime.combine(session, datetime.min.time())

        # Decide side + quantity from target_weight / quantity + current pos.
        pos = self.portfolio.get_position(signal.symbol)
        current_qty = pos.quantity if pos else 0

        # Options spreads: we do NOT try to size by weight -- the signal must
        # carry a quantity (number of spreads).
        if signal.legs:
            qty = int(signal.quantity or 0)
            if qty == 0:
                return
            side = Side.BUY if qty > 0 else Side.SELL
            self.executor.queue(
                signal=signal,
                staged_on=ts,
                side=side,
                quantity=abs(qty),
            )
            return

        # Equity: resolve target share count.
        target_qty: int
        if signal.quantity is not None:
            target_qty = int(signal.quantity)
        elif signal.target_weight is not None:
            # Compute shares such that position value ≈ equity * weight.
            equity = self.portfolio.current_equity(mark_prices)
            price = mark_prices.get(signal.symbol)
            if price is None or price <= 0:
                return
            target_value = Decimal(str(signal.target_weight)) * equity
            target_qty = int((target_value / price).to_integral_value(rounding="ROUND_DOWN"))
        else:
            return

        delta = target_qty - current_qty
        if delta == 0:
            return
        side = Side.BUY if delta > 0 else Side.SELL
        self.executor.queue(
            signal=signal,
            staged_on=ts,
            side=side,
            quantity=abs(delta),
        )

    def _load_benchmark(self, symbol: str, sessions: list[date]) -> Optional[pd.Series]:
        try:
            df = self.bar_provider.bars(
                [symbol], sessions[0], sessions[-1], tf=self.config.timeframe
            )
        except Exception:
            return None
        if df is None or df.empty:
            return None
        df = pd.DataFrame(df)
        cols = {c.lower(): c for c in df.columns}
        close = cols.get("close")
        if close is None:
            return None
        ts_col = cols.get("timestamp") or cols.get("date")
        if ts_col is None:
            return None
        try:
            series = pd.Series(
                df[close].astype(float).values,
                index=pd.to_datetime(df[ts_col]),
            )
            return series.pct_change().dropna()
        except Exception:
            return None


__all__ = ["BacktestEngine", "EngineConfig"]
