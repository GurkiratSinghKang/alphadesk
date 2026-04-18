"""VRP Harvest — short SPY strangle with long far-OTM put tail hedge.

Textbook systematic short-vol on SPY. Signal is VRP = IV_30d_ATM -
HV_realized_20d; entry gate also requires term contango and IV below a
crisis kill-switch. Position is a 16-delta strangle ~30 DTE alongside an
optional 5-delta far-OTM put (1 put per N strangles). Exits: 50 % max
profit, 21 DTE, 200 % loss stop, VIX kill switch.

Engine integration
------------------
The strategy emits regular multi-leg :class:`Signal`s that the AlphaDesk
backtest engine prices via :class:`ExecutionSimulator._fill_multileg_option`.
Each leg's per-contract premium is fetched from the options provider's
``contract_bars`` endpoint; there is no synthetic P&L ledger inside the
strategy. The strategy's :meth:`manage` reads
:attr:`Context.positions` directly (one :class:`Position` per option leg,
``AssetClass.OPTION``) to drive TP/SL/DTE decisions.

We still keep an in-strategy ledger of ``PositionRecord`` entries — not
for cash accounting, but to group legs into a logical "strangle" and
remember entry metadata (strikes, expiry, credit received) that
per-leg Positions do not carry on their own.

Data contracts:
- ``ctx.options_provider.chain_snapshot(underlying, asof)`` — returns a
  DataFrame with at least columns
  ``[contract_ticker, expiration, strike, option_type, bid, ask, last,
    iv, delta, gamma, theta, vega]``.
- ``ctx.options_provider.contract_bars(contract, start, end)`` — daily
  aggregates for a specific option contract. Used by the engine for
  per-leg fill pricing.
- ``ctx.bar_provider.bars([underlying], asof, asof, tf='1D')`` — returns
  a DataFrame with OHLCV columns for the underlying.

All numeric state that survives between bars lives on
``ctx.state["vrp_harvest.*"]``.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from indicators.options import (
    bs_greeks,
    bs_price,
    iv_from_price,
)
from indicators.volatility import hv
from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OptionLeg, OrderType, Side, Signal, TimeInForce

from .config import DEFAULTS, UNDERLYING, search_space


log = logging.getLogger("alphadesk.strategies.vrp_harvest")


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim tolerant of double-loading.

    Same pattern as the rest of the Phase 1 packages.
    """

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
# Constants                                                                   #
# --------------------------------------------------------------------------- #
_NS = "vrp_harvest"
# Need ~60 trading days of SPY closes for HV(20) + margin + warmup for the
# first entry. 120 calendar days ~= 83 trading days — comfortable.
_REQUIRED_LOOKBACK_DAYS = 120
# Hard minimum number of trading bars we require before computing VRP. If the
# engine's warmup fetched fewer we skip the bar.
_MIN_TRADING_BARS = 30
_TRADING_DAYS_YEAR = 252.0
_CALENDAR_DAYS_YEAR = 365.0


# --------------------------------------------------------------------------- #
# Position / leg dataclasses                                                  #
# --------------------------------------------------------------------------- #
@dataclass
class LegRecord:
    """One option leg snapshotted at entry + revalued every bar."""

    contract_id: str
    side: str  # "buy" / "sell"
    qty_per_spread: int
    strike: float
    expiry: date
    right: str  # "C" / "P"
    iv_entry: float
    mid_entry: float

    def tau(self, asof: date) -> float:
        days = max(0, (self.expiry - asof).days)
        return days / _CALENDAR_DAYS_YEAR


@dataclass
class PositionRecord:
    """One short strangle (optionally with a long tail-put wing)."""

    pos_id: str
    opened_on: date
    n_spreads: int
    legs: list[LegRecord]
    credit_per_spread: float  # net credit collected per 1 spread at entry
    expiry: date
    tag: str = ""
    closed_on: Optional[date] = None
    exit_reason: str = ""
    exit_debit_per_spread: Optional[float] = None  # what we paid to close

    def days_to_expiry(self, asof: date) -> int:
        return (self.expiry - asof).days

    @property
    def is_open(self) -> bool:
        return self.closed_on is None


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="vrp_harvest",
    category="options",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=1,
    supports_shorts=True,
    supports_options=True,
    description=(
        "Systematic short SPY strangle with long far-OTM put tail hedge. "
        "Enters when VRP = IV_30 - HV_20 > threshold and term contango; "
        "manages via 50% TP / 21-DTE / 200% SL / VIX kill switch."
    ),
)
class VRPHarvestStrategy:
    """Short 16-delta SPY strangle + optional long 5-delta put wing."""

    name = "vrp_harvest"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        """Merge tuner/user overrides onto the defaults and coerce types."""

        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v

        # Numeric coercion.
        for k in (
            "vrp_entry_threshold",
            "min_iv_30",
            "strangle_delta",
            "theta_target_pct",
            "tp_pct",
            "sl_pct",
            "vix_kill_switch",
            "tail_hedge_delta",
            "risk_free_rate",
            "dividend_yield",
        ):
            merged[k] = float(merged[k])
        for k in (
            "target_dte",
            "exit_dte",
            "tail_hedge_ratio",
            "entry_cooldown_days",
            "hv_period",
            "max_spreads_per_entry",
        ):
            merged[k] = int(merged[k])
        merged["term_structure_gate"] = bool(merged["term_structure_gate"])
        merged["underlying"] = str(merged.get("underlying", UNDERLYING)).upper()
        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        """We only trade SPY — but the engine needs the underlying ticker."""

        return [self.params["underlying"]]

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        sym = p["underlying"]
        cache = cache_of(ctx)

        # Cooldown: don't stack entries when one just fired.
        last_entry: Optional[date] = cache.get(f"{_NS}.last_entry_date")
        if last_entry is not None:
            if (asof - last_entry).days < int(p["entry_cooldown_days"]):
                return []

        # If we already hold any open VRP position, don't stack more.
        if _open_positions(cache):
            return []

        # Kill switch: no entries when IV is crisis-high.
        spot = self._spot_price(ctx, sym, asof)
        if spot is None:
            return []

        chain = self._chain_snapshot(ctx, sym, asof)
        if chain is None or chain.empty:
            return []

        # Compute ATM 30DTE IV (our VIX proxy).
        iv_30 = self._atm_iv(chain, spot, target_dte=30, asof=asof)
        if iv_30 is None or not math.isfinite(iv_30):
            return []
        if iv_30 >= float(p["vix_kill_switch"]):
            log.debug(
                "vrp_harvest: kill-switch active iv_30=%.3f >= %.3f",
                iv_30,
                float(p["vix_kill_switch"]),
            )
            return []
        if iv_30 < float(p["min_iv_30"]):
            return []

        # Compute realized HV(20).
        hv_20 = self._hv_20(ctx, sym, asof)
        if hv_20 is None or not math.isfinite(hv_20):
            return []

        vrp = iv_30 - hv_20
        if vrp < float(p["vrp_entry_threshold"]):
            return []

        # Term-structure gate (front - back). Positive = backwardation.
        if bool(p["term_structure_gate"]):
            slope = self._term_structure_slope(chain, spot, asof)
            if slope is not None and slope > 0:
                log.debug(
                    "vrp_harvest: skip backwardation slope=%.4f",
                    slope,
                )
                return []

        # Build the strangle.
        strangle = self._build_strangle(chain, spot, asof, p, iv_30)
        if strangle is None:
            return []

        leg_records, credit_per_spread, per_strangle_theta = strangle

        # Optional tail hedge: long 5-delta put at same target DTE.
        hedge_leg: Optional[LegRecord] = None
        if int(p["tail_hedge_ratio"]) > 0:
            hedge_leg = self._find_tail_hedge(chain, spot, asof, p, iv_30)
            # Hedge is a ratio: we still size the strangle off theta and then
            # add ceil(n_strangles / ratio) puts.

        # Theta-target sizing.
        n_spreads = self._size_by_theta(
            equity=float(ctx.equity),
            per_strangle_theta=per_strangle_theta,
            max_spreads=int(p["max_spreads_per_entry"]),
            theta_target_pct=float(p["theta_target_pct"]),
        )
        if n_spreads <= 0:
            return []

        # Hedge quantity.
        n_hedge = 0
        if hedge_leg is not None:
            n_hedge = max(1, (n_spreads + int(p["tail_hedge_ratio"]) - 1) // int(p["tail_hedge_ratio"]))

        # Build the engine-visible multi-leg Signal.
        legs_tuple: list[OptionLeg] = []
        for lr in leg_records:
            legs_tuple.append(
                OptionLeg(
                    contract_id=lr.contract_id,
                    side=Side.SELL if lr.side == "sell" else Side.BUY,
                    qty=int(lr.qty_per_spread),
                    limit_price=Decimal(str(lr.mid_entry)),
                    underlying=sym,
                    expiry=lr.expiry,
                    strike=Decimal(str(lr.strike)),
                    right=lr.right,
                )
            )

        # Tail hedge as a *separate* line item in our internal record so we
        # can close it independently if the strangle exits early. But it
        # goes on the same Signal if present, at qty=n_hedge (per spread,
        # the engine sizes legs at `signal.quantity * leg.qty`, so we use
        # a separate Signal for the hedge to keep sizing flexible).

        # Net premium for the strangle only (credit received → positive
        # number we *receive*; the engine convention: SELL side increases
        # cash by `quantity * price`, so we pass `limit_price` = the
        # absolute credit per spread, and use Side.SELL at the Signal
        # level → quantity>0 but we tag the combined legs' net with
        # signal.limit_price).
        # The engine's `_queue_signal` for `legs` path requires
        # `signal.quantity` to be nonzero (it sets Side from the sign).
        # For short-premium we use quantity = -n_spreads (sign carries
        # the SELL direction for the composite).

        strangle_signal = Signal(
            symbol=sym,
            quantity=-int(n_spreads),
            legs=tuple(legs_tuple),
            order_type=OrderType.MOC,
            time_in_force=TimeInForce.DAY,
            limit_price=Decimal(str(credit_per_spread)),
            tag=f"{_NS}-enter",
            asof=asof,
        )

        # Record our internal state for `manage()` to consult. The engine
        # owns cashflow via Portfolio; this ledger only tracks metadata
        # needed for grouping legs into a logical strangle and for
        # management decisions (credit level, expiry, n_spreads).
        pos_id = f"vrp_{asof.isoformat()}"
        rec = PositionRecord(
            pos_id=pos_id,
            opened_on=asof,
            n_spreads=int(n_spreads),
            legs=list(leg_records),
            credit_per_spread=float(credit_per_spread),
            expiry=leg_records[0].expiry,
            tag=f"{_NS}-strangle",
        )
        _save_position(cache, rec)
        cache[f"{_NS}.last_entry_date"] = asof

        out: list[Signal] = [strangle_signal]
        if hedge_leg is not None and n_hedge > 0:
            hedge_legs = (
                OptionLeg(
                    contract_id=hedge_leg.contract_id,
                    side=Side.BUY,
                    qty=1,
                    limit_price=Decimal(str(hedge_leg.mid_entry)),
                    underlying=sym,
                    expiry=hedge_leg.expiry,
                    strike=Decimal(str(hedge_leg.strike)),
                    right=hedge_leg.right,
                ),
            )
            hedge_signal = Signal(
                symbol=sym,
                quantity=int(n_hedge),  # long = positive
                legs=hedge_legs,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                limit_price=Decimal(str(hedge_leg.mid_entry)),
                tag=f"{_NS}-tailhedge",
                asof=asof,
            )
            hedge_rec = PositionRecord(
                pos_id=f"vrp_hedge_{asof.isoformat()}",
                opened_on=asof,
                n_spreads=int(n_hedge),
                legs=[hedge_leg],
                credit_per_spread=-float(hedge_leg.mid_entry),  # debit
                expiry=hedge_leg.expiry,
                tag=f"{_NS}-hedge",
            )
            _save_position(cache, hedge_rec)
            out.append(hedge_signal)
        return out

    # ------------------------------------------------------------------ #
    # Management / exits
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        sym = p["underlying"]
        cache = cache_of(ctx)

        positions: list[PositionRecord] = _open_positions(cache)
        if not positions:
            return []

        spot = self._spot_price(ctx, sym, asof)
        chain = self._chain_snapshot(ctx, sym, asof)

        out: list[Signal] = []

        # Compute kill-switch once.
        iv_30: Optional[float] = None
        if chain is not None and not chain.empty and spot is not None:
            iv_30 = self._atm_iv(chain, spot, target_dte=30, asof=asof)

        kill_active = (
            iv_30 is not None and iv_30 >= float(p["vix_kill_switch"])
        )

        for rec in positions:
            dte = rec.days_to_expiry(asof)

            # Re-price every leg.
            if spot is None:
                # Can't mark; keep the position.
                continue

            per_spread_mid = self._revalue_legs(
                rec.legs, spot, asof, chain, p
            )
            if per_spread_mid is None:
                continue

            # For a short strangle the "credit" is what we received; the
            # current cost to close is the current net mid of the same
            # legs (positive = we'd pay to buy back). The strangle is a
            # net-short premium position: credit_per_spread > 0 at entry.
            # For a long put hedge: credit_per_spread < 0 (we paid).
            is_short_premium = rec.credit_per_spread > 0

            if is_short_premium:
                current_cost = per_spread_mid  # cost to buy back
                credit = rec.credit_per_spread
                # Profit if we close = credit - current_cost (per spread).
                pnl_per_spread = credit - current_cost
                # pnl_per_spread / credit tells us where we are on the
                # strangle-management scale:
                # - 1.0 = all profit (legs worthless)
                # - 0.5 = 50% max profit
                # - 0.0 = breakeven
                # - -sl_pct = 200% loss (cost = 3x credit)
                profit_ratio = pnl_per_spread / max(credit, 1e-9)
                loss_mult = (current_cost - credit) / max(credit, 1e-9)
            else:
                # Long put hedge: "credit" is negative (= -debit).
                debit = -rec.credit_per_spread
                current_value = per_spread_mid
                pnl_per_spread = current_value - debit
                profit_ratio = pnl_per_spread / max(debit, 1e-9)
                loss_mult = -profit_ratio

            # Decide the reason to close.
            reason: Optional[str] = None
            if kill_active:
                reason = "vix-kill-switch"
            elif is_short_premium and profit_ratio >= float(p["tp_pct"]):
                reason = "tp-profit"
            elif is_short_premium and loss_mult >= float(p["sl_pct"]):
                reason = "sl-loss"
            elif dte <= int(p["exit_dte"]):
                reason = "dte-roll"
            elif dte <= 0:
                reason = "expiry"

            if reason is None:
                continue

            # Close: emit an opposing Signal. For short premium positions
            # the legs reverse side; for the long put hedge the side
            # reverses too.
            closing_legs: list[OptionLeg] = []
            for lr in rec.legs:
                opposite = "buy" if lr.side == "sell" else "sell"
                closing_legs.append(
                    OptionLeg(
                        contract_id=lr.contract_id,
                        side=Side.BUY if opposite == "buy" else Side.SELL,
                        qty=int(lr.qty_per_spread),
                        limit_price=Decimal(str(per_spread_mid / max(len(rec.legs), 1))),
                        underlying=sym,
                        expiry=lr.expiry,
                        strike=Decimal(str(lr.strike)),
                        right=lr.right,
                    )
                )

            # Signed quantity: +n if we originally shorted (now buying to
            # close), -n if we originally bought.
            qty_signed = +int(rec.n_spreads) if is_short_premium else -int(rec.n_spreads)
            exit_signal = Signal(
                symbol=sym,
                quantity=qty_signed,
                legs=tuple(closing_legs),
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                limit_price=Decimal(str(per_spread_mid)),
                tag=f"{_NS}-exit-{reason}",
                asof=asof,
            )
            out.append(exit_signal)

            # Mark the record as closed in our ledger (updated on the
            # next bar's on_fill; we do it here to avoid re-emitting the
            # exit repeatedly).
            rec.closed_on = asof
            rec.exit_reason = reason
            rec.exit_debit_per_spread = float(per_spread_mid)
        _flush_positions(cache, positions)
        return out

    # ------------------------------------------------------------------ #
    # Fills
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Any, ctx: Context) -> None:
        # All multi-leg bookkeeping is maintained inside generate_signals /
        # manage; the engine handles cash deltas from the fill.
        return None

    # ================================================================== #
    # Internals
    # ================================================================== #
    # --- Data access ---------------------------------------------------- #
    def _spot_price(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[float]:
        provider = getattr(ctx, "bar_provider", None)
        if provider is None:
            return None
        cache = cache_of(ctx)
        price_cache: dict[tuple, float] = cache.setdefault(
            f"{_NS}.spot_cache", {}
        )
        key = (sym, asof)
        if key in price_cache:
            return price_cache[key]
        # Pull a wider window once so HV(20) has its lookback cached.
        long_key = f"{_NS}.bars:{sym}"
        long_df: Optional[pd.DataFrame] = cache.get(long_key)
        needs_fetch = (
            long_df is None
            or long_df.empty
            or pd.Timestamp(long_df["ts"].iloc[-1]).date() < asof
        )
        if needs_fetch:
            try:
                start = asof - timedelta(days=self.required_lookback_days + 60)
                end = asof + timedelta(days=10)
                raw = provider.bars([sym], start, end, tf="1D")
                if raw is None:
                    long_df = None
                else:
                    df = pd.DataFrame(raw)
                    if df.empty:
                        long_df = df
                    else:
                        cols = {c.lower(): c for c in df.columns}
                        sym_col = cols.get("symbol") or cols.get("ticker")
                        ts_col = cols.get("ts") or cols.get("timestamp") or cols.get("date")
                        close_col = cols.get("close")
                        if sym_col is None or ts_col is None or close_col is None:
                            long_df = None
                        else:
                            sub = df[df[sym_col].astype(str).str.upper() == sym]
                            long_df = pd.DataFrame(
                                {
                                    "ts": pd.to_datetime(sub[ts_col], utc=True, errors="coerce"),
                                    "close": pd.to_numeric(sub[close_col], errors="coerce"),
                                }
                            ).dropna(subset=["ts", "close"])
                            long_df["ts_date"] = long_df["ts"].dt.tz_convert("UTC").dt.date
                            long_df = long_df.sort_values("ts").reset_index(drop=True)
                cache[long_key] = long_df
            except Exception:
                log.exception("vrp_harvest: bar fetch failed for %s %s", sym, asof)
                return None
        if long_df is None or long_df.empty:
            return None
        sub = long_df[long_df["ts_date"] <= asof]
        if sub.empty:
            return None
        spot = float(sub["close"].iloc[-1])
        price_cache[key] = spot
        return spot

    def _hv_20(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[float]:
        cache = cache_of(ctx)
        long_df: Optional[pd.DataFrame] = cache.get(f"{_NS}.bars:{sym}")
        if long_df is None:
            # Force a fetch via _spot_price.
            _ = self._spot_price(ctx, sym, asof)
            long_df = cache.get(f"{_NS}.bars:{sym}")
        if long_df is None or long_df.empty:
            return None
        sub = long_df[long_df["ts_date"] <= asof]
        if len(sub) < max(_MIN_TRADING_BARS, int(self.params["hv_period"]) + 2):
            return None
        series = sub["close"].astype(float).reset_index(drop=True)
        hv_series = hv(series, period=int(self.params["hv_period"]), annualize=True)
        if hv_series.empty or pd.isna(hv_series.iloc[-1]):
            return None
        return float(hv_series.iloc[-1])

    def _chain_snapshot(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[pd.DataFrame]:
        provider = getattr(ctx, "options_provider", None)
        if provider is None:
            return None
        cache = cache_of(ctx)
        ck = f"{_NS}.chain:{sym}:{asof.isoformat()}"
        if ck in cache:
            return cache[ck]
        # If the provider exposes a set_spot() hint (BoundedPolygonOptionsProvider),
        # give it the spot so it can narrow the strike range on the
        # historical contracts endpoint.
        if hasattr(provider, "set_spot"):
            spot = self._spot_price(ctx, sym, asof)
            if spot is not None:
                try:
                    provider.set_spot(sym, asof, float(spot))
                except Exception:
                    pass
        try:
            df = provider.chain_snapshot(sym, asof)
        except Exception:
            log.exception("vrp_harvest: chain_snapshot raised for %s %s", sym, asof)
            cache[ck] = None
            return None
        if df is None:
            cache[ck] = None
            return None
        df = pd.DataFrame(df)
        if df.empty:
            cache[ck] = df
            return df
        # Normalize column names we rely on.
        df = df.copy()
        df["expiration"] = pd.to_datetime(df["expiration"]).dt.date
        df["option_type"] = df["option_type"].astype(str).str.lower()
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
        for c in ("bid", "ask", "last", "iv", "delta", "gamma", "theta", "vega"):
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.dropna(subset=["strike", "expiration", "option_type"])
        cache[ck] = df
        return df

    # --- IV / term structure helpers ------------------------------------ #
    def _atm_iv(
        self,
        chain: pd.DataFrame,
        spot: float,
        *,
        target_dte: int,
        asof: date,
    ) -> Optional[float]:
        """Implied vol of the strike closest to ``spot`` for the expiration
        closest to ``target_dte``, averaged across call + put.
        """

        if chain is None or chain.empty or spot is None:
            return None
        exp = self._closest_expiration(chain, asof, target_dte)
        if exp is None:
            return None
        sub = chain[chain["expiration"] == exp]
        if sub.empty:
            return None
        sub = sub.assign(d=(sub["strike"].astype(float) - spot).abs())
        atm_strike = float(sub.nsmallest(1, "d")["strike"].iloc[0])
        legs = sub[sub["strike"].astype(float) == atm_strike]
        ivs: list[float] = []
        for _, row in legs.iterrows():
            iv = self._leg_iv(row, spot, asof, exp)
            if iv is not None and math.isfinite(iv) and iv > 0:
                ivs.append(iv)
        if not ivs:
            return None
        return float(np.mean(ivs))

    def _term_structure_slope(
        self, chain: pd.DataFrame, spot: float, asof: date
    ) -> Optional[float]:
        """ATM 30DTE IV minus ATM 60DTE IV. Positive => backwardation."""

        front = self._atm_iv(chain, spot, target_dte=30, asof=asof)
        back = self._atm_iv(chain, spot, target_dte=60, asof=asof)
        if front is None or back is None:
            return None
        return float(front - back)

    def _leg_iv(
        self,
        row: pd.Series,
        spot: float,
        asof: date,
        exp: date,
    ) -> Optional[float]:
        """Return a usable IV for one chain row, preferring snapshot IV."""

        iv = row.get("iv", None)
        if iv is not None and pd.notna(iv) and iv > 0:
            return float(iv)

        # Solve from mid-price.
        bid = row.get("bid", None)
        ask = row.get("ask", None)
        last = row.get("last", None)
        mid: Optional[float] = None
        if bid is not None and ask is not None and pd.notna(bid) and pd.notna(ask):
            if float(bid) > 0 and float(ask) > 0:
                mid = (float(bid) + float(ask)) / 2.0
        if mid is None and last is not None and pd.notna(last) and float(last) > 0:
            mid = float(last)
        if mid is None:
            return None

        days = max(1, (exp - asof).days)
        tau = days / _CALENDAR_DAYS_YEAR
        right = str(row["option_type"]).lower()
        call_put = "call" if right.startswith("c") else "put"
        p = self.params
        try:
            iv_solved = iv_from_price(
                price=float(mid),
                spot=float(spot),
                strike=float(row["strike"]),
                tau=tau,
                r=float(p["risk_free_rate"]),
                q=float(p["dividend_yield"]),
                call_put=call_put,
            )
        except Exception:
            return None
        if iv_solved is None or not math.isfinite(iv_solved) or iv_solved <= 0:
            return None
        return float(iv_solved)

    def _closest_expiration(
        self, chain: pd.DataFrame, asof: date, target_dte: int
    ) -> Optional[date]:
        if chain is None or chain.empty:
            return None
        expirations = sorted({e for e in chain["expiration"].unique() if e is not None})
        # Only consider expirations strictly in the future.
        future = [e for e in expirations if (e - asof).days > 0]
        if not future:
            return None
        return min(future, key=lambda e: abs((e - asof).days - target_dte))

    # --- Strangle construction ----------------------------------------- #
    def _build_strangle(
        self,
        chain: pd.DataFrame,
        spot: float,
        asof: date,
        p: Mapping[str, Any],
        iv_30: float,
    ) -> Optional[tuple[list[LegRecord], float, float]]:
        """Pick the 16-delta call + put for the target expiration.

        Returns ``(legs, credit_per_spread, per_strangle_abs_theta)``.
        """

        target_delta = float(p["strangle_delta"])
        target_dte = int(p["target_dte"])

        exp = self._closest_expiration(chain, asof, target_dte)
        if exp is None:
            return None
        sub = chain[chain["expiration"] == exp]
        if sub.empty:
            return None

        tau = max(1, (exp - asof).days) / _CALENDAR_DAYS_YEAR

        call_leg = self._pick_leg_by_delta(
            sub[sub["option_type"].str.startswith("c")],
            spot,
            asof,
            exp,
            target_delta,
            side_side="sell",
            right="C",
            tau=tau,
            p=p,
        )
        put_leg = self._pick_leg_by_delta(
            sub[sub["option_type"].str.startswith("p")],
            spot,
            asof,
            exp,
            target_delta,
            side_side="sell",
            right="P",
            tau=tau,
            p=p,
        )
        if call_leg is None or put_leg is None:
            return None

        credit_per_spread = float(call_leg.mid_entry) + float(put_leg.mid_entry)
        if credit_per_spread <= 0:
            return None

        # Per-spread theta magnitude (sum of |theta| on both short legs).
        greeks_call = bs_greeks(
            spot=spot,
            strike=call_leg.strike,
            tau=tau,
            r=float(p["risk_free_rate"]),
            q=float(p["dividend_yield"]),
            sigma=max(call_leg.iv_entry, 1e-3),
            call_put="call",
        )
        greeks_put = bs_greeks(
            spot=spot,
            strike=put_leg.strike,
            tau=tau,
            r=float(p["risk_free_rate"]),
            q=float(p["dividend_yield"]),
            sigma=max(put_leg.iv_entry, 1e-3),
            call_put="put",
        )
        theta_call = abs(greeks_call["theta"]) / _CALENDAR_DAYS_YEAR  # per day
        theta_put = abs(greeks_put["theta"]) / _CALENDAR_DAYS_YEAR
        per_strangle_theta = (theta_call + theta_put) * 100.0  # per 100-share contract

        return [call_leg, put_leg], credit_per_spread, per_strangle_theta

    def _find_tail_hedge(
        self,
        chain: pd.DataFrame,
        spot: float,
        asof: date,
        p: Mapping[str, Any],
        iv_30: float,
    ) -> Optional[LegRecord]:
        target_delta = float(p["tail_hedge_delta"])
        target_dte = int(p["target_dte"])
        exp = self._closest_expiration(chain, asof, target_dte)
        if exp is None:
            return None
        sub = chain[(chain["expiration"] == exp) & (chain["option_type"].str.startswith("p"))]
        if sub.empty:
            return None
        tau = max(1, (exp - asof).days) / _CALENDAR_DAYS_YEAR
        leg = self._pick_leg_by_delta(
            sub,
            spot,
            asof,
            exp,
            target_delta,
            side_side="buy",
            right="P",
            tau=tau,
            p=p,
        )
        return leg

    def _pick_leg_by_delta(
        self,
        sub: pd.DataFrame,
        spot: float,
        asof: date,
        exp: date,
        target_delta: float,
        side_side: str,
        right: str,
        tau: float,
        p: Mapping[str, Any],
    ) -> Optional[LegRecord]:
        """Pick the strike whose |delta| is closest to ``target_delta``.

        ``target_delta`` is positive. We compute delta from Black-Scholes
        using the solved IV for each row, because Polygon's historical
        contracts endpoint doesn't return Greeks.
        """

        call_put = "call" if right == "C" else "put"
        best: Optional[tuple[float, pd.Series, float, float]] = None  # (dist, row, iv, mid)
        for _, row in sub.iterrows():
            iv = self._leg_iv(row, spot, asof, exp)
            if iv is None or iv <= 0:
                continue
            try:
                greeks = bs_greeks(
                    spot=float(spot),
                    strike=float(row["strike"]),
                    tau=tau,
                    r=float(p["risk_free_rate"]),
                    q=float(p["dividend_yield"]),
                    sigma=iv,
                    call_put=call_put,
                )
            except Exception:
                continue
            d = abs(greeks["delta"])
            dist = abs(d - float(target_delta))
            # Mid-price: use snapshot bid/ask/last if available else BS price.
            mid = self._leg_mid(row, spot, float(row["strike"]), tau, iv, call_put, p)
            if mid is None:
                continue
            if best is None or dist < best[0]:
                best = (dist, row, iv, mid)
        if best is None:
            return None
        _, row, iv, mid = best
        ct = str(row.get("contract_ticker") or row.get("contract") or f"O:SPY:{exp}:{right}:{row['strike']}")
        return LegRecord(
            contract_id=str(ct),
            side=side_side,
            qty_per_spread=1,
            strike=float(row["strike"]),
            expiry=exp,
            right=right,
            iv_entry=float(iv),
            mid_entry=float(mid),
        )

    def _leg_mid(
        self,
        row: pd.Series,
        spot: float,
        strike: float,
        tau: float,
        iv: float,
        call_put: str,
        p: Mapping[str, Any],
    ) -> Optional[float]:
        bid = row.get("bid", None)
        ask = row.get("ask", None)
        last = row.get("last", None)
        if bid is not None and ask is not None and pd.notna(bid) and pd.notna(ask):
            if float(bid) > 0 and float(ask) > 0:
                return (float(bid) + float(ask)) / 2.0
        if last is not None and pd.notna(last) and float(last) > 0:
            return float(last)
        # Fallback: Black-Scholes price.
        try:
            return float(
                bs_price(
                    spot=float(spot),
                    strike=float(strike),
                    tau=float(tau),
                    r=float(p["risk_free_rate"]),
                    q=float(p["dividend_yield"]),
                    sigma=float(iv),
                    call_put=call_put,
                )
            )
        except Exception:
            return None

    # --- Sizing --------------------------------------------------------- #
    @staticmethod
    def _size_by_theta(
        *,
        equity: float,
        per_strangle_theta: float,
        max_spreads: int,
        theta_target_pct: float,
    ) -> int:
        if equity <= 0 or per_strangle_theta <= 0:
            return 0
        target_dollar_theta = equity * theta_target_pct
        n = int(math.floor(target_dollar_theta / per_strangle_theta))
        return max(0, min(n, int(max_spreads)))

    # --- Re-valuation --------------------------------------------------- #
    def _revalue_legs(
        self,
        legs: list[LegRecord],
        spot: float,
        asof: date,
        chain: Optional[pd.DataFrame],
        p: Mapping[str, Any],
    ) -> Optional[float]:
        """Return the current net per-spread MID in dollars.

        Uses the live chain mid where available; otherwise BS with the
        last known IV rolled forward (no IV drift inside a single bar's
        decision). The net is signed with the leg's BUY/SELL direction:
        - For the strangle (two SELL legs) the absolute cost to close
          equals ``c_mid + p_mid`` (a *positive* number we'd pay). We
          return that directly.
        - For a single long put the "per_spread_mid" is just the put
          value.
        """

        total = 0.0
        any_valid = False
        for lr in legs:
            tau = lr.tau(asof)
            call_put = "call" if lr.right == "C" else "put"
            # Try live chain first.
            mid: Optional[float] = None
            iv_now: Optional[float] = None
            if chain is not None and not chain.empty:
                match = chain[
                    (chain["strike"].astype(float) == float(lr.strike))
                    & (chain["expiration"] == lr.expiry)
                    & (chain["option_type"].astype(str).str.startswith(call_put[0].lower()))
                ]
                if not match.empty:
                    row = match.iloc[0]
                    iv_now = self._leg_iv(row, spot, asof, lr.expiry)
                    mid = self._leg_mid(
                        row, spot, lr.strike, tau, iv_now or lr.iv_entry, call_put, p
                    )
            if mid is None:
                # BS price with last-known IV.
                try:
                    mid = float(
                        bs_price(
                            spot=float(spot),
                            strike=float(lr.strike),
                            tau=max(tau, 0.0),
                            r=float(p["risk_free_rate"]),
                            q=float(p["dividend_yield"]),
                            sigma=max(float(lr.iv_entry), 1e-3),
                            call_put=call_put,
                        )
                    )
                except Exception:
                    mid = None
            if mid is None:
                continue
            any_valid = True
            # Sum absolute leg mids (the cost to flatten the whole spread).
            total += float(mid)
        if not any_valid:
            return None
        return total


# --------------------------------------------------------------------------- #
# Position-ledger helpers (on ctx.state)                                      #
# --------------------------------------------------------------------------- #
def _positions_map(cache: dict) -> dict[str, PositionRecord]:
    return cache.setdefault(f"{_NS}.positions", {})


def _save_position(cache: dict, rec: PositionRecord) -> None:
    _positions_map(cache)[rec.pos_id] = rec


def _open_positions(cache: dict) -> list[PositionRecord]:
    return [r for r in _positions_map(cache).values() if r.is_open]


def _flush_positions(cache: dict, recs: list[PositionRecord]) -> None:
    pm = _positions_map(cache)
    for r in recs:
        pm[r.pos_id] = r


# --------------------------------------------------------------------------- #
# Synthetic P&L ledger (DEPRECATED — retained for backward compat with older  #
# smoke / tune scripts that ran the strategy outside the real engine).        #
# The strategy no longer writes to the synth ledger; new integrations should  #
# run through :class:`BacktestEngine` and read ``result.equity_curve``.       #
# --------------------------------------------------------------------------- #
def _synth_trades(cache: dict) -> list[dict]:
    return cache.setdefault(f"{_NS}.synth_trades", [])


def _synth_cash(cache: dict) -> list[tuple[date, float]]:
    return cache.setdefault(f"{_NS}.synth_cash", [])


def _accrue_synth(
    cache: dict,
    *,
    asof: date,
    cashflow: float,
    kind: str,
    pos_id: str,
    n_spreads: int,
    per_spread_mid: float,
) -> None:
    """Legacy synthetic-cashflow accrual, retained for test doubles that
    still call it directly. The production strategy no longer invokes
    this helper — engine Portfolio handles cashflow natively.
    """

    _synth_trades(cache).append(
        {
            "asof": asof,
            "kind": kind,
            "pos_id": pos_id,
            "n_spreads": int(n_spreads),
            "per_spread_mid": float(per_spread_mid),
            "cashflow": float(cashflow),
        }
    )
    prev = _synth_cash(cache)
    last = prev[-1][1] if prev else 0.0
    prev.append((asof, last + float(cashflow)))


def synthetic_equity_curve(
    strat: "VRPHarvestStrategy",
    ctx: Any,
    sessions: list[date],
    starting_cash: float,
) -> pd.DataFrame:
    """Build the strategy's equity curve from the in-strategy
    :class:`PositionRecord` ledger + BS per-leg revaluation.

    For each session we compute:
        equity_t = starting_cash
                  + cumulative_realised_cashflow(t)
                  + mark_to_market_of_open_positions(t)

    Realised cashflows are derived from ``PositionRecord`` entries that
    have an ``exit_debit_per_spread`` (closing debit) and a
    ``credit_per_spread`` (entry credit). MTM uses the strategy's
    :meth:`_revalue_legs` against the current chain.

    This helper is retained for backwards compatibility with the
    pre-engine smoke / tune / OOS scripts that run the strategy via
    ``generate_signals`` + ``manage`` directly. New integrations should
    run through :class:`BacktestEngine` and read ``result.equity_curve``
    instead — that path now produces real P&L via the multi-leg fill
    plumbing and no longer requires this helper.
    """

    cache = cache_of(ctx)

    # Build per-position records and derive realised cashflows from
    # their open/close pair. Each short-premium strangle books:
    #     credit_entry = +credit_per_spread * n_spreads * 100   (on opened_on)
    #     debit_exit   = -exit_debit_per_spread * n_spreads * 100 (on closed_on)
    # Long-premium (hedge) positions: flip the sign.
    pos_map = _positions_map(cache)
    records: list[PositionRecord] = list(pos_map.values())

    realised_by_date: dict[date, float] = {}
    for rec in records:
        n = rec.n_spreads
        credit = float(rec.credit_per_spread)
        if credit > 0:
            # Short-premium: credit in on open, pay to close.
            realised_by_date[rec.opened_on] = (
                realised_by_date.get(rec.opened_on, 0.0) + credit * n * 100.0
            )
            if rec.closed_on is not None and rec.exit_debit_per_spread is not None:
                realised_by_date[rec.closed_on] = (
                    realised_by_date.get(rec.closed_on, 0.0)
                    - float(rec.exit_debit_per_spread) * n * 100.0
                )
        else:
            # Long-premium hedge: debit on open, credit on close.
            debit = -credit
            realised_by_date[rec.opened_on] = (
                realised_by_date.get(rec.opened_on, 0.0) - debit * n * 100.0
            )
            if rec.closed_on is not None and rec.exit_debit_per_spread is not None:
                realised_by_date[rec.closed_on] = (
                    realised_by_date.get(rec.closed_on, 0.0)
                    + float(rec.exit_debit_per_spread) * n * 100.0
                )

    rows: list[dict] = []
    running_cash = 0.0
    for s in sessions:
        running_cash += realised_by_date.get(s, 0.0)
        mtm = 0.0
        for rec in records:
            if rec.opened_on > s:
                continue
            if rec.closed_on is not None and rec.closed_on <= s:
                continue
            # Position is open on session s. Compute MTM liability.
            spot = strat._spot_price(ctx, strat.params["underlying"], s)
            if spot is None:
                continue
            chain = strat._chain_snapshot(ctx, strat.params["underlying"], s)
            per_mid = strat._revalue_legs(rec.legs, spot, s, chain, strat.params)
            if per_mid is None:
                continue
            n = rec.n_spreads
            if rec.credit_per_spread > 0:
                # short premium: unrealised P&L = (credit - current_cost) * n * 100
                mtm += (rec.credit_per_spread - per_mid) * n * 100.0
            else:
                debit = -rec.credit_per_spread
                mtm += (per_mid - debit) * n * 100.0
        equity = starting_cash + running_cash + mtm
        rows.append(
            {"date": s, "realised_pnl": running_cash, "mtm": mtm, "equity": equity}
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    return df


def summary_from_equity(
    equity_curve: pd.DataFrame,
    starting_cash: float,
    rf: float = 0.0,
) -> dict[str, float]:
    """Compute Sharpe / MDD / CAGR from a synthetic equity curve."""

    if equity_curve.empty:
        return {"sharpe": 0.0, "max_drawdown": 0.0, "cagr": 0.0, "hit_rate": 0.0}
    eq = equity_curve["equity"].astype(float)
    rets = eq.pct_change().dropna()
    ann = 252.0
    if len(rets) >= 2 and rets.std() > 0:
        excess = rets - (rf / ann)
        sharpe = (excess.mean() / rets.std()) * math.sqrt(ann)
    else:
        sharpe = 0.0
    peak = eq.cummax()
    dd = (eq / peak - 1.0)
    max_dd = float(dd.min()) if len(dd) else 0.0
    n_days = len(eq)
    years = n_days / ann if n_days > 0 else 1.0
    final = float(eq.iloc[-1])
    if starting_cash > 0 and final > 0:
        cagr = (final / starting_cash) ** (1.0 / max(years, 1e-6)) - 1.0
    else:
        cagr = 0.0
    return {
        "sharpe": float(sharpe),
        "max_drawdown": float(max_dd),
        "cagr": float(cagr),
        "years": float(years),
        "final_equity": float(final),
        "total_return_pct": float(final / starting_cash - 1.0) if starting_cash else 0.0,
    }


__all__ = [
    "VRPHarvestStrategy",
    "LegRecord",
    "PositionRecord",
    "synthetic_equity_curve",
    "summary_from_equity",
]
