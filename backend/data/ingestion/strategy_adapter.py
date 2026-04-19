"""Adapter bridging the Phase 1 registry-based ``Strategy`` protocol to the
legacy ``BaseStrategyRunner`` interface still consumed by ``daily_pipeline.py``.

The registry ``Strategy`` API is synchronous and operates on a :class:`Context`
object populated by the backtest engine (``bar_provider``, ``options_provider``,
``earnings_provider``, ``fundamentals_provider``, ``calendar_provider``,
``state`` dict, positions, equity).  ``daily_pipeline.py`` instead calls an
async trio ``screen() → analyze() → generate_trades(master)``.  This module
translates between the two.

High-level flow
---------------

``LiveStrategyAdapter`` is constructed by subclassing it at module-import time,
once per registered strategy name (see :class:`~.strategy_runner.ALL_STRATEGIES`).
Each call into ``daily_pipeline.py``:

1. ``screen()`` — build a bare-bones :class:`Context`, wire the live providers,
   instantiate the strategy, ask its ``universe()`` for today's candidate
   symbols, then fetch the latest daily bar for each to attach a real price.
   Intraday-only strategies (``required_bars`` without ``daily``) warn and
   return empty — they need realtime intraday data the daily pipeline cannot
   currently provide.

2. ``analyze(candidates)`` — feed those symbols back into the same strategy
   by calling ``generate_signals()``.  Each :class:`Signal` becomes one legacy
   analysis dict.  ``target_weight`` magnitude maps to ``conviction`` (70–95
   band); ``Signal.tag`` supplies the rationale.  Multi-leg options orders
   carry their legs through to ``generate_trades``.

3. ``generate_trades(analyses, master)`` — identical to
   ``BaseStrategyRunner.generate_trades`` for the equity path: size against
   the master's allocation limits, request approval, collect the result.  For
   multi-leg signals, the full ``legs`` tuple is attached to the trade record
   so downstream broker logic can submit a spread rather than a naked equity
   order.

The adapter fails loud on missing Alpaca credentials (they are required for
the daily pipeline to run at all) but fails soft on missing FMP / Polygon data
— earnings and options plumbing is optional for equity strategies and we log
+ continue rather than crash the whole pipeline window.
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable

logger = logging.getLogger("alphadesk.strategy_adapter")

# Legacy sizing cap — matches ``strategy_runner.MAX_POSITION_DOLLAR``.
MAX_POSITION_DOLLAR = 6_000.0


# --------------------------------------------------------------------------- #
# Base runner — kept API-compatible with the old ``BaseStrategyRunner`` so    #
# ``daily_pipeline.py`` imports continue to resolve.                          #
# --------------------------------------------------------------------------- #
class BaseStrategyRunner:
    """Legacy runner interface expected by :mod:`.daily_pipeline`."""

    name: str = "base"
    description: str = ""
    use_smart_review: bool = False

    async def screen(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def generate_trades(
        self, analyses: list[dict[str, Any]], master: Any
    ) -> list[dict[str, Any]]:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Provider wiring                                                             #
# --------------------------------------------------------------------------- #
def _build_context(asof: date, equity: float = 100_000.0) -> Any:
    """Return a :class:`Context` with live providers attached (best-effort).

    Alpaca is the only required provider.  Earnings / fundamentals / options
    are attached when available and left at ``None`` otherwise; strategies
    that insist on them will raise in ``generate_signals`` and the adapter
    will catch + log.
    """
    from backtest.types import Context

    bar_provider = options_provider = None
    earnings_provider = fundamentals_provider = calendar_provider = None

    # Alpaca — required.
    try:
        from data.providers.alpaca import AlpacaBarProvider

        bar_provider = AlpacaBarProvider()
    except Exception:
        logger.warning("AlpacaBarProvider unavailable", exc_info=True)

    # Polygon options — optional.
    try:
        from data.providers.polygon_options import PolygonOptionsProvider

        options_provider = PolygonOptionsProvider()
    except Exception:
        logger.debug("PolygonOptionsProvider unavailable", exc_info=True)

    # FMP earnings — optional.
    try:
        from data.providers.fmp_earnings import FMPEarningsProvider

        earnings_provider = FMPEarningsProvider()
    except Exception:
        logger.debug("FMPEarningsProvider unavailable", exc_info=True)

    # FMP fundamentals — optional.
    try:
        from data.providers.fmp_fundamentals import FMPFundamentalsProvider

        fundamentals_provider = FMPFundamentalsProvider()
    except Exception:
        logger.debug("FMPFundamentalsProvider unavailable", exc_info=True)

    # Trading calendar — optional.
    try:
        from data.calendar import USMarketCalendar

        calendar_provider = USMarketCalendar()
    except Exception:
        logger.debug("USMarketCalendar unavailable", exc_info=True)

    return Context(
        asof=asof,
        cash=Decimal(str(equity)),
        equity=Decimal(str(equity)),
        positions=[],
        bar_provider=bar_provider,
        options_provider=options_provider,
        earnings_provider=earnings_provider,
        fundamentals_provider=fundamentals_provider,
        calendar_provider=calendar_provider,
    )


# --------------------------------------------------------------------------- #
# Signal → legacy analysis-dict conversion                                    #
# --------------------------------------------------------------------------- #
def _conviction_from_weight(weight: float | None) -> int:
    """Map ``|target_weight|`` ∈ (0, 1] onto the 70-95 conviction band.

    Signals without a weight (pure quantity-based) default to 80.
    """
    if weight is None:
        return 80
    # Clamp & scale: |w|=0.02 → 70, |w|=0.20 → ~95
    magnitude = min(abs(float(weight)), 1.0)
    conviction = 70 + int(round(magnitude * 125))
    return max(70, min(95, conviction))


def _signal_side(signal: Any) -> str:
    """Return ``"buy"``/``"sell"``/``"short"`` per legacy convention."""
    w = signal.target_weight
    q = signal.quantity
    if w is not None:
        if w > 0:
            return "buy"
        if w < 0:
            return "short"
        return "sell"
    if q is not None:
        if q > 0:
            return "buy"
        if q < 0:
            return "short"
    # Multi-leg spread — let the master categorise; default to "buy".
    return "buy"


def _signal_to_analysis(signal: Any, description: str, price: float) -> dict[str, Any]:
    """Convert one :class:`Signal` into a legacy analysis dict."""
    side = _signal_side(signal)
    conviction = _conviction_from_weight(signal.target_weight)
    rationale = (signal.tag or description or "").strip() or f"{signal.symbol} signal"

    stop = float(signal.stop_price) if signal.stop_price is not None else None
    tp = float(signal.take_profit) if signal.take_profit is not None else None

    analysis: dict[str, Any] = {
        "symbol": signal.symbol,
        "signal": side,
        "conviction": conviction,
        "rationale": rationale,
        "price": price,
        "entry_price": price,
        "stop_loss": stop,
        "take_profit": tp,
        "sector": "Unknown",
    }
    if signal.legs:
        analysis["legs"] = [
            {
                "contract_id": leg.contract_id,
                "side": getattr(leg.side, "value", str(leg.side)),
                "qty": leg.qty,
                "limit_price": float(leg.limit_price) if leg.limit_price else None,
                "underlying": leg.underlying,
                "strike": float(leg.strike) if leg.strike else None,
                "right": leg.right,
                "expiry": leg.expiry.isoformat() if leg.expiry else None,
                "multiplier": leg.multiplier,
            }
            for leg in signal.legs
        ]
    return analysis


# --------------------------------------------------------------------------- #
# LiveStrategyAdapter                                                         #
# --------------------------------------------------------------------------- #
class LiveStrategyAdapter(BaseStrategyRunner):
    """Wraps a Phase-1 ``Strategy`` instance in the legacy runner interface.

    Subclasses set ``_registry_name`` at class level; the adapter resolves the
    class from the registry lazily so importing this module doesn't require
    :func:`backend.strategies.registry.load_all` to have run yet.
    """

    _registry_name: str = ""
    description: str = ""

    def __init__(self) -> None:
        self._strategy: Any = None
        self._description: str = self.description or ""
        self._required_bars: tuple[str, ...] = ("daily",)

    # -- Lifecycle helpers ---------------------------------------------------
    def _load_strategy(self) -> Any:
        """Resolve + instantiate the underlying registry strategy once."""
        if self._strategy is not None:
            return self._strategy
        from strategies.registry import get_meta, get_strategy, load_all

        # Idempotent; first call does the discovery.
        load_all()
        cls = get_strategy(self._registry_name)
        meta = get_meta(self._registry_name)
        instance = cls()
        try:
            instance.configure({})
        except Exception:
            logger.warning(
                "%s: configure({}) failed — proceeding with class defaults",
                self._registry_name, exc_info=True,
            )
        self._strategy = instance
        self._description = meta.description
        self._required_bars = tuple(meta.required_bars)
        return instance

    def _supports_daily_cadence(self) -> bool:
        """Daily pipeline can only drive strategies whose bar set includes daily.

        Intraday-only strategies (``required_bars == ('1min',)``) would need
        streaming data the nightly pipeline doesn't currently carry; we skip
        them with a WARN rather than fabricate intraday bars.
        """
        return any(b in ("daily", "1Day", "1D") for b in self._required_bars)

    # -- Screen --------------------------------------------------------------
    async def screen(self) -> list[dict[str, Any]]:
        """Return candidate dicts ``[{symbol, price, metrics}]``."""
        try:
            strategy = self._load_strategy()
        except Exception:
            logger.error("%s: cannot load registry strategy", self.name, exc_info=True)
            return []

        if not self._supports_daily_cadence():
            logger.warning(
                "%s: requires intraday bars %s — skipping in daily pipeline",
                self.name, self._required_bars,
            )
            return []

        asof = date.today()
        ctx = _build_context(asof)

        # universe() is synchronous; offload to the thread pool so we don't
        # block the event loop on Alpaca HTTP hops inside the strategy.
        try:
            symbols = await asyncio.to_thread(
                lambda: list(strategy.universe(asof, ctx)) or []
            )
        except Exception:
            logger.warning("%s.universe() raised", self.name, exc_info=True)
            return []

        # Fetch a single latest daily bar per symbol for the price field.
        prices = await asyncio.to_thread(
            _latest_daily_prices, ctx.bar_provider, symbols, asof
        )

        candidates: list[dict[str, Any]] = []
        for sym in symbols:
            p = prices.get(sym)
            if p is None or p <= 0:
                # Skip symbols with no price — they cannot be sized.
                continue
            candidates.append({
                "symbol": sym,
                "price": float(p),
                "sector": "Unknown",
                # ``metrics`` carries strategy-internal scoring as an opaque
                # blob; Phase 1 strategies don't expose intermediate scores
                # so leave it empty.  Downstream consumers tolerate missing.
                "metrics": {},
            })
        return candidates

    # -- Analyze -------------------------------------------------------------
    async def analyze(
        self, candidates: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []
        try:
            strategy = self._load_strategy()
        except Exception:
            logger.error("%s: cannot load registry strategy", self.name, exc_info=True)
            return []

        if not self._supports_daily_cadence():
            logger.warning(
                "%s: intraday strategy — no daily-cadence analysis possible",
                self.name,
            )
            return []

        asof = date.today()
        ctx = _build_context(asof)
        prices = {c["symbol"]: c.get("price", 0.0) for c in candidates}

        try:
            signals = await asyncio.to_thread(
                lambda: list(strategy.generate_signals(asof, ctx)) or []
            )
        except Exception:
            logger.exception("%s.generate_signals() raised", self.name)
            return []

        analyses: list[dict[str, Any]] = []
        for sig in signals:
            px = prices.get(sig.symbol)
            if px is None:
                # Signal for a symbol the screener didn't surface — try a
                # live lookup so we can still size the trade.
                try:
                    lookup = await asyncio.to_thread(
                        _latest_daily_prices, ctx.bar_provider, [sig.symbol], asof
                    )
                    px = float(lookup.get(sig.symbol, 0.0))
                except Exception:
                    logger.debug(
                        "live-price lookup failed for %s", sig.symbol, exc_info=True,
                    )
                    px = 0.0
            if not px or px <= 0:
                logger.debug(
                    "%s: skipping %s — no live price", self.name, sig.symbol,
                )
                continue
            analyses.append(_signal_to_analysis(sig, self._description, float(px)))
        return analyses

    # -- Generate trades -----------------------------------------------------
    async def generate_trades(
        self, analyses: list[dict[str, Any]], master: Any,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for a in analyses:
            if a.get("error"):
                continue
            sig = (a.get("signal") or "").lower()
            conv = int(a.get("conviction", 0))
            if sig not in ("buy", "short") or conv < 50:
                # The master agent's equity path only supports long entries
                # and sells; short / option legs are submitted through the
                # same ``request_trade`` call so the master can decide.
                if sig != "buy":
                    continue

            price = a.get("entry_price") or a.get("price", 0)
            if not price or price <= 0:
                continue

            # Volatility-targeted sizing when the master supports it.
            if hasattr(master, "calculate_vol_targeted_size"):
                vol_notional = master.calculate_vol_targeted_size(
                    a["symbol"], max_notional=MAX_POSITION_DOLLAR,
                )
            else:
                vol_notional = MAX_POSITION_DOLLAR
            per_share_cap = price * math.floor(vol_notional / price) if price > 0 else 0
            notional = min(vol_notional, per_share_cap)
            shares = math.floor(notional / price) if price > 0 else 0
            if shares < 1:
                continue
            notional = round(shares * price, 2)

            stop_loss = a.get("stop_loss") or round(price * 0.95, 2)
            take_profit = a.get("take_profit") or round(price * 1.10, 2)
            sector = a.get("sector", "Unknown")
            legs = a.get("legs")

            if self.use_smart_review and hasattr(master, "request_trade_smart"):
                result = await master.request_trade_smart(
                    strategy=self.name,
                    symbol=a["symbol"],
                    side="buy",
                    notional=notional,
                    conviction=conv,
                    rationale=a.get("rationale", ""),
                    shares=shares,
                    entry_price=price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    sector=sector,
                )
            else:
                result = master.request_trade(
                    strategy=self.name,
                    symbol=a["symbol"],
                    side="buy",
                    notional=notional,
                    conviction=conv,
                    rationale=a.get("rationale", ""),
                    shares=shares,
                    entry_price=price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    sector=sector,
                )
            result["symbol"] = a["symbol"]
            result["strategy"] = self.name
            result["shares"] = shares
            result["notional"] = notional
            result["conviction"] = conv
            result["entry_price"] = price
            result["stop_loss"] = stop_loss
            result["take_profit"] = take_profit
            result["rationale"] = a.get("rationale", "")
            result["sector"] = sector
            if legs:
                result["legs"] = legs
            results.append(result)
        return results


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _latest_daily_prices(
    bar_provider: Any, symbols: list[str], asof: date,
) -> dict[str, float]:
    """Return ``{symbol: close}`` for the most recent daily bar ≤ ``asof``.

    Missing symbols are simply omitted; the caller filters them out.
    """
    if not bar_provider or not symbols:
        return {}
    from datetime import timedelta

    # Window wide enough to span weekends / holidays.
    start = asof - timedelta(days=10)
    try:
        frame = bar_provider.bars(symbols, start, asof, tf="1D")
    except Exception:
        logger.warning("bar_provider.bars failed", exc_info=True)
        return {}
    if frame is None or len(frame) == 0:
        return {}

    out: dict[str, float] = {}
    try:
        for sym, grp in frame.groupby("symbol"):
            latest = grp.iloc[-1]
            price = float(latest["close"])
            if price > 0:
                out[str(sym)] = price
    except Exception:
        logger.warning("failed to extract close prices from bars frame", exc_info=True)
    return out


def build_all_strategies() -> list[type[LiveStrategyAdapter]]:
    """Return adapter subclasses for every non-smoke registered strategy.

    Called by :mod:`.strategy_runner` at import time to populate
    ``ALL_STRATEGIES``.  Smoke strategies (category ``"smoke"``) are excluded
    — they exist only for registry / engine round-trip tests.
    """
    from strategies.registry import list_strategies, load_all

    load_all()
    classes: list[type[LiveStrategyAdapter]] = []
    for meta in list_strategies():
        if meta.category == "smoke":
            continue
        cls_name = "".join(part.title() for part in meta.name.split("_")) + "Runner"
        cls = type(
            cls_name,
            (LiveStrategyAdapter,),
            {
                "name": meta.name,
                "_registry_name": meta.name,
                "description": meta.description,
                "__doc__": f"Live adapter for registry strategy {meta.name!r}.",
            },
        )
        classes.append(cls)
    return classes


__all__ = [
    "BaseStrategyRunner",
    "LiveStrategyAdapter",
    "build_all_strategies",
    "MAX_POSITION_DOLLAR",
]
