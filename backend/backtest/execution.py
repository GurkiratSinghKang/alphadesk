"""Order-to-fill simulation.

The :class:`ExecutionSimulator` converts :class:`Signal` objects queued by the
strategy on bar T into :class:`Fill` objects on bar T+1 (for MOO / LMT / STOP
/ TP) or on bar T's close (for MOC / MKT). It enforces no-look-ahead by
requiring the engine to stage each signal with the bar on which it was
issued.

Supported order types:

* ``MKT``  -- fills at the bar close on which the order is staged (engine
              behaviour: engines that stage market orders on T fill at T close).
* ``MOO``  -- fills at the open of the next bar.
* ``MOC``  -- fills at the close of the current bar (same-bar execution).
* ``LMT``  -- fills on the next bar iff the bar's range crosses the limit,
              using the limit price itself.
* ``STOP`` -- triggered if the next bar's range crosses the stop; fills at the
              stop price.
* ``TP``   -- same as STOP but for a favourable level.

Time-in-force:

* ``DAY`` -- one-bar life; unfilled after its fill bar is cancelled.
* ``GTC`` -- remains alive until filled or explicitly cancelled.
* ``IOC`` -- same as DAY for our bar-level simulation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

from backtest.costs import CostModel
from backtest.types import (
    AssetClass,
    Bar,
    Fill,
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)

log = logging.getLogger("alphadesk.backtest.execution")


def _d(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


@dataclass
class PendingOrder:
    """An order queued by the strategy, awaiting its eligible execution bar."""

    signal: Signal
    staged_on: datetime
    submitted_on: datetime
    symbol: str
    side: Side
    quantity: int
    order_type: OrderType
    time_in_force: TimeInForce
    limit_price: Optional[Decimal] = None
    stop_price: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    tag: str = ""
    # True once the order has been exposed to at least one fill bar. Used
    # to retire DAY / IOC orders.
    seen_fill_bar: bool = False


class ExecutionSimulator:
    """Convert signals into fills using a single-pass bar model.

    Parameters
    ----------
    cost_model:
        Commission + slippage model; :class:`backend.backtest.costs.CostModel`.
    default_spread_pct:
        Fallback equity half-spread when the engine doesn't supply a
        per-bar quote. Options use their own spread model (see
        ``default_options_spread_pct``).
    options_provider:
        Optional :class:`backend.backtest.types.OptionsProvider`. Required
        to price multi-leg option Signals at their real per-contract
        premium. When absent, multi-leg fills fall back to the legacy
        (bad) behaviour of pricing all legs at the underlying's bar.close
        with a ``WARN`` log emitted once per simulator instance.
    default_options_spread_pct:
        Half-spread used for option-leg slippage when the options
        provider doesn't expose a bid/ask. Default ``0.05`` = 5% half
        spread which is a reasonable floor for retail options fills.
    options_bs_fallback:
        Optional callable ``(leg, underlying_price, asof) -> Decimal`` that
        returns a fallback per-contract theoretical price when the
        options provider's ``contract_bars`` lookup returns no rows.
        Typically wraps :func:`backend.indicators.options.bs_price`.
    """

    def __init__(
        self,
        cost_model: CostModel,
        default_spread_pct: Optional[Decimal] = None,
        *,
        options_provider: Optional[Any] = None,
        default_options_spread_pct: Decimal | float = Decimal("0.05"),
        options_bs_fallback: Optional[Any] = None,
    ) -> None:
        self.cost_model = cost_model
        self.default_spread_pct = (
            _d(default_spread_pct) if default_spread_pct is not None else None
        )
        self.options_provider = options_provider
        self.default_options_spread_pct = _d(default_options_spread_pct)
        self.options_bs_fallback = options_bs_fallback
        self._pending: list[PendingOrder] = []
        # Emit the "missing provider" warning only once per simulator so
        # long backtests don't spam the log.
        self._warned_missing_options_provider = False

    # ------------------------------------------------------------------
    # Queueing
    # ------------------------------------------------------------------

    def queue(
        self,
        signal: Signal,
        staged_on: datetime,
        side: Side,
        quantity: int,
    ) -> None:
        """Queue a signal for execution on the next eligible bar."""

        if quantity <= 0:
            return

        self._pending.append(
            PendingOrder(
                signal=signal,
                staged_on=staged_on,
                submitted_on=staged_on,
                symbol=signal.symbol,
                side=side,
                quantity=quantity,
                order_type=signal.order_type,
                time_in_force=signal.time_in_force,
                limit_price=signal.limit_price,
                stop_price=signal.stop_price,
                take_profit=signal.take_profit,
                legs=signal.legs,
                tag=signal.tag,
            )
        )

    def cancel(self, symbol: str) -> int:
        """Cancel all pending orders for a symbol. Returns count cancelled."""

        before = len(self._pending)
        self._pending = [p for p in self._pending if p.symbol != symbol]
        return before - len(self._pending)

    def pending(self) -> list[PendingOrder]:
        return list(self._pending)

    # ------------------------------------------------------------------
    # Fill simulation
    # ------------------------------------------------------------------

    def fill_bar(
        self,
        bar: Bar,
        *,
        adv_20d: Optional[Decimal] = None,
        spread_pct: Optional[Decimal] = None,
    ) -> list[Fill]:
        """Run one bar worth of execution for a single symbol.

        Returns the list of fills produced on this bar.

        Called twice per bar-cycle in the engine (once at open for MOO orders,
        once at close for MOC / MKT / bar-contingent orders). The simulator
        does not know about open vs close itself — instead the engine passes
        the same :class:`Bar` with different order types eligible.

        Strategy: iterate ``self._pending``, attempt each order, collect fills,
        drop DAY / IOC orders after their fill bar.
        """

        fills: list[Fill] = []
        survivors: list[PendingOrder] = []

        for order in self._pending:
            if order.symbol != bar.symbol:
                survivors.append(order)
                continue

            # Orders can only fill on bars strictly after they were staged,
            # except MOC / MKT which fill on the staging bar's close.
            if order.order_type in (OrderType.MOC, OrderType.MKT):
                if bar.ts < order.staged_on:
                    survivors.append(order)
                    continue
            else:
                if bar.ts <= order.staged_on:
                    survivors.append(order)
                    continue

            fill = self._try_fill(
                order, bar, adv_20d=adv_20d, spread_pct=spread_pct
            )
            order.seen_fill_bar = True
            if fill is not None:
                fills.append(fill)
                # Filled orders are removed.
                continue

            if order.time_in_force in (TimeInForce.DAY, TimeInForce.IOC):
                # Gone after this bar.
                continue

            # GTC lives on.
            survivors.append(order)

        self._pending = survivors
        return fills

    # ------------------------------------------------------------------
    # Per-order fill rules
    # ------------------------------------------------------------------

    def _try_fill(
        self,
        order: PendingOrder,
        bar: Bar,
        *,
        adv_20d: Optional[Decimal],
        spread_pct: Optional[Decimal],
    ) -> Optional[Fill]:
        # Multi-leg option orders take a completely different fill path
        # because the underlying bar's open/close is nonsense as a spread
        # premium.
        if order.legs:
            return self._fill_multileg_option(order, bar)

        ot = order.order_type
        price: Optional[Decimal] = None

        if ot is OrderType.MOO:
            price = bar.open
        elif ot is OrderType.MOC:
            price = bar.close
        elif ot is OrderType.MKT:
            price = bar.close
        elif ot is OrderType.LMT:
            if order.limit_price is None:
                return None
            lmt = order.limit_price
            if order.side is Side.BUY and bar.low <= lmt:
                price = min(lmt, bar.open)  # fill at better of open or limit
            elif order.side is Side.SELL and bar.high >= lmt:
                price = max(lmt, bar.open)
        elif ot is OrderType.STOP:
            stop = order.stop_price
            if stop is None:
                return None
            if order.side is Side.SELL and bar.low <= stop:
                price = stop  # stop-loss on a long
            elif order.side is Side.BUY and bar.high >= stop:
                price = stop  # stop-buy / short-cover
        elif ot is OrderType.TP:
            tp = order.take_profit
            if tp is None:
                return None
            if order.side is Side.SELL and bar.high >= tp:
                price = tp
            elif order.side is Side.BUY and bar.low <= tp:
                price = tp

        if price is None:
            return None

        return self._build_fill(
            order, bar, price, adv_20d=adv_20d, spread_pct=spread_pct
        )

    # ------------------------------------------------------------------
    # Multi-leg option fill
    # ------------------------------------------------------------------

    def _fill_multileg_option(
        self,
        order: PendingOrder,
        bar: Bar,
    ) -> Optional[Fill]:
        """Fill a multi-leg options order leg-by-leg using real prices.

        For each leg we:

        1. Query the :class:`OptionsProvider` for the contract bar on the
           fill date; use its ``close`` as the mid price.
        2. If the provider has no row, fall back to the Black-Scholes
           theoretical via ``options_bs_fallback`` when supplied.
        3. Apply half-spread slippage per leg (spread from provider if it
           exposes bid/ask, else ``default_options_spread_pct``).

        The net per-spread premium is ``sum over legs of
        sign(leg_side_under_parent) * leg_price * leg.qty * multiplier``
        with the sign convention that a SELL spread produces a POSITIVE
        ``Fill.price`` (credit flowing to seller). The Portfolio uses the
        per-leg prices in ``Fill.leg_prices`` to book leg-by-leg
        Positions; the net price on ``Fill.price`` is for analytics only.

        Returns ``None`` if no leg price can be resolved.
        """

        if self.options_provider is None:
            return self._fallback_multileg_on_underlying(order, bar)

        # For MOC / MKT we use the bar's close date; for MOO we use the
        # bar's open (which is represented by the same bar date — the
        # engine hands the simulator one bar per session). Either way the
        # fill asof date is bar.ts.date().
        asof = bar.ts.date() if isinstance(bar.ts, datetime) else bar.ts

        # Limit / stop / TP semantics on multi-leg option signals: the
        # limit_price (when supplied) caps the net premium we're willing
        # to pay (BUY) or accept (SELL). We ignore stop/tp for multi-leg
        # options — they don't apply cleanly to a net premium.
        leg_prices: list[Decimal] = []
        leg_prices_pre_slip: list[Decimal] = []

        for leg in order.legs:
            raw_mid = self._price_leg(
                leg, asof=asof, underlying_bar=bar
            )
            if raw_mid is None:
                log.debug(
                    "multileg fill: no price for leg %s on %s; aborting",
                    leg.contract_id, asof,
                )
                return None
            leg_prices_pre_slip.append(raw_mid)

            # Per-leg slippage: BUY leg pays the ask (mid + half-spread);
            # SELL leg receives the bid (mid - half-spread). ``leg.side``
            # is the canonical leg direction (not flipped by parent).
            spread_pct = self._leg_spread_pct(leg, asof)
            half_spread = raw_mid * (spread_pct / Decimal("2"))

            if leg.side is Side.BUY:
                leg_px = raw_mid + half_spread
            else:
                leg_px = raw_mid - half_spread
            if leg_px <= 0:
                # Can't fill below zero; tiny raw mids with fat spreads
                # collapse to zero/negative — treat as un-fillable.
                leg_px = Decimal("0.01")
            leg_prices.append(leg_px)

        # Fill.price is the *absolute net per-spread premium* in
        # per-contract dollars (pre-multiplier) — i.e. the sum or difference
        # of the per-leg quoted mids weighted by leg.qty. A short strangle
        # (sell call + sell put) yields |call_mid + put_mid|; a bull call
        # spread (buy call + sell call) yields |buy_mid - sell_mid|. The
        # spread *direction* (credit/debit) is conveyed by Fill.side,
        # consistent with how the rest of the engine handles single-leg
        # fills.
        net_signed = Decimal("0")
        for leg, px in zip(order.legs, leg_prices):
            # Weight by leg.qty, not the multiplier — Fill.price is quoted
            # pre-multiplier (i.e. per share). Applying the multiplier is
            # the Portfolio's job when booking cashflow.
            if leg.side is Side.BUY:
                net_signed -= px * Decimal(leg.qty)
            else:
                net_signed += px * Decimal(leg.qty)
        net_per_spread = abs(net_signed)

        # Limit price gate: caller's limit_price is the net premium floor
        # (SELL) or cap (BUY). We measure against the absolute net,
        # since the direction is already encoded in fill.side.
        if order.limit_price is not None:
            if order.side is Side.BUY and net_per_spread > order.limit_price:
                log.debug(
                    "multileg LMT reject: net %.4f > limit %.4f",
                    float(net_per_spread), float(order.limit_price),
                )
                # LMT / IOC / DAY orders that can't fill get retired via
                # the normal non-fill path.
                return None
            if order.side is Side.SELL and net_per_spread < order.limit_price:
                log.debug(
                    "multileg LMT reject: net %.4f < limit %.4f",
                    float(net_per_spread), float(order.limit_price),
                )
                return None

        # Compute commission using the existing per-leg cost model.
        commission = self.cost_model.commission(
            order.symbol,
            order.quantity,
            net_per_spread,
            AssetClass.MULTILEG,
            order.side,
            legs=order.legs,
        )

        # Slippage for multi-leg options: sum of |per-leg half-spread| *
        # contracts across all legs. Slippage is already baked into the
        # per-leg fill prices; we report the total dollar slippage so the
        # portfolio's cash accounting has a single "cost of execution"
        # line. We pass it to the Fill so downstream analytics can see
        # the dollar figure even though it's already in the per-leg prices.
        total_slippage = Decimal("0")
        for leg, raw, post in zip(order.legs, leg_prices_pre_slip, leg_prices):
            diff = abs(post - raw)
            multiplier = Decimal(int(leg.multiplier or 100))
            total_slippage += (
                diff * Decimal(leg.qty) * Decimal(order.quantity) * multiplier
            )

        # Slippage is already embedded in per-leg cashflows when the
        # portfolio sums them — so we report it here for analytics but
        # do NOT deduct it a second time on top. We achieve that by
        # setting slippage=0 in the Fill. Commission is still an
        # independent debit.
        return Fill(
            symbol=order.symbol,
            ts=bar.ts,
            side=order.side,
            quantity=order.quantity,
            price=net_per_spread,
            commission=commission,
            slippage=Decimal("0"),
            legs=order.legs,
            leg_prices=tuple(leg_prices),
            tag=order.tag,
        )

    def _fallback_multileg_on_underlying(
        self, order: PendingOrder, bar: Bar
    ) -> Optional[Fill]:
        """Legacy (incorrect) multi-leg fill when no options provider is wired.

        Prices every leg at the underlying's ``bar.close``, which is
        wrong for option premiums but preserves behaviour for callers
        that have not yet migrated. Emits a one-shot warning so the
        issue is discoverable.
        """

        if not self._warned_missing_options_provider:
            log.warning(
                "ExecutionSimulator has no options_provider; multi-leg "
                "Signals will price all legs at the underlying's bar.close "
                "(incorrect but compatible with legacy callers). Wire an "
                "OptionsProvider to get real per-contract premiums."
            )
            self._warned_missing_options_provider = True

        price = bar.close
        leg_prices = tuple(price for _ in order.legs)
        # Use the old per-leg commission model.
        commission = self.cost_model.commission(
            order.symbol,
            order.quantity,
            price,
            AssetClass.MULTILEG,
            order.side,
            legs=order.legs,
        )
        return Fill(
            symbol=order.symbol,
            ts=bar.ts,
            side=order.side,
            quantity=order.quantity,
            price=price,
            commission=commission,
            slippage=Decimal("0"),
            legs=order.legs,
            leg_prices=leg_prices,
            tag=order.tag,
        )

    def _price_leg(
        self,
        leg: OptionLeg,
        *,
        asof: date,
        underlying_bar: Bar,
    ) -> Optional[Decimal]:
        """Return the per-contract mid price for ``leg`` on ``asof``.

        Preference order:

        1. ``options_provider.contract_bars(leg.contract_id, asof, asof)``
           → use the bar's ``close`` as the mid.
        2. ``options_bs_fallback(leg, underlying_price, asof)`` if set.
        3. ``None`` (caller aborts the fill).
        """

        provider = self.options_provider
        try:
            bars_df = provider.contract_bars(
                leg.contract_id, asof, asof, tf="1D"
            )
        except Exception:
            bars_df = None

        if bars_df is not None:
            try:
                import pandas as pd
                if bars_df is not None and len(bars_df) > 0:
                    row = bars_df.iloc[-1]
                    cols = {c.lower(): c for c in bars_df.columns}
                    close_col = cols.get("close")
                    if close_col is not None:
                        val = row[close_col]
                        if val is not None and not pd.isna(val):
                            px = Decimal(str(float(val)))
                            if px > 0:
                                return px
            except Exception:
                log.debug(
                    "multileg fill: contract_bars parse failed for %s",
                    leg.contract_id, exc_info=True,
                )

        # BS fallback.
        if self.options_bs_fallback is not None:
            try:
                px = self.options_bs_fallback(
                    leg, underlying_bar.close, asof
                )
                if px is not None:
                    return _d(px)
            except Exception:
                log.exception(
                    "multileg fill: BS fallback raised for %s on %s",
                    leg.contract_id, asof,
                )

        return None

    def _leg_spread_pct(
        self, leg: OptionLeg, asof: date
    ) -> Decimal:
        """Per-leg half-spread percentage for slippage.

        Prefers the options provider's bid/ask via ``chain_snapshot`` for
        richer data. Falls back to :attr:`default_options_spread_pct`.
        """

        provider = self.options_provider
        if provider is None:
            return self.default_options_spread_pct
        # Chain snapshots are expensive; only pull when underlying is
        # available on the leg and not already memoised per-asof. We
        # keep a small LRU on the simulator.
        if leg.underlying is None:
            return self.default_options_spread_pct
        cache = getattr(self, "_spread_cache", None)
        if cache is None:
            cache = {}
            self._spread_cache = cache
        key = (leg.underlying, asof)
        if key not in cache:
            try:
                df = provider.chain_snapshot(leg.underlying, asof)
            except Exception:
                df = None
            cache[key] = df
            # Bound the cache so long backtests don't leak memory.
            if len(cache) > 64:
                # Drop the oldest entry.
                first_key = next(iter(cache))
                cache.pop(first_key, None)
        df = cache.get(key)
        if df is None:
            return self.default_options_spread_pct
        try:
            import pandas as pd
            if df is None or len(df) == 0:
                return self.default_options_spread_pct
            # Filter by contract ticker.
            cols = {c.lower(): c for c in df.columns}
            ct_col = cols.get("contract_ticker") or cols.get("contract")
            if ct_col is None:
                return self.default_options_spread_pct
            match = df[df[ct_col].astype(str) == leg.contract_id]
            if match.empty:
                return self.default_options_spread_pct
            row = match.iloc[0]
            bid = row.get(cols.get("bid", "bid"))
            ask = row.get(cols.get("ask", "ask"))
            try:
                bid_f = float(bid) if bid is not None and not pd.isna(bid) else None
                ask_f = float(ask) if ask is not None and not pd.isna(ask) else None
            except Exception:
                bid_f = ask_f = None
            if bid_f and ask_f and ask_f > 0 and ask_f >= bid_f > 0:
                mid = (bid_f + ask_f) / 2.0
                if mid > 0:
                    spread_pct = (ask_f - bid_f) / mid
                    return _d(max(spread_pct, 0.0))
        except Exception:
            log.debug(
                "leg_spread_pct: chain snapshot parse failed for %s",
                leg.contract_id, exc_info=True,
            )
        return self.default_options_spread_pct

    def _build_fill(
        self,
        order: PendingOrder,
        bar: Bar,
        price: Decimal,
        *,
        adv_20d: Optional[Decimal],
        spread_pct: Optional[Decimal],
    ) -> Fill:
        asset_class = (
            AssetClass.MULTILEG if order.legs else AssetClass.EQUITY
        )
        commission = self.cost_model.commission(
            order.symbol,
            order.quantity,
            price,
            asset_class,
            order.side,
            legs=order.legs,
        )
        slip_spread = (
            _d(spread_pct)
            if spread_pct is not None
            else self.default_spread_pct
        )
        slippage = self.cost_model.slippage(
            order.symbol,
            order.quantity,
            price,
            adv_20d=adv_20d,
            spread_pct=slip_spread,
        )

        # Bake slippage into the traded price so the position's cost basis
        # reflects realised execution cost.
        if order.side is Side.BUY:
            fill_price = price + (
                slippage / Decimal(order.quantity) if order.quantity else Decimal("0")
            )
        else:
            fill_price = price - (
                slippage / Decimal(order.quantity) if order.quantity else Decimal("0")
            )

        return Fill(
            symbol=order.symbol,
            ts=bar.ts,
            side=order.side,
            quantity=order.quantity,
            price=fill_price,
            commission=commission,
            slippage=slippage,
            legs=order.legs,
            tag=order.tag,
        )


__all__ = ["ExecutionSimulator", "PendingOrder"]
