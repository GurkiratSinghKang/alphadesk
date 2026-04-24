"""Strategy runner facade for the daily pipeline.

Task-17 rewrite: this module replaces the Phase 2-C
``strategy_adapter.LiveStrategyAdapter`` shim with a thinner facade over the
Phase-2 unified-shell :class:`~strategies._core.protocol.Strategy` ABC and
:class:`~strategies._core.runners.pipeline_runner.DailyPipelineRunner`.

Shape consumed by :mod:`.daily_pipeline`
----------------------------------------

* ``BaseStrategyRunner`` — minimal facade with ``name`` + ``async run(master)``.
  Returns a legacy-shaped dict with ``screened/analyzed/analyses/trades``
  so the pipeline's observability stays byte-compatible.
* ``ALL_STRATEGIES`` — list of concrete runner classes, one per autonomous
  strategy on the NEW registry. During Phase 2 only ``pead`` is on the new
  registry; the other 12 strategies still live in ``strategies.registry``
  (legacy) and will be migrated in Phase 3 (plan Task 19+). They are
  intentionally absent here.
* ``get_screener_results`` — legacy helper that populated MasterAgent
  momentum data from the old ``momentum_quality`` adapter. The new unified
  shell does not expose a synchronous ``screen()`` hook, so this function
  now returns an empty list. The pipeline falls back to an empty momentum
  snapshot in that case (MasterAgent tolerates this).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import date
from decimal import Decimal
from typing import Any

import numpy as np

from strategies._core.contracts import StrategyInput, StrategyParams
from strategies._core.protocol import Strategy, StrategyMeta, get_strategy, list_strategies
from strategies._core.providers import ProviderBundle, default_provider_bundle
from strategies._core.runners.pipeline_runner import DailyPipelineRunner, StateStore

logger = logging.getLogger("alphadesk.strategy_runner")

# Legacy sizing cap — preserved so master.request_trade sees the same
# notional ceiling the old LiveStrategyAdapter enforced.
MAX_POSITION_DOLLAR = 6_000.0


# --------------------------------------------------------------------------- #
# Process-global provider bundle + state store                                #
# --------------------------------------------------------------------------- #
# Built lazily so module import doesn't demand Alpaca/FMP credentials just
# to list strategy names.
_PROVIDERS: ProviderBundle | None = None
_STATE_STORE: StateStore | None = None


def _get_providers() -> ProviderBundle:
    global _PROVIDERS
    if _PROVIDERS is None:
        _PROVIDERS = default_provider_bundle()
    return _PROVIDERS


def _get_state_store() -> StateStore:
    global _STATE_STORE
    if _STATE_STORE is None:
        _STATE_STORE = StateStore()
    return _STATE_STORE


# --------------------------------------------------------------------------- #
# BaseStrategyRunner — minimal facade for daily_pipeline                      #
# --------------------------------------------------------------------------- #
class BaseStrategyRunner:
    """Minimal interface consumed by :mod:`.daily_pipeline`.

    ``daily_pipeline._run_single_strategy`` calls ``await runner.run(master)``
    and reads the returned dict into ``log["strategies"][name]``.
    """

    name: str = "base"
    description: str = ""
    use_smart_review: bool = False

    async def run(self, master: Any) -> dict[str, Any]:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# UnifiedStrategyRunner — wraps a new-protocol Strategy via DailyPipelineRunner#
# --------------------------------------------------------------------------- #
def _conviction_from_weight(weight: float | None) -> int:
    """Map ``|target_weight|`` ∈ (0, 1] onto the 70-95 conviction band.

    Preserves the legacy ``strategy_adapter._conviction_from_weight`` mapping
    byte-for-byte so MasterAgent's conviction gates behave identically.
    """
    if weight is None:
        return 80
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
    return "buy"


def _signal_to_analysis(signal: Any, description: str, price: float) -> dict[str, Any]:
    """Convert a new-shell :class:`Signal` into a legacy analysis dict.

    Byte-compatible with ``strategy_adapter._signal_to_analysis`` so the
    pipeline's ``log["strategies"][name]["analyses"]`` payloads preserve
    their shape (downstream report renderers, audit dumps, etc.).
    """
    side = _signal_side(signal)
    conviction = _conviction_from_weight(signal.target_weight)
    rationale = (signal.tag or description or "").strip() or f"{signal.symbol} signal"

    stop = float(signal.stop_price) if signal.stop_price is not None else None
    tp = None  # new-shell Signal has no `take_profit` attribute; master derives it.

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
        # New-shell OptionLeg uses occ_symbol + quantity (not contract_id/qty)
        analysis["legs"] = [
            {
                "occ_symbol": leg.occ_symbol,
                "side": leg.side,
                "quantity": leg.quantity,
                "limit_price": leg.limit_price,
            }
            for leg in signal.legs
        ]
    return analysis


class UnifiedStrategyRunner(BaseStrategyRunner):
    """Runs one Phase-2 unified-shell :class:`Strategy` on the live pipeline.

    Pipeline flow (preserves the legacy screen/analyze/risk stage semantics):

    1. Build a :class:`DailyPipelineRunner` with the process-global provider
       bundle and state store.
    2. Call ``runner.run_today(params)`` — this invokes ``Strategy.run()``
       with today's pre-fetched bars/earnings, returning a
       :class:`StrategyResult` with a list of :class:`Signal`.
    3. Convert each :class:`Signal` to a legacy analysis dict (conviction
       derived from ``target_weight``, price from the most recent bar).
    4. For each analysis, resolve a live price from the bar provider and
       call ``master.request_trade(...)`` with the legacy signature so
       MasterAgent's allocation/sector/VIX gates behave unchanged.

    Subclasses set ``_registry_name`` at class level; ``params_model`` is
    pulled off the class via ``strategy_cls.PARAMS_MODEL``.
    """

    _registry_name: str = ""

    def __init__(self) -> None:
        self._strategy: Strategy | None = None
        self._description: str = self.description or ""

    # -- Lifecycle helpers ---------------------------------------------------
    def _load_strategy(self) -> Strategy | None:
        if self._strategy is not None:
            return self._strategy
        cls = get_strategy(self._registry_name)
        if cls is None:
            logger.error(
                "strategy_runner: %r not found in new registry — skipping",
                self._registry_name,
            )
            return None
        try:
            self._strategy = cls()
        except TypeError as exc:
            # Strategy hasn't been migrated to the new ABC — Phase 3 target.
            logger.warning(
                "strategy_runner: %s not migrated to new Strategy ABC (%s) — skipping",
                self._registry_name, exc,
            )
            return None
        return self._strategy

    # -- Public run hook -----------------------------------------------------
    async def run(self, master: Any) -> dict[str, Any]:
        """Run one pipeline iteration and route signals through MasterAgent.

        Returns the legacy-shaped result dict:
        ``{screened, analyzed, analyses, trades_requested, trades_approved, trades}``.
        Missing strategy (e.g. not migrated) returns an empty result rather
        than raising.
        """
        empty: dict[str, Any] = {
            "screened": 0, "analyzed": 0, "analyses": [],
            "trades_requested": 0, "trades_approved": 0, "trades": [],
        }
        strategy = self._load_strategy()
        if strategy is None:
            return empty

        params_model = type(strategy).PARAMS_MODEL
        if params_model is None:
            logger.warning(
                "strategy_runner: %s has no PARAMS_MODEL — skipping", self.name,
            )
            return empty

        try:
            params: StrategyParams = params_model()  # defaults
        except Exception:
            logger.warning(
                "strategy_runner: could not instantiate %s.PARAMS_MODEL with defaults",
                self.name, exc_info=True,
            )
            return empty

        try:
            providers = _get_providers()
        except Exception:
            logger.error(
                "strategy_runner: default_provider_bundle() failed — %s skipped",
                self.name, exc_info=True,
            )
            return empty

        runner = DailyPipelineRunner(strategy, providers, _get_state_store())
        try:
            result = await runner.run_today(params)
        except Exception:
            logger.exception("strategy_runner: %s run_today() failed", self.name)
            return empty

        signals = list(result.signals or [])
        logger.info(
            "strategy_runner: %s emitted %d signals",
            self.name, len(signals),
        )

        # Convert signals → analyses → master.request_trade calls.
        analyses: list[dict[str, Any]] = []
        trades: list[dict[str, Any]] = []

        # Resolve live prices from the provider for the signalled symbols.
        # The new shell puts the most-recent close in ``StrategyInput.bars``
        # but we already consumed that inside ``run_today``. Re-fetch a
        # 1-day window here — cheap relative to the overall pipeline, and
        # robust across state-store boundaries.
        sym_prices = await asyncio.to_thread(
            _latest_prices, providers, [s.symbol for s in signals],
        )

        for sig in signals:
            price = sym_prices.get(sig.symbol, 0.0)
            if not price or price <= 0:
                logger.debug(
                    "strategy_runner: no live price for %s — skipping signal",
                    sig.symbol,
                )
                continue
            analysis = _signal_to_analysis(sig, self._description, float(price))
            analyses.append(analysis)

            side = analysis["signal"]
            # Only "buy" is currently routed through master.request_trade;
            # "sell"/"short" signals are handled by MasterAgent directly
            # and by the exit-check phase downstream. This preserves the
            # legacy adapter's single-sided submission behaviour.
            if side != "buy":
                continue
            conviction = int(analysis["conviction"])
            if conviction < 50:
                continue

            # Volatility-targeted sizing when master supports it.
            if hasattr(master, "calculate_vol_targeted_size"):
                vol_notional = master.calculate_vol_targeted_size(
                    sig.symbol, max_notional=MAX_POSITION_DOLLAR,
                )
            else:
                vol_notional = MAX_POSITION_DOLLAR
            import math as _math
            per_share_cap = price * _math.floor(vol_notional / price) if price > 0 else 0
            notional = min(vol_notional, per_share_cap)
            shares = _math.floor(notional / price) if price > 0 else 0
            if shares < 1:
                continue
            notional = round(shares * price, 2)

            stop_loss = analysis.get("stop_loss") or round(price * 0.95, 2)
            take_profit = analysis.get("take_profit") or round(price * 1.10, 2)
            sector = analysis.get("sector", "Unknown")
            legs = analysis.get("legs")

            if self.use_smart_review and hasattr(master, "request_trade_smart"):
                trade = await master.request_trade_smart(
                    strategy=self.name,
                    symbol=sig.symbol,
                    side="buy",
                    notional=notional,
                    conviction=conviction,
                    rationale=analysis.get("rationale", ""),
                    shares=shares,
                    entry_price=price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    sector=sector,
                )
            else:
                trade = master.request_trade(
                    strategy=self.name,
                    symbol=sig.symbol,
                    side="buy",
                    notional=notional,
                    conviction=conviction,
                    rationale=analysis.get("rationale", ""),
                    shares=shares,
                    entry_price=price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    sector=sector,
                )
            trade["symbol"] = sig.symbol
            trade["strategy"] = self.name
            trade["shares"] = shares
            trade["notional"] = notional
            trade["conviction"] = conviction
            trade["entry_price"] = price
            trade["stop_loss"] = stop_loss
            trade["take_profit"] = take_profit
            trade["rationale"] = analysis.get("rationale", "")
            trade["sector"] = sector
            if legs:
                trade["legs"] = legs
            trades.append(trade)

        approved = [t for t in trades if t.get("approved")]
        return {
            "screened": len(signals),        # best-effort: new shell doesn't separate screen vs emit
            "analyzed": len(analyses),
            "analyses": analyses,
            "trades_requested": len(trades),
            "trades_approved": len(approved),
            "trades": trades,
        }


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _latest_prices(providers: ProviderBundle, symbols: list[str]) -> dict[str, float]:
    """Return ``{symbol: latest_close}`` from the provider bundle's bar feed."""
    if not symbols or providers.bars is None:
        return {}
    from datetime import date as _date

    asof = _date.today()
    try:
        frame = providers.bars.fetch_window(list(set(symbols)), asof, lookback_days=5)
    except Exception:
        logger.warning("strategy_runner: fetch_window failed", exc_info=True)
        return {}
    if frame is None or len(frame) == 0:
        return {}

    out: dict[str, float] = {}
    try:
        # frame has a multi-index of (date, symbol); pull the latest close per symbol.
        index_names = tuple(frame.index.names or ())
        if "symbol" in index_names and "date" in index_names:
            for sym, grp in frame.groupby(level="symbol"):
                latest = grp.iloc[-1]
                price = float(latest["close"])
                if price > 0:
                    out[str(sym)] = price
        elif "symbol" in frame.columns:
            for sym, grp in frame.groupby("symbol"):
                latest = grp.iloc[-1]
                price = float(latest["close"])
                if price > 0:
                    out[str(sym)] = price
    except Exception:
        logger.warning(
            "strategy_runner: could not extract latest close prices", exc_info=True,
        )
    return out


# --------------------------------------------------------------------------- #
# ALL_STRATEGIES — built from the NEW registry                                #
# --------------------------------------------------------------------------- #
def _build_all_strategies() -> list[type[UnifiedStrategyRunner]]:
    """Return runner classes for every autonomous strategy on the new registry.

    Walks the new registry (``strategies._core.protocol``) which, post-Phase-3,
    contains all 13 migrated strategies. Strategies with
    ``kind != "autonomous"`` (research-only, e.g. ``earnings-options-play``,
    ``vrp_harvest``, ``earnings_vol``, ``vwap``, ``orb``) are excluded — the
    daily pipeline only schedules autonomous strategies.
    """
    # Fire every strategy package's @register_strategy side effect.
    # ``load_all()`` walks ``backend/strategies/`` and imports every
    # subpackage; failures in any individual strategy are logged and
    # skipped so a single broken package doesn't orphan the whole pipeline.
    try:
        from strategies.registry import load_all
        load_all()
    except Exception:
        logger.exception("strategy_runner: load_all() failed")

    classes: list[type[UnifiedStrategyRunner]] = []
    for meta in list_strategies():
        if meta.kind != "autonomous":
            continue
        if meta.params_model is None:
            logger.warning(
                "strategy_runner: skipping %s (no PARAMS_MODEL)", meta.name,
            )
            continue
        cls_name = "".join(part.title() for part in meta.name.split("_")) + "Runner"
        cls = type(
            cls_name,
            (UnifiedStrategyRunner,),
            {
                "name": meta.name,
                "_registry_name": meta.name,
                "description": meta.description,
                "__doc__": f"Unified runner for new-registry strategy {meta.name!r}.",
            },
        )
        classes.append(cls)
    return classes


ALL_STRATEGIES: list[type[UnifiedStrategyRunner]] = _build_all_strategies()

logger.info(
    "strategy_runner: loaded %d runners from new registry (%s)",
    len(ALL_STRATEGIES), [cls.name for cls in ALL_STRATEGIES],
)


# --------------------------------------------------------------------------- #
# Legacy screener helper                                                      #
# --------------------------------------------------------------------------- #
async def get_screener_results(
    strategy_name: str | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    """Return an empty list.

    Historically this walked ``momentum_quality``'s legacy-adapter
    ``screen()`` to populate MasterAgent momentum data. The unified shell
    does not expose a synchronous screening hook: each strategy declares a
    ``universe()`` at runtime and emits :class:`Signal` via ``run()``.

    Until the 12 non-migrated strategies are ported in Phase 3, returning
    an empty list means MasterAgent starts with an empty momentum
    snapshot — acceptable since momentum data is a soft filter used only
    by strategies in the ``MOMENTUM_GATE_SKIP_CATEGORIES`` set, and those
    will be migrated with their own momentum-data hooks.
    """
    _ = (strategy_name, limit)  # preserved kwargs for API compatibility
    return []


def get_screener_results_sync(
    strategy_name: str | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    """Synchronous wrapper preserved for pre-existing callers."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None
    if loop is not None and loop.is_running():
        raise RuntimeError(
            "get_screener_results_sync called from inside a running event loop; "
            "use `await get_screener_results(...)` instead."
        )
    return asyncio.run(get_screener_results(strategy_name, limit))


__all__ = [
    "BaseStrategyRunner",
    "UnifiedStrategyRunner",
    "ALL_STRATEGIES",
    "get_screener_results",
    "get_screener_results_sync",
    "MAX_POSITION_DOLLAR",
]
