"""Earnings-Volatility short iron butterfly — production implementation.

Thesis (see ``spec.md``): around earnings, implied vol in front-week options
systematically over-prices the realised move. A defined-risk short iron
butterfly entered at T-1 close and exited at T+1 open harvests the IV
crush without direct exposure to a second day of gamma.

This module is a package-layout strategy that implements the
:class:`backend.strategies.base.Strategy` protocol. The engine is daily
event-driven; we emit a single 4-leg :class:`Signal` per qualified event
and a matching closing signal on the configured exit bar.

Options P&L model
-----------------
The engine's multi-leg fill path only accepts a **net per-spread** price.
Polygon's historical options bars do not cover every strike reliably (the
Developer tier) and an end-of-day chain snapshot is not available on every
session. To stay accurate without building a deep options cache we price
each leg with Black-Scholes at entry using the implied vol inverted from
the live ATM straddle, and at exit with BS using a crushed IV
(``iv_crush_retention`` × pre-event IV). This is a conservative
synthetic-P&L model — it captures the vega discharge that *is* the edge
while acknowledging we don't have leg-level intraday options tape.

Data sources
------------
- FMP earnings calendar (``EarningsProvider.calendar``) for per-date event
  lists with the after-close / before-open time marker.
- Alpaca daily bars for the underlying (close, historical earnings-day
  moves).
- Polygon options chain (``OptionsProvider.chain_snapshot``) for the ATM
  straddle mid at T-1 close.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from backend.indicators.options import bs_price, iv_from_price
from backend.strategies.base import Context, cache_of
from backend.strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from backend.strategies.signal import OptionLeg, OrderType, Side, Signal, TimeInForce

from .config import DEFAULTS, UNIVERSE, search_space
from .polygon_helpers import (
    contract_close,
    list_weekly_contracts,
    register_synthetic_price,
)

log = logging.getLogger("alphadesk.strategies.earnings_vol")


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim that tolerates double-loading."""

    name = kwargs.get("name") or (args[0] if args else None)
    decorator = register_strategy(*args, **kwargs)

    def wrap(cls):
        try:
            return decorator(cls)
        except StrategyRegistrationError:
            existing = _STRATEGY_CLASSES.get(name)
            if existing is None:
                raise
            return existing

    return wrap


# --------------------------------------------------------------------------- #
# Internal constants                                                          #
# --------------------------------------------------------------------------- #
_REQUIRED_LOOKBACK_DAYS = 800  # ~8Q of history + buffer
_NS = "earnings_vol"           # ``ctx.state`` namespace prefix
_YEAR_DAYS = 365.25
_MAX_WIDE_SPREAD_PCT = 0.10    # 10% bid-ask / mid on wings = skip


# --------------------------------------------------------------------------- #
# Pending trade bookkeeping                                                   #
# --------------------------------------------------------------------------- #
@dataclass
class _Pending:
    """Open iron-butterfly trade state kept on ``ctx.cache``.

    We only need enough to (a) price the close leg deterministically on
    the exit bar and (b) attribute P&L per-name in the report.
    """

    symbol: str                     # Real underlying (for reporting).
    synthetic_symbol: str           # EVOL:<sym>:<YYYYMMDD> — what the engine sees.
    entry_date: date                # The T-1 entry bar (MOC).
    exit_date: date                 # The first session at or after earnings.
    strike_body: float
    strike_wing_call: float
    strike_wing_put: float
    expiry: date
    entry_iv: float                 # Inverted from the ATM straddle at entry.
    entry_spread_px: float          # Net per-spread credit ($/spread, positive).
    contracts: int                  # Spreads held (short — signed in position).
    legs: tuple[OptionLeg, ...]
    underlying_entry: float
    earnings_time: str              # "before_open" / "after_close" / "unknown"
    exit_timing: str


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="earnings_vol",
    category="options",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=1,
    supports_shorts=True,
    supports_options=True,
    description=(
        "Short iron butterfly on 30 liquid single names reporting earnings, "
        "sized 2%/trade, entered T-1 close when implied move > 1.2x 8Q "
        "historical move, exited next open. Defined-risk vol-crush harvest."
    ),
)
class EarningsVolStrategy:
    """Single-name short-vol iron butterfly around scheduled earnings."""

    name = "earnings_vol"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle                                                          #
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v
        # Type coercion
        for k in (
            "implied_vs_historical_min_ratio",
            "wing_width_multiple",
            "max_loss_pct_per_trade",
            "iv_crush_retention",
            "risk_free_rate",
        ):
            merged[k] = float(merged[k])
        for k in (
            "dte_target",
            "min_underlying_price",
            "max_concurrent_positions",
            "historical_moves_lookback_quarters",
            "min_historical_events",
        ):
            merged[k] = int(merged[k])
        for k in ("exit_timing", "earnings_timing_filter"):
            merged[k] = str(merged[k])
        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        """Determine the universe and *pre-score* candidates for the day.

        We do the heavy lifting (chain pulls, historical-move calc, BS
        inversion) inside ``universe()`` rather than ``generate_signals``
        so the engine's single bar-fetch pass (step 2) includes the
        synthetic spread symbols we'll emit signals against. The scored
        candidates are stashed on ``ctx.cache`` and consumed by
        ``generate_signals`` without redoing the work.
        """
        out = set(UNIVERSE)
        for p in ctx.positions:
            out.add(p.symbol)
        cache = cache_of(ctx)
        pending: dict = cache.get(f"{_NS}.pending", {}) or {}
        for pen in pending.values():
            out.add(pen.synthetic_symbol)

        # Pre-register exit prices for any position whose exit MOO is
        # due to FILL today. MOO orders staged on prior session T fill
        # on T+1 open — so if exit_date was yesterday we need a price
        # today. Additionally, register today's synthetic so M2M values
        # the position during the hold.
        for pen in pending.values():
            # While we're holding (entry_date <= today < exit_date): mark
            # at entry price so equity curve doesn't jump.
            from .polygon_helpers import SYNTHETIC_LEDGER as _LED
            if pen.entry_date <= asof < pen.exit_date:
                _LED.setdefault((pen.synthetic_symbol, asof), pen.entry_spread_px)
            # On the exit-fill day (T+1 open after exit MOO staged at T),
            # publish the synthetic BS-computed exit price.
            if asof >= pen.exit_date:
                exit_px = self._synthetic_exit_net_premium(ctx, pen, asof)
                if exit_px is None:
                    exit_px = pen.entry_spread_px
                register_synthetic_price(pen.synthetic_symbol, asof, exit_px)

        # Early-score any candidate whose earnings fire tomorrow so we
        # can register its synthetic spread price **before** the engine
        # pulls bars. Without this, the engine's step 2 sees an empty
        # ledger and the MOC fill in step 10 has no bar to match.
        ep = getattr(ctx, "earnings_provider", None)
        if ep is not None:
            scored_today = self._pre_score_today(ctx, asof)
            cache[f"{_NS}.scored_today"] = scored_today
            for plan in scored_today:
                out.add(plan["synthetic_symbol"])

        return sorted(out)

    def _pre_score_today(self, ctx: Context, asof: date) -> list[dict]:
        """Run the scoring pipeline for every candidate with earnings
        tomorrow and register the spread price in the synthetic ledger.

        Returns the list of passing plans (also cached on ``ctx.state``).
        """
        p = self.params
        ep = getattr(ctx, "earnings_provider", None)
        if ep is None:
            return []
        target_date = asof + timedelta(days=1)
        events = _get_events_on(ctx, ep, target_date)
        if not events:
            return []

        held_symbols = {
            (pos.symbol.split(":", 2)[1] if pos.symbol.startswith("EVOL:") else pos.symbol)
            for pos in ctx.positions
        }

        scored: list[dict] = []
        seen: set[str] = set()
        for ev in events:
            sym = str(ev.get("symbol") or "").upper()
            if not sym or sym in seen or sym in held_symbols or sym not in UNIVERSE:
                continue
            seen.add(sym)
            plan = self._score_candidate(ctx, asof, sym, ev)
            if plan is None:
                continue
            # Synthetic symbol must be deterministic given expiry.
            synth = f"EVOL:{sym}:{plan['expiration'].strftime('%Y%m%d')}"
            plan["synthetic_symbol"] = synth
            # Publish entry price now; generate_signals will emit against it.
            mult = 100
            entry_net_px = plan["net_credit_per_contract"] * mult
            register_synthetic_price(synth, asof, entry_net_px)
            scored.append(plan)
        return scored

    # ------------------------------------------------------------------ #
    # Entries                                                            #
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit Signals based on plans pre-scored during ``universe()``."""
        p = self.params
        cache = cache_of(ctx)

        held = [pos for pos in ctx.positions if pos.quantity != 0]
        capacity = int(p["max_concurrent_positions"]) - len(held)
        if capacity <= 0:
            return []

        def _real_sym_of(s: str) -> str:
            if s.startswith("EVOL:"):
                parts = s.split(":")
                if len(parts) >= 2:
                    return parts[1]
            return s

        held_symbols = {_real_sym_of(pos.symbol) for pos in held}
        pending_syms = {
            pen.symbol for pen in cache.get(f"{_NS}.pending", {}).values()
        }
        already = held_symbols | pending_syms

        scored = list(cache.get(f"{_NS}.scored_today", []) or [])
        scored = sorted(scored, key=lambda pl: pl.get("ratio", 0), reverse=True)

        out: list[Signal] = []
        for plan in scored[:capacity]:
            sym = plan["symbol"]
            if sym in already:
                continue
            sig = self._emit_signal(asof, plan, cache)
            if sig is not None:
                out.append(sig)
                already.add(sym)
        return out

    # ------------------------------------------------------------------ #
    # Manage (exits)                                                     #
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        cache = cache_of(ctx)
        pending: dict[str, _Pending] = cache.get(f"{_NS}.pending", {})

        # Remove any pending entry whose position has actually gone flat
        # (the engine booked the round-trip). This is how we retire
        # ``_Pending`` rather than popping when we emit the exit signal
        # (the MOO fill happens a session later, so the pending record
        # must stay around until then).
        open_syms = {
            p.symbol for p in ctx.positions if p.quantity != 0
        }
        for synth in list(pending):
            if synth not in open_syms:
                pending.pop(synth, None)
        cache[f"{_NS}.pending"] = pending

        out: list[Signal] = []
        emitted_syms: list[str] = []
        for synth, pen in pending.items():
            if asof < pen.exit_date:
                continue
            # Only emit the exit signal once — track in cache.
            exit_emitted = cache.get(f"{_NS}.exit_emitted", set())
            if synth in exit_emitted:
                continue
            # Close out.
            close_legs = tuple(
                OptionLeg(
                    contract_id=leg.contract_id,
                    side=Side.BUY if leg.side is Side.SELL else Side.SELL,
                    qty=leg.qty,
                    underlying=leg.underlying,
                    expiry=leg.expiry,
                    strike=leg.strike,
                    right=leg.right,
                    multiplier=leg.multiplier,
                )
                for leg in pen.legs
            )

            # Synthetic exit premium using BS with crushed IV.
            exit_net_px = self._synthetic_exit_net_premium(ctx, pen, asof)
            if exit_net_px is None:
                # Data hole — mark flat at entry price so P&L is 0.
                exit_net_px = pen.entry_spread_px

            # Publish the exit price to the synthetic-bar ledger so the
            # engine can fill at this price on the exit session.
            register_synthetic_price(synth, asof, exit_net_px)

            # We also need the entry bar to exist on every session between
            # entry and exit so the engine's mark-to-market doesn't flatten
            # the position value. Re-publish the last-known close on any
            # session we've held through.
            pub_date = pen.entry_date
            from datetime import timedelta as _td
            while pub_date < asof:
                # If not already published, use entry price; the engine only
                # reads these if universe() pulls the symbol.
                from .polygon_helpers import SYNTHETIC_LEDGER
                if (synth, pub_date) not in SYNTHETIC_LEDGER:
                    SYNTHETIC_LEDGER[(synth, pub_date)] = pen.entry_spread_px
                pub_date += _td(days=1)

            out.append(
                Signal(
                    symbol=synth,
                    quantity=pen.contracts,   # same sign as entry (pos=short)
                    legs=close_legs,
                    order_type=_exit_order_type(pen.exit_timing),
                    time_in_force=TimeInForce.DAY,
                    tag=f"earnings_vol-exit-{pen.exit_timing}-{pen.symbol}",
                    asof=asof,
                )
            )
            emitted_syms.append(synth)

        if emitted_syms:
            exit_emitted = cache.setdefault(f"{_NS}.exit_emitted", set())
            for synth in emitted_syms:
                exit_emitted.add(synth)
        cache[f"{_NS}.pending"] = pending
        return out

    def on_fill(self, fill: Any, ctx: Context) -> None:
        # We track state in generate_signals / manage via ctx.cache. The
        # engine accounting does the money math through Portfolio.
        return None

    # ================================================================== #
    # Candidate scoring                                                  #
    # ================================================================== #
    def _score_candidate(
        self,
        ctx: Context,
        asof: date,
        symbol: str,
        event: dict,
    ) -> Optional[dict]:
        p = self.params

        earn_time = _classify_earnings_time(event)

        # Earnings timing filter.
        timing_filter = p["earnings_timing_filter"]
        if timing_filter == "after_close_only" and earn_time != "after_close":
            return None
        # If BMO (before market open) we still evaluate at T-1 close — the
        # market move is event-driven on T anyway.
        if earn_time == "during_hours":
            return None

        # Underlying close at T-1.
        under_close = _last_close(ctx, symbol, asof)
        if under_close is None or under_close <= 0:
            return None
        if under_close < float(p["min_underlying_price"]):
            return None

        # Chain snapshot at asof (T-1 close). We use the polygon_helpers
        # shim because the upstream ``chain_snapshot`` returns pre-expiry
        # contracts only (see ``polygon_helpers.list_weekly_contracts``).
        op = getattr(ctx, "options_provider", None)
        if op is None:
            return None
        dte_target = int(p["dte_target"])
        try:
            if hasattr(op, "_http"):
                chain = list_weekly_contracts(
                    op, symbol, asof, min_dte=1, max_dte=max(dte_target + 14, 21),
                )
            else:
                chain = op.chain_snapshot(symbol, asof)
        except Exception:
            chain = None
        if chain is None or len(chain) == 0:
            return None

        # Pick the expiration at/just after dte_target.
        exp = _select_expiration(chain, asof, dte_target)
        if exp is None:
            return None

        # ATM strike + straddle mid.
        leg_picks = _pick_leg_strikes(
            chain=chain,
            expiration=exp,
            underlying=under_close,
            wing_width_abs=None,   # placeholder; filled once we know the move
        )
        if leg_picks is None:
            return None
        K0 = leg_picks["body_strike"]

        straddle_mid = _straddle_mid(
            chain, exp, K0, options_provider=op, asof=asof,
        )
        if straddle_mid is None or straddle_mid <= 0:
            return None
        implied_move_pct = float(straddle_mid) / float(under_close)
        implied_move_abs = float(straddle_mid)

        # Historical move from Alpaca daily bars.
        hist_median = self._historical_earnings_move(ctx, symbol, asof)
        if hist_median is None:
            return None

        ratio = implied_move_pct / hist_median if hist_median > 0 else float("nan")
        if not math.isfinite(ratio):
            return None
        if ratio < float(p["implied_vs_historical_min_ratio"]):
            return None

        # Wing strikes — abs move in dollars, not pct.
        wing_mult = float(p["wing_width_multiple"])
        wing_width_abs = wing_mult * implied_move_abs

        # Re-pick leg strikes now that we know the wing width.
        leg_picks = _pick_leg_strikes(
            chain=chain,
            expiration=exp,
            underlying=under_close,
            wing_width_abs=wing_width_abs,
        )
        if leg_picks is None:
            return None

        # Liquidity filter on wings.
        if _wing_spread_too_wide(
            chain, exp, leg_picks["wing_call_strike"], leg_picks["wing_put_strike"]
        ):
            return None

        # Invert IV at entry from the ATM straddle so we can reprice the
        # close legs deterministically.
        tau_entry = max(1.0 / _YEAR_DAYS, (exp - asof).days / _YEAR_DAYS)
        call_mid = _leg_mid(
            chain, exp, K0, "call", options_provider=op, asof=asof,
        )
        put_mid = _leg_mid(
            chain, exp, K0, "put", options_provider=op, asof=asof,
        )
        if call_mid is None or put_mid is None or call_mid <= 0 or put_mid <= 0:
            return None
        r = float(p["risk_free_rate"])
        iv_call = iv_from_price(
            price=float(call_mid),
            spot=float(under_close),
            strike=float(K0),
            tau=float(tau_entry),
            r=r, q=0.0, call_put="call",
        )
        iv_put = iv_from_price(
            price=float(put_mid),
            spot=float(under_close),
            strike=float(K0),
            tau=float(tau_entry),
            r=r, q=0.0, call_put="put",
        )
        iv_vals = [v for v in (iv_call, iv_put) if math.isfinite(v) and v > 0]
        if not iv_vals:
            return None
        entry_iv = float(np.mean(iv_vals))

        # Net credit per spread: short body (credit) + long wings (debit).
        wing_call_mid = _leg_mid(
            chain, exp, leg_picks["wing_call_strike"], "call",
            options_provider=op, asof=asof,
        )
        wing_put_mid = _leg_mid(
            chain, exp, leg_picks["wing_put_strike"], "put",
            options_provider=op, asof=asof,
        )
        if wing_call_mid is None or wing_put_mid is None:
            return None
        net_credit_per_contract = (
            float(call_mid) + float(put_mid)
            - float(wing_call_mid) - float(wing_put_mid)
        )
        if net_credit_per_contract <= 0:
            return None

        # Sizing.
        wing_width_dollars = wing_width_abs  # distance body -> wing in $
        # Max loss per spread = wing_width * 100 - net_credit * 100.
        max_loss_per_spread = (wing_width_dollars - net_credit_per_contract) * 100.0
        if max_loss_per_spread <= 0:
            return None

        equity_f = float(ctx.equity or 0)
        if equity_f <= 0:
            return None
        max_risk_dollars = equity_f * float(p["max_loss_pct_per_trade"])
        contracts = max(1, int(max_risk_dollars // max_loss_per_spread))

        # Target exit date: the earnings session T. manage() emits a
        # MOO on that session which the engine fills on T+1 open — i.e.
        # the first post-event open, which is the pure IV-crush exit.
        # (The engine's MOO semantics are next-bar fill, so staging on T
        # yields a T+1 fill.)
        exit_date = _next_session(asof, ctx)

        return {
            "symbol": symbol,
            "ratio": ratio,
            "implied_move_abs": implied_move_abs,
            "hist_median": hist_median,
            "body_strike": float(K0),
            "wing_call_strike": float(leg_picks["wing_call_strike"]),
            "wing_put_strike": float(leg_picks["wing_put_strike"]),
            "expiration": exp,
            "call_mid": float(call_mid),
            "put_mid": float(put_mid),
            "wing_call_mid": float(wing_call_mid),
            "wing_put_mid": float(wing_put_mid),
            "entry_iv": entry_iv,
            "net_credit_per_contract": net_credit_per_contract,
            "contracts": int(contracts),
            "underlying_entry": float(under_close),
            "tau_entry": float(tau_entry),
            "earn_time": earn_time,
            "exit_date": exit_date,
            "contract_ids": {
                "body_call": leg_picks["body_call_ticker"],
                "body_put": leg_picks["body_put_ticker"],
                "wing_call": leg_picks["wing_call_ticker"],
                "wing_put": leg_picks["wing_put_ticker"],
            },
        }

    def _emit_signal(
        self, asof: date, plan: dict, cache: dict
    ) -> Optional[Signal]:
        p = self.params
        ids = plan["contract_ids"]
        exp = plan["expiration"]
        mult = 100

        legs = (
            OptionLeg(
                contract_id=ids["body_call"],
                side=Side.SELL,
                qty=1,
                underlying=plan["symbol"],
                expiry=exp,
                strike=Decimal(f"{plan['body_strike']:.4f}"),
                right="C",
                multiplier=mult,
            ),
            OptionLeg(
                contract_id=ids["body_put"],
                side=Side.SELL,
                qty=1,
                underlying=plan["symbol"],
                expiry=exp,
                strike=Decimal(f"{plan['body_strike']:.4f}"),
                right="P",
                multiplier=mult,
            ),
            OptionLeg(
                contract_id=ids["wing_call"],
                side=Side.BUY,
                qty=1,
                underlying=plan["symbol"],
                expiry=exp,
                strike=Decimal(f"{plan['wing_call_strike']:.4f}"),
                right="C",
                multiplier=mult,
            ),
            OptionLeg(
                contract_id=ids["wing_put"],
                side=Side.BUY,
                qty=1,
                underlying=plan["symbol"],
                expiry=exp,
                strike=Decimal(f"{plan['wing_put_strike']:.4f}"),
                right="P",
                multiplier=mult,
            ),
        )

        # Net spread price in $ per spread. We emit using a *synthetic*
        # symbol (``EVOL:<sym>:<expiry-yyyymmdd>``) so the engine's
        # multi-leg fill path uses our injected spread-price bar instead
        # of the underlying's stock price. The entry price has already
        # been registered with the synthetic ledger in ``universe()`` so
        # the engine's bar pull (step 2) sees the price.
        entry_net_px = plan["net_credit_per_contract"] * mult
        synth = plan.get("synthetic_symbol") or f"EVOL:{plan['symbol']}:{exp.strftime('%Y%m%d')}"
        register_synthetic_price(synth, asof, entry_net_px)

        sig = Signal(
            symbol=synth,
            quantity=-int(plan["contracts"]),    # short = negative spreads
            legs=legs,
            order_type=OrderType.MOC,
            time_in_force=TimeInForce.DAY,
            tag=f"earnings_vol-entry-{plan['symbol']}",
            asof=asof,
        )

        pending = cache.setdefault(f"{_NS}.pending", {})
        pending[synth] = _Pending(
            symbol=plan["symbol"],
            synthetic_symbol=synth,
            entry_date=asof,
            exit_date=plan["exit_date"],
            strike_body=plan["body_strike"],
            strike_wing_call=plan["wing_call_strike"],
            strike_wing_put=plan["wing_put_strike"],
            expiry=exp,
            entry_iv=plan["entry_iv"],
            entry_spread_px=plan["net_credit_per_contract"] * mult,
            contracts=int(plan["contracts"]),
            legs=legs,
            underlying_entry=plan["underlying_entry"],
            earnings_time=plan["earn_time"],
            exit_timing=str(p["exit_timing"]),
        )
        return sig

    # ================================================================== #
    # Historical move                                                    #
    # ================================================================== #
    def _historical_earnings_move(
        self, ctx: Context, symbol: str, asof: date
    ) -> Optional[float]:
        """Median |close_T / close_{T-1} - 1| across past earnings events.

        Returns ``None`` if too few events are observable.
        """

        p = self.params
        lookback_q = int(p["historical_moves_lookback_quarters"])
        min_events = int(p["min_historical_events"])

        ep = getattr(ctx, "earnings_provider", None)
        if ep is None:
            return None
        try:
            start = asof - timedelta(days=int(lookback_q * 100))  # ~1 quarter = 90d
            surprises = ep.surprises(symbol, start, asof)
        except Exception:
            surprises = None
        if surprises is None or len(surprises) == 0:
            return None

        dates = []
        for d in surprises.get("date", []):
            if d is None:
                continue
            if isinstance(d, pd.Timestamp):
                dates.append(d.date())
            elif isinstance(d, datetime):
                dates.append(d.date())
            elif isinstance(d, date):
                dates.append(d)
            else:
                try:
                    dates.append(pd.Timestamp(d).date())
                except Exception:
                    continue
        # Keep only historical (before asof) and sort descending.
        dates = sorted({d for d in dates if d < asof}, reverse=True)[:lookback_q]
        if len(dates) < min_events:
            return None

        bp = getattr(ctx, "bar_provider", None)
        if bp is None:
            return None

        # Fetch enough bars around the earliest event to compute close-to-close.
        earliest = min(dates) - timedelta(days=10)
        try:
            bars = bp.bars([symbol], earliest, asof, tf="1D")
        except Exception:
            return None
        if bars is None or len(bars) == 0:
            return None
        bars = pd.DataFrame(bars)
        cols = {c.lower(): c for c in bars.columns}
        sym_col = cols.get("symbol") or cols.get("ticker")
        ts_col = cols.get("timestamp") or cols.get("ts") or cols.get("date")
        if ts_col is None:
            return None
        if sym_col is not None:
            bars = bars[bars[sym_col].astype(str).str.upper() == symbol.upper()]
        if bars.empty:
            return None
        bars = bars.copy()
        bars["_date"] = pd.to_datetime(bars[ts_col]).dt.date
        bars = bars.sort_values("_date").reset_index(drop=True)
        closes = bars["close"].astype(float).to_numpy()
        dt_arr = bars["_date"].tolist()

        moves: list[float] = []
        for d in dates:
            # Find the row index whose date matches d, then (d-1 session) and
            # (d session) closes.  FMP's date can be the session *of* the
            # report (AMC) or the session *after* (BMO). Use the close of the
            # first post-event session relative to the pre-event session.
            try:
                idx = _find_nearest_session_idx(dt_arr, d)
            except ValueError:
                continue
            if idx is None or idx <= 0 or idx >= len(closes):
                continue
            prev_close = closes[idx - 1]
            post_close = closes[idx]
            if prev_close <= 0 or post_close <= 0:
                continue
            moves.append(abs(post_close / prev_close - 1.0))

        if len(moves) < min_events:
            return None
        return float(np.median(moves))

    # ================================================================== #
    # Synthetic exit premium                                             #
    # ================================================================== #
    def _synthetic_exit_net_premium(
        self, ctx: Context, pen: _Pending, asof: date
    ) -> Optional[float]:
        """Price the 4-leg butterfly on the exit bar using BS.

        Uses ``iv_crush_retention * entry_iv`` for post-event vol and the
        current underlying price (open if ``exit_timing == 'next_open'``,
        close otherwise).
        """

        p = self.params
        # Pull the underlying bar for asof.
        bp = getattr(ctx, "bar_provider", None)
        if bp is None:
            return None
        try:
            df = bp.bars([pen.symbol], asof, asof, tf="1D")
        except Exception:
            return None
        if df is None or len(df) == 0:
            return None
        df = pd.DataFrame(df)
        if df.empty:
            return None
        cols = {c.lower(): c for c in df.columns}
        sym_col = cols.get("symbol") or cols.get("ticker")
        if sym_col is not None:
            df = df[df[sym_col].astype(str).str.upper() == pen.symbol.upper()]
        if df.empty:
            return None
        row = df.iloc[0]
        if pen.exit_timing == "next_open":
            spot = float(row.get("open", row.get("Open", row.get("close", 0))))
        elif pen.exit_timing == "next_close":
            spot = float(row.get("close", row.get("Close", 0)))
        else:
            # "1h_after_open" — interpolate ~25% of range as a proxy
            open_px = float(row.get("open", row.get("Open", 0)))
            close_px = float(row.get("close", row.get("Close", open_px)))
            spot = 0.75 * open_px + 0.25 * close_px
        if spot <= 0:
            return None

        iv = max(1e-4, pen.entry_iv * float(p["iv_crush_retention"]))
        r = float(p["risk_free_rate"])
        tau = max(1.0 / _YEAR_DAYS, (pen.expiry - asof).days / _YEAR_DAYS)

        # Price each leg at exit IV. Remember: at exit we *buy* the body
        # back and *sell* the wings; the net premium we PAY per spread to
        # close is (body_call + body_put) - (wing_call + wing_put).
        body_call = bs_price(spot, pen.strike_body, tau, r, 0.0, iv, "call")
        body_put = bs_price(spot, pen.strike_body, tau, r, 0.0, iv, "put")
        wing_call = bs_price(spot, pen.strike_wing_call, tau, r, 0.0, iv, "call")
        wing_put = bs_price(spot, pen.strike_wing_put, tau, r, 0.0, iv, "put")

        net_per_contract = (body_call + body_put) - (wing_call + wing_put)
        return float(net_per_contract * 100)


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _get_events_on(ctx: Context, ep: Any, target: date) -> list[dict]:
    """Fetch the earnings events on ``target`` date.

    Returns a list of dicts with at least ``symbol`` and an ``eps_actual``
    / ``eps_estimated`` / ``last_updated`` if FMP supplies them. The caller
    classifies BMO/AMC via :func:`_classify_earnings_time`.
    """

    try:
        df = ep.calendar(target, target)
    except Exception:
        return []
    if df is None or len(df) == 0:
        return []
    df = pd.DataFrame(df)
    rows: list[dict] = []
    for _, r in df.iterrows():
        rows.append(dict(r))
    return rows


def _classify_earnings_time(event: Mapping[str, Any]) -> str:
    """Classify an FMP earnings event into before_open / after_close / unknown.

    FMP's canonical calendar includes a ``time`` column ("bmo"/"amc") in
    its premium feed. The free tier omits this. We best-effort classify
    from the ``last_updated`` or the report-vs-date heuristic (AMC events
    report the same day they are dated, BMO report the next session).

    Without explicit timing data we return "unknown" and let the caller
    decide; the ``earnings_timing_filter`` config handles the rest.
    """

    t = event.get("time") or event.get("announcement_time")
    if isinstance(t, str):
        low = t.strip().lower()
        if low in ("bmo", "before-market-open", "before_open", "before"):
            return "before_open"
        if low in ("amc", "after-market-close", "after_close", "after"):
            return "after_close"
        if low in ("dmh", "during", "market-hours"):
            return "during_hours"
    # Without time data, assume after_close (the dominant convention for
    # single-name earnings). This keeps the filter recall-friendly; the
    # richness ratio still gates final entry.
    return "after_close"


def _last_close(ctx: Context, symbol: str, asof: date) -> Optional[float]:
    bp = getattr(ctx, "bar_provider", None)
    if bp is None:
        return None
    try:
        df = bp.bars([symbol], asof - timedelta(days=7), asof, tf="1D")
    except Exception:
        return None
    if df is None or len(df) == 0:
        return None
    df = pd.DataFrame(df)
    cols = {c.lower(): c for c in df.columns}
    sym_col = cols.get("symbol") or cols.get("ticker")
    ts_col = cols.get("timestamp") or cols.get("ts") or cols.get("date")
    if sym_col is not None:
        df = df[df[sym_col].astype(str).str.upper() == symbol.upper()]
    if df.empty:
        return None
    if ts_col is not None:
        df = df.assign(_dt=pd.to_datetime(df[ts_col])).sort_values("_dt")
    close_col = cols.get("close")
    if close_col is None:
        return None
    try:
        return float(df[close_col].iloc[-1])
    except Exception:
        return None


def _select_expiration(chain: pd.DataFrame, asof: date, dte_target: int) -> Optional[date]:
    """Pick the expiration at or just after ``asof + dte_target`` calendar days."""

    if "expiration" not in chain.columns:
        return None
    exps = pd.to_datetime(chain["expiration"], errors="coerce").dropna().dt.date
    exps = sorted({e for e in exps if e > asof})
    if not exps:
        return None
    target = asof + timedelta(days=dte_target)
    # Take the closest expiration >= target (first eligible) or fall back
    # to the next-nearest one.
    for exp in exps:
        if exp >= target:
            return exp
    # None >= target — pick the furthest available.
    return exps[-1]


def _pick_leg_strikes(
    chain: pd.DataFrame,
    expiration: date,
    underlying: float,
    wing_width_abs: Optional[float],
) -> Optional[dict]:
    """Pick ATM and wing strikes from the chain for ``expiration``.

    Called twice during scoring: once without ``wing_width_abs`` (so we
    can price the ATM straddle and therefore compute the move) and once
    with it (to resolve wings).
    """

    sub = chain.copy()
    sub = sub[pd.to_datetime(sub["expiration"]).dt.date == expiration]
    if sub.empty:
        return None
    if "strike" not in sub.columns or "option_type" not in sub.columns:
        return None
    strikes = sorted({float(x) for x in sub["strike"] if x is not None})
    if not strikes:
        return None

    def _closest(target: float) -> Optional[float]:
        return min(strikes, key=lambda x: abs(x - target)) if strikes else None

    body = _closest(float(underlying))
    if body is None:
        return None

    if wing_width_abs is None:
        # First pass: only need the ATM.
        body_call_ticker = _find_ticker(sub, expiration, body, "call")
        body_put_ticker = _find_ticker(sub, expiration, body, "put")
        if body_call_ticker is None or body_put_ticker is None:
            return None
        return {
            "body_strike": body,
            "body_call_ticker": body_call_ticker,
            "body_put_ticker": body_put_ticker,
            "wing_call_strike": None,
            "wing_put_strike": None,
            "wing_call_ticker": None,
            "wing_put_ticker": None,
        }

    wing_call_target = body + wing_width_abs
    wing_put_target = body - wing_width_abs
    wing_call_strike = _closest(wing_call_target)
    wing_put_strike = _closest(wing_put_target)
    # Ensure strict ordering: wings outside the body.
    if wing_call_strike is None or wing_put_strike is None:
        return None
    if wing_call_strike <= body or wing_put_strike >= body:
        # Try nearest higher / lower.
        above = [s for s in strikes if s > body]
        below = [s for s in strikes if s < body]
        if not above or not below:
            return None
        wing_call_strike = min(above, key=lambda x: abs(x - wing_call_target))
        wing_put_strike = max(below, key=lambda x: abs(x - wing_put_target))

    body_call_ticker = _find_ticker(sub, expiration, body, "call")
    body_put_ticker = _find_ticker(sub, expiration, body, "put")
    wing_call_ticker = _find_ticker(sub, expiration, wing_call_strike, "call")
    wing_put_ticker = _find_ticker(sub, expiration, wing_put_strike, "put")
    if None in (body_call_ticker, body_put_ticker, wing_call_ticker, wing_put_ticker):
        return None
    return {
        "body_strike": body,
        "body_call_ticker": body_call_ticker,
        "body_put_ticker": body_put_ticker,
        "wing_call_strike": wing_call_strike,
        "wing_put_strike": wing_put_strike,
        "wing_call_ticker": wing_call_ticker,
        "wing_put_ticker": wing_put_ticker,
    }


def _find_ticker(
    chain: pd.DataFrame, expiration: date, strike: float, right: str
) -> Optional[str]:
    sub = chain[
        (pd.to_datetime(chain["expiration"]).dt.date == expiration)
        & (pd.to_numeric(chain["strike"], errors="coerce") == strike)
        & (chain["option_type"].astype(str).str.lower() == right.lower())
    ]
    if sub.empty:
        # Fall back to closest strike match.
        closest = chain.assign(
            _d=pd.to_numeric(chain["strike"], errors="coerce").sub(strike).abs()
        ).pipe(
            lambda d: d[
                (pd.to_datetime(d["expiration"]).dt.date == expiration)
                & (d["option_type"].astype(str).str.lower() == right.lower())
            ]
        )
        if closest.empty:
            return None
        closest = closest.sort_values("_d").head(1)
        t = closest.get("contract_ticker")
        if t is None or t.empty:
            return None
        return str(t.iloc[0])
    t = sub.get("contract_ticker")
    if t is None or t.empty:
        return None
    return str(t.iloc[0])


def _leg_mid(
    chain: pd.DataFrame, expiration: date, strike: float, right: str,
    *,
    options_provider: Any = None,
    asof: Optional[date] = None,
) -> Optional[float]:
    """Best-effort mid price for a leg.

    Tries in order:
      1. chain bid/ask mid (live snapshot case; usually empty on historical)
      2. chain ``last`` (if the snapshot carries last trade)
      3. ``contract_bars`` close for the contract on ``asof`` (historical)

    The third path is needed because Polygon's Developer tier strips
    bid/ask/iv/greeks from the ``/v3/reference/options/contracts`` historical
    chain endpoint; the per-contract aggregates endpoint still returns
    daily close, which is our best historical mid proxy.
    """
    sub = chain[
        (pd.to_datetime(chain["expiration"]).dt.date == expiration)
        & (pd.to_numeric(chain["strike"], errors="coerce").round(4) == round(strike, 4))
        & (chain["option_type"].astype(str).str.lower() == right.lower())
    ]
    if sub.empty:
        return None
    row = sub.iloc[0]
    bid = row.get("bid")
    ask = row.get("ask")
    last = row.get("last")
    try:
        bid_f = float(bid) if bid is not None and not pd.isna(bid) else None
    except Exception:
        bid_f = None
    try:
        ask_f = float(ask) if ask is not None and not pd.isna(ask) else None
    except Exception:
        ask_f = None
    if bid_f is not None and ask_f is not None and ask_f >= bid_f > 0:
        return 0.5 * (bid_f + ask_f)
    try:
        last_f = float(last) if last is not None and not pd.isna(last) else None
    except Exception:
        last_f = None
    if last_f is not None and last_f > 0:
        return last_f

    # Historical path: use contract_bars close as mid proxy.
    if options_provider is not None and asof is not None:
        ticker = row.get("contract_ticker")
        if ticker:
            close = contract_close(options_provider, str(ticker), asof)
            if close is not None and close > 0:
                return close
    return None


def _straddle_mid(
    chain: pd.DataFrame, expiration: date, strike: float,
    *,
    options_provider: Any = None,
    asof: Optional[date] = None,
) -> Optional[float]:
    c = _leg_mid(
        chain, expiration, strike, "call",
        options_provider=options_provider, asof=asof,
    )
    p = _leg_mid(
        chain, expiration, strike, "put",
        options_provider=options_provider, asof=asof,
    )
    if c is None or p is None or c <= 0 or p <= 0:
        return None
    return c + p


def _wing_spread_too_wide(
    chain: pd.DataFrame,
    expiration: date,
    wing_call_strike: float,
    wing_put_strike: float,
) -> bool:
    for strike, right in ((wing_call_strike, "call"), (wing_put_strike, "put")):
        sub = chain[
            (pd.to_datetime(chain["expiration"]).dt.date == expiration)
            & (pd.to_numeric(chain["strike"], errors="coerce").round(4) == round(strike, 4))
            & (chain["option_type"].astype(str).str.lower() == right.lower())
        ]
        if sub.empty:
            continue
        row = sub.iloc[0]
        try:
            bid_f = float(row.get("bid")) if row.get("bid") is not None else None
            ask_f = float(row.get("ask")) if row.get("ask") is not None else None
        except Exception:
            return False
        if bid_f is None or ask_f is None or bid_f <= 0 or ask_f <= 0:
            # No quotes — treat as non-wide (accept).
            continue
        mid = 0.5 * (bid_f + ask_f)
        if mid <= 0:
            continue
        width = (ask_f - bid_f) / mid
        if width > _MAX_WIDE_SPREAD_PCT:
            return True
    return False


def _find_nearest_session_idx(dates: list, target: date) -> Optional[int]:
    """Return the index of the first session date >= target, else None."""

    for i, d in enumerate(dates):
        if d >= target:
            return i
    return None


def _upcoming_fridays(asof: date, count: int) -> list[date]:
    """Return the next ``count`` Fridays after ``asof`` (inclusive)."""
    out: list[date] = []
    d = asof + timedelta(days=1)
    while len(out) < count:
        if d.weekday() == 4:
            out.append(d)
        d += timedelta(days=1)
    return out


def _next_session(asof: date, ctx: Context) -> date:
    """Next trading session after ``asof`` — best-effort.

    Uses a Mon-Fri business-day calendar when no provider is available.
    """

    cal = getattr(ctx, "calendar_provider", None)
    if cal is not None and hasattr(cal, "sessions"):
        try:
            sess = list(cal.sessions(asof, asof + timedelta(days=10)))
            for s in sess:
                if isinstance(s, datetime):
                    s = s.date()
                if s > asof:
                    return s
        except Exception:
            pass
    # Fallback: skip weekends.
    nxt = asof + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def _exit_order_type(exit_timing: str) -> OrderType:
    if exit_timing == "next_open":
        return OrderType.MOO
    if exit_timing == "next_close":
        return OrderType.MOC
    # 1h_after_open — approximate with MOO (intraday limits unsupported in
    # the daily engine).
    return OrderType.MOO


__all__ = ["EarningsVolStrategy"]
