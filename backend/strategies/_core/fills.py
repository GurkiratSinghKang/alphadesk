# backend/strategies/_core/fills.py
"""Fill simulation + portfolio ledger for BacktestRunner.

Kept simple: fills at next-bar open (or close, or midpoint) with a
slippage_bps adjustment and a flat per-share commission. Matches the
behavior of the legacy engine.py within the tolerance specified in the
spec's parity-test acceptance criteria.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import pandas as pd

from strategies._core.contracts import (
    BacktestConfig,
    Fill,
    Position,
    Signal,
    Trade,
)


class FillSimulator:
    """Converts Signals into Fills using a configurable fill model + slippage.

    The caller (BacktestRunner) is responsible for supplying the "next bar"
    data for each signal's symbol; the simulator picks the reference price
    from that bar per config.fill_model.
    """

    def __init__(self, config: BacktestConfig):
        self._config = config

    def fill(
        self,
        signals: Iterable[Signal],
        next_bars: dict[str, pd.Series],
        asof: date,
    ) -> list[Fill]:
        """Convert signals to fills. ``next_bars`` maps symbol → next bar's OHLCV row.

        Round-11 / AA-1.2 (P0): the previous version filled every
        signal at ``self._reference_price(bar)`` regardless of
        ``signal.order_type`` / ``signal.limit_price`` — a LMT buy at
        $50 on a gap-up to $55 still "filled" at $55 in the
        backtest, systematically inflating event-day strategy
        backtests. Now branches on ``order_type``:

        * MOO  — fill at next bar's open
        * MOC  — fill at next bar's close
        * MKT  — fill at the configured ``fill_model`` reference
        * LMT  — fill only if the bar's range crosses ``limit_price``;
                 fills at the limit (best-case under no-touch
                 assumption); slippage still applied as a small
                 adverse step inside the limit.
        * STP  — fill if the bar's range crosses ``stop_price``;
                 entry at the stop (also conservative).
        * STP_LMT — combined: stop must trigger AND limit must clear.

        Where a limit can't fill, the signal silently drops for this
        bar — no Fill is emitted and the strategy's intent expires
        (matching the typical real-broker behaviour for a DAY-TIF
        order that didn't print).
        """
        from strategies._core.contracts import OrderType

        fills: list[Fill] = []
        for s in signals:
            if s.quantity is None:
                # target_weight path: caller should have translated; skip here
                continue

            # Plan B.1 (short): multi-leg options pricing path.
            # Signals with non-empty `legs` are option spreads (vrp-harvest,
            # earnings-vol, etc.) whose net premium must be priced from the
            # per-contract bars, not the underlying's bar. The new fill shell
            # doesn't yet implement that pricing; if an options_provider is
            # wired via BacktestConfig.options_provider, dispatch to the
            # legacy path. Otherwise log+skip with a clear warning so the
            # gap is explicit instead of silently producing nothing.
            if s.legs:
                multileg_fill = self._fill_multileg(s, asof)
                if multileg_fill is not None:
                    fills.append(multileg_fill)
                continue

            bar = next_bars.get(s.symbol)
            if bar is None:
                continue  # no fill — symbol not in next-bar universe

            ref_price = self._reference_price_for(s, bar)
            if ref_price is None:
                # Limit / stop did not clear on this bar; signal expires.
                continue

            slip = ref_price * Decimal(str(self._config.slippage_bps / 10_000))
            # Buy side slips up, sell side slips down (adverse selection).
            # On LMT/STP_LMT we still apply slippage but cap it so the
            # final fill price never exceeds the user's limit on buys
            # (or undercuts it on sells). That's the worst-case fill
            # under "marketable limit" semantics — the limit order
            # acted as a price ceiling, not just a trigger.
            fill_price = ref_price + slip if s.quantity > 0 else ref_price - slip
            if s.order_type in {OrderType.LMT, OrderType.STP_LMT} and s.limit_price is not None:
                limit = Decimal(str(s.limit_price))
                if s.quantity > 0 and fill_price > limit:
                    fill_price = limit
                elif s.quantity < 0 and fill_price < limit:
                    fill_price = limit

            commission = Decimal(abs(s.quantity)) * self._config.commission_per_share

            fills.append(Fill(
                symbol=s.symbol, asof=asof, quantity=s.quantity,
                price=fill_price.quantize(Decimal("0.01")),
                commission=commission.quantize(Decimal("0.01")),
                signal_tag=s.tag,
            ))
        return fills

    def _reference_price_for(self, s: Signal, bar: pd.Series) -> Decimal | None:
        """Pick the reference fill price for a signal given the next bar.

        Returns ``None`` when an order_type / limit / stop combination
        doesn't trigger on this bar (so the caller skips emitting a
        Fill). Round-11 / AA-1.2.
        """
        from strategies._core.contracts import OrderType

        bar_open = Decimal(str(bar["open"]))
        bar_high = Decimal(str(bar["high"]))
        bar_low = Decimal(str(bar["low"]))
        bar_close = Decimal(str(bar["close"]))

        if s.order_type == OrderType.MOO:
            return bar_open
        if s.order_type == OrderType.MOC:
            return bar_close
        if s.order_type == OrderType.MKT:
            return self._reference_price(bar)

        # Limit-bearing types: check the bar's intraday range.
        if s.order_type in {OrderType.LMT, OrderType.STP, OrderType.STP_LMT}:
            limit = Decimal(str(s.limit_price)) if s.limit_price is not None else None
            stop = Decimal(str(s.stop_price)) if s.stop_price is not None else None

            if s.order_type == OrderType.LMT:
                if limit is None:
                    return None
                # Buy LMT triggers when bar dips at/below limit.
                # Sell LMT triggers when bar rallies at/above limit.
                if s.quantity > 0 and bar_low <= limit:
                    return min(bar_open, limit) if bar_open <= limit else limit
                if s.quantity < 0 and bar_high >= limit:
                    return max(bar_open, limit) if bar_open >= limit else limit
                return None

            if s.order_type == OrderType.STP:
                if stop is None:
                    return None
                if s.quantity > 0 and bar_high >= stop:
                    return max(bar_open, stop) if bar_open >= stop else stop
                if s.quantity < 0 and bar_low <= stop:
                    return min(bar_open, stop) if bar_open <= stop else stop
                return None

            # STP_LMT — stop must trigger AND limit must clear.
            if stop is None or limit is None:
                return None
            if s.quantity > 0:
                if bar_high < stop:
                    return None  # stop never triggered
                # Within the bar after stop trigger, fill at min(post-trigger, limit)
                trigger_price = max(bar_open, stop) if bar_open >= stop else stop
                if trigger_price > limit:
                    return None
                return trigger_price
            else:
                if bar_low > stop:
                    return None
                trigger_price = min(bar_open, stop) if bar_open <= stop else stop
                if trigger_price < limit:
                    return None
                return trigger_price

        # Fallback: configured fill_model for unknown order types.
        return self._reference_price(bar)

    def _reference_price(self, bar: pd.Series) -> Decimal:
        if self._config.fill_model == "next_open":
            return Decimal(str(bar["open"]))
        if self._config.fill_model == "next_close":
            return Decimal(str(bar["close"]))
        # midpoint
        return (Decimal(str(bar["high"])) + Decimal(str(bar["low"]))) / Decimal("2")

    # ── Plan B.1: multi-leg options dispatch ────────────────────────────
    _multileg_warned: bool = False  # class-level, log warning once per process

    def _fill_multileg(self, signal: "Signal", asof: date) -> "Fill | None":
        """Multi-leg (spread) options pricing.

        Plan B.1 (full port): tries the **native** in-shell pricer first
        (no legacy import). Per-leg pricing pulls the options_provider's
        contract bar at ``asof``, applies half-spread slippage from
        ``BacktestConfig.slippage_bps``, computes the net per-spread
        premium with the canonical sign convention, and returns a
        new-shell Fill. The legacy path remains as a defensive fallback
        for edge cases the native pricer can't yet handle (e.g.
        non-OCC contract symbols).

        Returns None when:
        - ``BacktestConfig.options_provider`` is unset (logs + skips once)
        - The options provider returns no bar for any leg at ``asof``
        - A limit_price is set and the net premium fails the gate
        """
        import logging
        log = logging.getLogger("alphadesk.strategies._core.fills")

        if self._config.options_provider is None:
            if not FillSimulator._multileg_warned:
                FillSimulator._multileg_warned = True
                log.warning(
                    "FillSimulator: encountered multi-leg signal for %s but no "
                    "options_provider is wired via BacktestConfig.options_provider. "
                    "Multi-leg signal SKIPPED (no Fill emitted). Wire an "
                    "OptionsProvider to enable real per-contract premium pricing.",
                    signal.symbol,
                )
            return None

        # 1. Native path (Plan B.1 full port).
        try:
            native = self._fill_multileg_native(signal, asof)
            if native is not None:
                return native
            # native returned None — could be no leg price (don't fall back to
            # legacy in that case; legacy would also fail), or limit-rejected.
            # In either case we honour the native decision.
            return None
        except Exception as exc:
            log.warning(
                "FillSimulator native multi-leg path raised %s for %s; "
                "falling back to legacy delegator.", exc, signal.symbol,
            )

        # 2. Legacy fallback (Plan B.1 short — preserved for safety).
        try:
            from backtest.execution import ExecutionSimulator, PendingOrder
            from backtest.costs import DefaultCostModel
        except Exception as exc:  # pragma: no cover
            log.warning(
                "FillSimulator: legacy backtest.execution import failed (%s); "
                "multi-leg signal skipped.", exc,
            )
            return None

        cost = DefaultCostModel(default_spread_pct=Decimal("0"))
        sim = ExecutionSimulator(
            cost,
            default_spread_pct=Decimal(str(self._config.slippage_bps / 10_000)),
            options_provider=self._config.options_provider,
        )
        try:
            order = PendingOrder(
                signal=signal,
                symbol=signal.symbol,
                quantity=signal.quantity or 0,
                order_type=signal.order_type,
                limit_price=signal.limit_price,
                stop_price=signal.stop_price,
                legs=signal.legs,
                tag=signal.tag,
            )
            legacy_fill = sim._fill_multileg_option(order, bar=None)
        except Exception as exc:
            log.warning(
                "FillSimulator: legacy multi-leg dispatch raised %s for %s; "
                "skipping signal.", exc, signal.symbol,
            )
            return None

        if legacy_fill is None:
            return None

        return Fill(
            symbol=legacy_fill.symbol,
            asof=asof,
            quantity=legacy_fill.quantity,
            price=legacy_fill.price,
            commission=getattr(legacy_fill, "commission", Decimal("0")),
            signal_tag=signal.tag,
        )

    # -- Plan B.1 (full): native in-shell multi-leg pricer ----------------

    def _fill_multileg_native(self, signal: "Signal", asof: date) -> "Fill | None":
        """Native (in-shell) multi-leg fill pricer — no legacy import.

        For each leg in ``signal.legs``:
          1. Query ``options_provider.contract_bars(occ_symbol, asof, asof, "1D")``
             — pull the contract's daily bar at the fill date
          2. Use ``close`` as the leg's mid price
          3. Apply half-spread slippage: BUY → +half_spread, SELL → -half_spread
             where half_spread = mid × (slippage_bps / 2 / 10_000)

        Net per-spread premium = |Σ over legs of sign × leg_px × leg.quantity|
        where sign is + for SELL legs (credit), − for BUY legs (debit). The
        absolute value is the Fill.price; the *direction* (credit/debit) is
        encoded in signal.quantity sign (positive=long-the-spread,
        negative=short-the-spread).

        Returns None when:
        - any leg lacks a contract bar at asof (defensive: no synthetic price)
        - signal.limit_price is set and the net premium fails the gate
        """
        from strategies._core.contracts import Fill

        provider = self._config.options_provider
        if provider is None or not signal.legs:
            return None

        slippage_pct = Decimal(str(self._config.slippage_bps / 10_000))
        half_spread_pct = slippage_pct / Decimal("2")

        per_leg_prices: list[Decimal] = []
        net_signed = Decimal("0")

        for leg in signal.legs:
            mid = self._native_leg_mid(provider, leg.occ_symbol, asof)
            if mid is None:
                # No price available — abort the whole spread fill rather
                # than partially fill (legacy behaviour preserved).
                return None

            half_spread = mid * half_spread_pct
            if leg.side == "buy":
                leg_px = mid + half_spread  # pay the ask
                # Sign convention: BUY legs are debit (negative cashflow);
                # net_signed accumulates as -px*qty so the absolute value
                # is the |net premium|.
                net_signed -= leg_px * Decimal(leg.quantity)
            else:  # sell
                leg_px = mid - half_spread  # receive the bid
                net_signed += leg_px * Decimal(leg.quantity)

            # Floor at 0.01 (matches legacy): tiny mids with fat spreads
            # can collapse below zero, which isn't a fillable price.
            if leg_px <= 0:
                leg_px = Decimal("0.01")
            per_leg_prices.append(leg_px)

        net_per_spread = abs(net_signed)

        # Limit-price gate (BUY = pay no more than limit; SELL = receive no
        # less). Absolute comparison is correct because direction is in
        # signal.quantity sign.
        if signal.limit_price is not None:
            limit = Decimal(str(signal.limit_price))
            qty = signal.quantity or 0
            if qty > 0 and net_per_spread > limit:
                return None  # debit too high
            if qty < 0 and net_per_spread < limit:
                return None  # credit too low

        # Commission: matches the single-leg path's per-share model, but
        # billed per leg × spread.quantity. Standard options multiplier 100
        # is implicit in how strategies compute target weights, not in the
        # commission model — so per-leg commission_per_share applies as-is.
        n_legs = len(signal.legs)
        commission = (
            Decimal(abs(signal.quantity or 0))
            * Decimal(n_legs)
            * self._config.commission_per_share
        )

        return Fill(
            symbol=signal.symbol,
            asof=asof,
            quantity=signal.quantity or 0,
            price=net_per_spread.quantize(Decimal("0.01")),
            commission=commission.quantize(Decimal("0.01")),
            signal_tag=signal.tag,
        )

    @staticmethod
    def _native_leg_mid(provider: Any, occ_symbol: str, asof: date) -> Decimal | None:
        """Fetch a single leg's mid price (close) from the options_provider.

        Returns ``None`` if the provider has no bar for the contract on
        ``asof``. Defensive: any exception from the provider also returns
        None so the dispatcher can fall back to the legacy path.
        """
        import logging
        log = logging.getLogger("alphadesk.strategies._core.fills")

        try:
            df = provider.contract_bars(occ_symbol, asof, asof, "1D")
        except Exception as exc:
            log.debug(
                "_native_leg_mid: contract_bars(%s, %s) raised %s",
                occ_symbol, asof, exc,
            )
            return None
        if df is None or getattr(df, "empty", True):
            return None
        if "close" not in df.columns:
            return None
        # Use the last bar's close (handles cases where provider returns
        # multiple rows in the asof window).
        last_close = df["close"].dropna()
        if last_close.empty:
            return None
        try:
            return Decimal(str(float(last_close.iloc[-1])))
        except (TypeError, ValueError):
            return None


class Portfolio:
    """Simple position ledger. Tracks cash, open positions, and closed trades.

    When a fill closes (or partially closes) an existing position, the
    realized PnL is booked into the corresponding Trade record. Opening
    fills add to the position's cumulative quantity with volume-weighted
    average entry price.
    """

    def __init__(self, starting_cash: Decimal):
        self._cash = starting_cash
        self._positions: dict[str, Position] = {}      # keyed by symbol
        self._trades: list[Trade] = []                 # closed round-trips
        self._open_trades: dict[str, Trade] = {}       # opening trade per symbol

    @property
    def cash(self) -> Decimal:
        return self._cash

    @property
    def equity(self) -> Decimal:
        # Simplification: BacktestRunner computes mark-to-market before each bar.
        # At portfolio level, equity = cash + sum(position.qty * avg_entry_price);
        # for MTM use mark_to_market(prices) instead.
        positions_value = sum(
            (p.quantity * p.avg_entry_price for p in self._positions.values()),
            start=Decimal("0"),
        )
        return self._cash + positions_value

    def positions_snapshot(self) -> list[Position]:
        return list(self._positions.values())

    def closed_trades(self) -> list[Trade]:
        return list(self._trades)

    def apply_fill(self, fill: object) -> None:
        # Round-11 / AA-1.12 (P3 defensive): a zero-quantity Fill (e.g.
        # a cancelled-order ack mistakenly arriving as a 0-fill) used
        # to take the same-side branch with ``new_qty == existing.quantity``,
        # which then rewrote the Position with the SAME qty but a new
        # ``avg_entry_price`` blended against price=0 — collapsing the
        # entry price to a fraction of the real one. Real brokers don't
        # emit zero-quantity fills, but defensive code should reject
        # them rather than silently corrupt the ledger.
        if fill.quantity == 0:
            return
        self._cash -= Decimal(fill.quantity) * fill.price + fill.commission

        existing = self._positions.get(fill.symbol)
        if existing is None or (existing.quantity > 0) == (fill.quantity > 0):
            # No existing position or same-side add
            new_qty = (existing.quantity if existing else 0) + fill.quantity
            if new_qty == 0:
                self._close_position(fill.symbol, fill)
                return
            # Volume-weighted average entry price
            old_notional = (existing.avg_entry_price * existing.quantity) if existing else Decimal("0")
            new_notional = fill.price * Decimal(fill.quantity)
            avg_price = (old_notional + new_notional) / Decimal(new_qty)
            signal_tag = getattr(fill, "signal_tag", "")
            self._positions[fill.symbol] = Position(
                symbol=fill.symbol, quantity=new_qty,
                avg_entry_price=avg_price,
                entry_date=existing.entry_date if existing else fill.asof,
                tag=existing.tag if existing else signal_tag,
            )
            if fill.symbol not in self._open_trades:
                self._open_trades[fill.symbol] = Trade(
                    symbol=fill.symbol, entry_date=fill.asof,
                    entry_price=fill.price, quantity=new_qty,
                    tag=signal_tag,
                )
        else:
            # Opposite-side: closes or flips position
            if abs(fill.quantity) >= abs(existing.quantity):
                # Closes (and possibly flips)
                self._close_position(fill.symbol, fill)
                remainder = fill.quantity + existing.quantity  # signed
                if remainder != 0:
                    # Flipped: open new position with the remainder
                    signal_tag = getattr(fill, "signal_tag", "")
                    self._positions[fill.symbol] = Position(
                        symbol=fill.symbol, quantity=remainder,
                        avg_entry_price=fill.price, entry_date=fill.asof,
                        tag=signal_tag,
                    )
                    self._open_trades[fill.symbol] = Trade(
                        symbol=fill.symbol, entry_date=fill.asof,
                        entry_price=fill.price, quantity=remainder,
                        tag=signal_tag,
                    )
            else:
                # Partial close
                new_qty = existing.quantity + fill.quantity  # signed, smaller magnitude
                self._positions[fill.symbol] = existing.model_copy(
                    update={"quantity": new_qty}
                )

    def _close_position(self, symbol: str, fill: object) -> None:
        existing = self._positions.pop(symbol, None)
        open_trade = self._open_trades.pop(symbol, None)
        if existing is None or open_trade is None:
            return
        pnl = (fill.price - existing.avg_entry_price) * Decimal(existing.quantity)
        self._trades.append(open_trade.model_copy(update={
            "exit_date": fill.asof,
            "exit_price": fill.price,
            "pnl": pnl,
        }))
