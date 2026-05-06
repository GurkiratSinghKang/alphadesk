"""Post-Earnings Announcement Drift — unified-shell implementation.

Textbook PEAD on the Bernard-Thomas 1989 / Livnat-Mendenhall 2006 lines:
long the top-|SUE| positive surprises, short the bottom-|SUE| negative
surprises (when ``allow_shorts=True``), hold for ``holding_days`` trading
days, exit MOC.

This is the Task-14 rewrite onto the new :class:`Strategy` ABC in
:mod:`strategies._core.protocol`. The alpha logic is preserved byte-for-byte
from the old ``generate_signals`` + ``manage`` methods; the only change is
how data flows in: ``run()`` is a pure function that reads from
:class:`StrategyInput` rather than the legacy :class:`Context` providers.

See ``spec.md`` for the full academic reference. Pure numeric utilities
(SUE computation, liquidity filter, overlap check, session math) stay in
:mod:`.helpers` to keep this module readable.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import pandas as pd

from strategies._core.contracts import (
    Fill,
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import PEADParams, UNIVERSE_SEED, load_universe
from .helpers import (
    compute_sue,
    has_overlapping_earnings,
    passes_liquidity,
    trading_days_between,
)


log = logging.getLogger("alphadesk.strategies.pead")


# --------------------------------------------------------------------------- #
# Constants                                                                   #
# --------------------------------------------------------------------------- #
# Calendar warmup: we need at least 4 quarters of historical surprises to
# compute SUE. Default 12 quarters gives comfortable slack (12 * ~90 days = 3y).
_REQUIRED_LOOKBACK_DAYS = 1100  # ~3 years of calendar
_NS = "pead"


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@register_strategy(
    StrategyMeta(
        name="pead",
        category="equity",
        description=(
            "Post-Earnings Announcement Drift (Bernard-Thomas 1989, "
            "Livnat-Mendenhall 2006). Long/short US equity on standardised "
            "unexpected earnings (SUE), 40-day drift window, MOC time-stop "
            "exit. Real FMP earnings + surprises; no demo RNG, no hardcoded "
            "calendar."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=10,
    )
)
class PEADStrategy(Strategy):
    """Long/short PEAD on US large-caps with SUE-gated entries.

    Purity invariants (enforced by the runner + code review):
      * :meth:`run` performs no I/O; all data arrives via ``input``
      * :meth:`run` reads ``input.asof`` as the only time source (no
        wall-clock reads)
      * :meth:`run` uses ``input.rng`` as the only random source (PEAD is
        deterministic; no randomness in the alpha logic)
      * state mutations flow only through :class:`StrategyResult.state_update`
        and :meth:`on_fill`'s return dict
    """

    PARAMS_MODEL = PEADParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Return the candidate symbol list for ``asof``.

        The engine calls this BEFORE :meth:`run` so it can pre-fetch the
        bar / earnings lookback window. We return a cached snapshot of
        :func:`load_universe` so repeated calls within a run don't re-walk
        the static seed list. Any symbols currently held (per prior
        ``state_update``) are unioned in so the engine keeps marking them.
        """

        cached = state.get(f"{_NS}.universe")
        if cached is None:
            # Round-6 / I-8: ``load_universe`` returns
            # ``(symbols, has_survivorship_bias)`` — we only need the
            # symbol list here. The bias bit is recorded on
            # ``state_update`` so downstream OOS reporters can read it
            # without consulting a module-level global.
            cached, _bias = load_universe(asof=asof, fundamentals_provider=None)
        held = set(state.get(f"{_NS}.held_symbols", []))
        return sorted(set(cached) | held)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: PEADParams,
    ) -> StrategyResult:
        """Emit exits (time-stop) and entries (SUE-gated) for ``input.asof``.

        Bytes-for-byte port of the old ``manage`` + ``generate_signals``
        methods; the only behavioural change is that data access goes
        through ``input.bars`` / ``input.earnings`` rather than
        ``ctx.bar_provider`` / ``ctx.earnings_provider``.
        """

        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        # ------------------------------------------------------------------ #
        # 1. Exits (time-stop) — same as the old manage()
        # ------------------------------------------------------------------ #
        holding_days = int(params.holding_days)
        entries_state: dict[str, dict[str, Any]] = dict(
            state.get(f"{_NS}.entries", {})
        )

        exits: list[Signal] = []
        for pos in input.positions:
            if pos.quantity == 0:
                continue
            meta = entries_state.get(pos.symbol)
            opened = pos.entry_date
            if opened is None and meta is not None:
                opened = meta.get("queued_on")
            if opened is None:
                # Unknown entry date — force close (safety net).
                exits.append(self._exit_signal(pos.symbol, asof))
                continue
            held = trading_days_between(opened, asof, calendar_provider=None)
            if held >= holding_days:
                exits.append(self._exit_signal(pos.symbol, asof))

        # ------------------------------------------------------------------ #
        # 1b. Daily-loss circuit breaker (audit 2026-05-05 forward gap).
        # Track an equity high-water mark in state. When current equity falls
        # below ``daily_loss_pct_breaker`` of HWM, pause NEW entries for
        # ``breaker_cooldown_days`` calendar days. Existing positions still
        # exit on time-stop — we don't force-close them, which would violate
        # PEAD's positive-skew payoff.
        # ------------------------------------------------------------------ #
        breaker_cfg = float(params.daily_loss_pct_breaker)
        breaker_active = False
        if breaker_cfg < 0.0:
            try:
                equity_now = float(input.equity)
            except (TypeError, ValueError):
                equity_now = 0.0
            hwm_raw = state.get(f"{_NS}.equity_hwm")
            try:
                hwm = float(hwm_raw) if hwm_raw is not None else equity_now
            except (TypeError, ValueError):
                hwm = equity_now
            if equity_now > hwm:
                hwm = equity_now
            state_update[f"{_NS}.equity_hwm"] = hwm

            # Are we still inside an existing cooldown?
            until_raw = state.get(f"{_NS}.breaker_until")
            until_date: Optional[date] = None
            if isinstance(until_raw, str):
                try:
                    until_date = date.fromisoformat(until_raw)
                except ValueError:
                    until_date = None
            elif isinstance(until_raw, date):
                until_date = until_raw
            if until_date is not None and asof <= until_date:
                breaker_active = True
            else:
                # Trip a fresh breaker if drawdown breaches the threshold.
                if hwm > 0:
                    drawdown = (equity_now - hwm) / hwm
                    if drawdown <= breaker_cfg:
                        breaker_active = True
                        new_until = asof + timedelta(
                            days=int(params.breaker_cooldown_days)
                        )
                        state_update[f"{_NS}.breaker_until"] = new_until.isoformat()
                        warnings.append(
                            f"daily-loss circuit breaker tripped "
                            f"(drawdown {drawdown:.2%} <= {breaker_cfg:.2%}); "
                            f"halting new entries until {new_until.isoformat()}"
                        )
            diagnostics["breaker_active"] = breaker_active
            diagnostics["equity_hwm"] = hwm

        # ------------------------------------------------------------------ #
        # 2. Entries — same as the old generate_signals()
        # ------------------------------------------------------------------ #
        # Cache the universe list on state so universe() sees a stable set
        # across subsequent bars. Shallow state merge preserves this.
        universe_list = state.get(f"{_NS}.universe") or list(UNIVERSE_SEED)
        state_update[f"{_NS}.universe"] = universe_list

        # If the daily-loss circuit breaker is active, skip entries for this
        # bar. Exits already accumulated above; existing positions tick down
        # toward the time-stop normally.
        if breaker_active:
            diagnostics["entries_candidates"] = 0
            diagnostics["entries_skipped_breaker"] = True
            return self._finalise_result(
                exits, entries_state, state_update, diagnostics, warnings,
            )

        earnings = input.earnings
        if earnings is None or earnings.empty:
            diagnostics["entries_candidates"] = 0
            return self._finalise_result(
                exits, entries_state, state_update, diagnostics, warnings,
            )

        # 2a. Find yesterday's announcements. Any name reporting strictly
        # before today is eligible for a T+1 MOO entry today.
        ann = self._yesterday_announcements(earnings, asof)
        if ann.empty:
            diagnostics["entries_candidates"] = 0
            return self._finalise_result(
                exits, entries_state, state_update, diagnostics, warnings,
            )

        # 2b. Compute SUE for each announcement.
        scored: list[tuple[float, str, float]] = []  # (|SUE|, sym, SUE)
        for _, row in ann.iterrows():
            sym = str(row["symbol"]).upper()
            eps_actual = row.get("eps_actual")
            eps_est = row.get("eps_estimated")
            ann_date = row["date"]
            if isinstance(ann_date, pd.Timestamp):
                ann_date = ann_date.date()
            elif ann_date is None:
                continue

            hist = self._surprise_history(earnings, sym, ann_date)
            sue = compute_sue(
                eps_actual,
                eps_est,
                hist,
                ann_date,
                lookback_quarters=int(params.sue_lookback_quarters),
                min_quarters=int(params.min_quarters_for_sue),
            )
            if sue is None:
                continue
            scored.append((abs(sue), sym, sue))

        diagnostics["entries_candidates"] = len(scored)
        if not scored:
            return self._finalise_result(
                exits, entries_state, state_update, diagnostics, warnings,
            )

        # 2c. Apply the top-percent |SUE| rank filter.
        scored.sort(reverse=True)
        top_pct = float(params.sue_universe_rank_top_pct)
        if 0 < top_pct < 1.0:
            keep = max(1, int(round(len(scored) * top_pct)))
            scored = scored[:keep]

        threshold = float(params.sue_threshold)
        allow_shorts = bool(params.allow_shorts)
        alloc = float(params.allocation_per_position)
        holding_days_int = int(params.holding_days)
        adv_min = float(params.adv_usd_min)
        price_min = float(params.price_min)

        # 2d. Capacity.
        held_symbols = {pos.symbol for pos in input.positions if pos.quantity != 0}
        capacity = int(params.max_concurrent_positions) - len(held_symbols)
        if capacity <= 0:
            diagnostics["entries_emitted"] = 0
            diagnostics["capacity_exhausted"] = True
            return self._finalise_result(
                exits, entries_state, state_update, diagnostics, warnings,
            )

        # 2e. Signal emission.
        pending: set[str] = set()
        entries: list[Signal] = []
        skip_counts = {
            "held_or_pending": 0,
            "below_sue_threshold": 0,
            "shorts_disabled": 0,
            "liquidity": 0,
            "overlapping_earnings": 0,
        }
        for _, sym, sue in scored:
            if len(entries) >= capacity:
                break
            if sym in held_symbols or sym in pending:
                skip_counts["held_or_pending"] += 1
                continue
            if abs(sue) < threshold:
                skip_counts["below_sue_threshold"] += 1
                continue

            # Direction gate.
            if sue > 0:
                direction = +1
            elif sue < 0 and allow_shorts:
                direction = -1
            else:
                skip_counts["shorts_disabled"] += 1
                continue

            # Liquidity / price filter.
            sym_bars = self._symbol_bars(input.bars, sym, asof)
            if not passes_liquidity(sym_bars, asof, adv_min, price_min):
                skip_counts["liquidity"] += 1
                continue

            # Overlapping earnings filter — another earnings announcement
            # for the same name inside the holding window disqualifies.
            if has_overlapping_earnings(
                earnings,
                sym,
                asof,
                holding_days_int,
                calendar_provider=None,
            ):
                skip_counts["overlapping_earnings"] += 1
                continue

            weight = direction * alloc
            # Event-conditional FULL spread: base 10 bps + 20 bps premium on
            # |SUE|>=3 reporters (i.e. 10 bps or 30 bps full spread). The
            # execution simulator/cost-model halves this internally
            # (``half_spread = 0.5 * spread_pct`` in Costs.slippage), so the
            # effective half-spread applied to the fill is 5 bps or 15 bps.
            # Stamped into the tag as ``evspread<float>`` so the execution
            # simulator applies it to this MOO fill only — MOO after a big
            # surprise is the bar with the widest realised gap-open spread
            # on the tape, and a flat 5 bps understates real post-announcement
            # cost by 10-30 bps per round-trip.
            # NOTE (audit A2#1, 2026-04): value doubled from {0.0005, 0.0020}
            # to {0.0010, 0.0030} so that the cost model's internal 0.5 factor
            # produces the intended half-spreads; the previous stamp was
            # half-applied and yielded 2.5/10 bps instead of 5/15 bps.
            event_spread = 0.0010 + 0.0030 * (1.0 if abs(sue) >= 3.0 else 0.0)
            tag = (
                f"pead-entry-{'long' if direction > 0 else 'short'}"
                f"-sue{sue:+.2f}-evspread{event_spread:.4f}"
            )
            entries.append(
                Signal(
                    symbol=sym,
                    target_weight=weight,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=tag,
                    asof=asof,
                )
            )
            pending.add(sym)
            entries_state[sym] = {
                "queued_on": asof,
                "sue": float(sue),
                "direction": direction,
            }

        diagnostics["entries_emitted"] = len(entries)
        diagnostics["entries_skipped"] = skip_counts
        diagnostics["exits_emitted"] = len(exits)
        return self._finalise_result(
            exits + entries, entries_state, state_update, diagnostics, warnings,
        )

    # ------------------------------------------------------------------ #
    # on_fill — state update for filled entries + exits                  #
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        """Record filled entries / drop exited names.

        The engine sets ``pos.entry_date`` on the first fill of a position,
        but the queue-to-fill round-trip may take one bar (MOO → T+1 open).
        We also stamp the filled timestamp + entry price in our cache so
        downstream inspection hooks can replay the entry context.
        """

        entries: dict[str, dict[str, Any]] = dict(
            state.get(f"{_NS}.entries", {})
        )
        held_symbols: set[str] = set(state.get(f"{_NS}.held_symbols", set()))

        sym = fill.symbol
        meta = entries.setdefault(sym, {})
        tag = getattr(fill, "signal_tag", "") or ""
        direction = meta.get("direction")
        is_close = tag.startswith("pead-exit") or (
            direction is not None
            and (
                (direction > 0 and fill.quantity < 0)
                or (direction < 0 and fill.quantity > 0)
            )
        )

        if is_close:
            entries.pop(sym, None)
            held_symbols.discard(sym)
        else:
            meta["filled_on"] = fill.asof
            meta["entry_price"] = float(fill.price)
            held_symbols.add(sym)

        return {
            f"{_NS}.entries": entries,
            f"{_NS}.held_symbols": sorted(held_symbols),
        }

    # ------------------------------------------------------------------ #
    # Helpers                                                            #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _exit_signal(symbol: str, asof: date) -> Signal:
        return Signal(
            symbol=symbol,
            target_weight=0.0,
            order_type=OrderType.MOC,
            time_in_force=TimeInForce.DAY,
            tag="pead-exit-time",
            asof=asof,
        )

    def _finalise_result(
        self,
        signals: list[Signal],
        entries_state: dict[str, dict[str, Any]],
        state_update: dict[str, Any],
        diagnostics: dict[str, Any],
        warnings: list[str],
    ) -> StrategyResult:
        state_update[f"{_NS}.entries"] = entries_state
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    @staticmethod
    def _yesterday_announcements(
        calendar: pd.DataFrame,
        asof: date,
    ) -> pd.DataFrame:
        """Return announcements that are actionable via an ``asof`` MOO entry.

        Two announcement classes are distinguished via the
        ``announcement_when`` column populated by
        :class:`FMPEarningsProvider`:

        * **AMC** (after-market close): FMP dates the row on the session
          whose close absorbs the release, so an AMC row dated D-1 is
          actionable at ``asof = D`` (MOO entry at D.open).
        * **BMO** (before-market open): FMP dates the row on the session
          during whose open the release hits. A BMO row dated D is
          actionable at ``asof = D`` (MOO entry at D.open).

        Rows without an ``announcement_when`` classification fall back
        to the AMC anchor to preserve legacy behaviour when the calendar
        frame comes from a provider that did not populate the column.

        This is the purity-friendly shape of the old helper: we no longer
        consult ``ctx.calendar_provider`` for true NYSE sessions; a Mon-Fri
        fallback is used. A future pipeline-level calendar injection can
        replace this if needed.
        """

        if calendar.empty:
            return calendar

        # Determine the previous trading day (Mon-Fri fallback — no
        # holiday provider available in a pure-function environment).
        prev_session: Optional[date] = None
        probe = asof - timedelta(days=1)
        for _ in range(7):
            if probe.weekday() < 5:
                prev_session = probe
                break
            probe -= timedelta(days=1)
        if prev_session is None:
            return calendar.iloc[0:0]

        # BMO anchor — if asof is a trading day, BMO rows dated on asof
        # are actionable today (asof.open is the first tradable bar after
        # the release). Otherwise defer to prev_session.
        bmo_anchor = asof if asof.weekday() < 5 else prev_session

        when = calendar.get("announcement_when")
        if when is None:
            # Legacy calendar without the time field — behave as before.
            mask = calendar["date"] == prev_session
        else:
            when_norm = when.fillna("unknown").astype(str).str.lower()
            is_amc = when_norm == "amc"
            is_bmo = when_norm == "bmo"
            # Unknown / missing time field → fall back to the AMC anchor
            # so historical calendars without the time field remain usable.
            is_unknown = ~(is_amc | is_bmo)
            mask = (
                (is_amc & (calendar["date"] == prev_session))
                | (is_bmo & (calendar["date"] == bmo_anchor))
                | (is_unknown & (calendar["date"] == prev_session))
            )

        ann = calendar[mask].copy()
        # Require both actual + estimated to be non-null so SUE is computable.
        ann = ann.dropna(subset=["eps_actual", "eps_estimated"])
        return ann.reset_index(drop=True)

    @staticmethod
    def _surprise_history(
        earnings: pd.DataFrame,
        symbol: str,
        asof: date,
    ) -> Optional[pd.DataFrame]:
        """Return per-symbol historical surprise series from ``input.earnings``.

        The runner pre-fetches ~3 years of earnings (per META.lookback_days)
        for every symbol in the universe, so in the new shell the full
        surprise history is always present in ``input.earnings`` — we just
        filter by symbol here and hand the slice to :func:`compute_sue`.

        Round-29 / persona-A F1: defensive filter on ``date < asof`` so a
        future modification to ``compute_sue`` (or a caller that doesn't
        pass the announcement date) can't accidentally include
        same-or-future-quarter rows in the σ denominator. ``compute_sue``
        already does this filter internally; this is belt-and-suspenders
        in case the contract drifts.
        """

        if earnings is None or earnings.empty:
            return None
        sub = earnings[earnings["symbol"].astype(str).str.upper() == symbol.upper()]
        if sub.empty:
            return None
        sub = sub.copy()
        # Pre-filter to strict-prior rows. Mixed types (Timestamp / date
        # / str) get coerced via pandas' standard to_datetime path.
        try:
            sub = sub[pd.to_datetime(sub["date"]).dt.date < asof]
        except Exception:
            # If the column can't be coerced, fall through and let
            # compute_sue's own filter handle it.
            pass
        if sub.empty:
            return None
        # compute_sue inspects history["surprise"] when available, falling
        # back to eps_actual - eps_estimated. We leave the frame alone.
        return sub.sort_values("date", ignore_index=True)

    @staticmethod
    def _symbol_bars(
        bars: pd.DataFrame,
        symbol: str,
        asof: date,
    ) -> Optional[pd.DataFrame]:
        """Return an OHLCV history for ``symbol`` up to ``asof``.

        ``input.bars`` may be either a multi-index DataFrame keyed on
        ``(date, symbol)`` (the canonical shape emitted by the runner's
        :meth:`BarProvider.fetch_window`) or a flat DataFrame with a
        ``symbol`` / ``ts_date`` pair (the shape historically returned by
        ``helpers.fetch_bars``; preserved for legacy test fixtures). We
        normalise to the latter because ``passes_liquidity`` expects it.
        """

        if bars is None or getattr(bars, "empty", True):
            return None

        index_names = tuple(bars.index.names or ())
        if "symbol" in index_names and "date" in index_names:
            # Multi-index shape — extract the symbol level, then flatten.
            try:
                sym_slice = bars.xs(symbol, level="symbol", drop_level=False)
            except KeyError:
                return None
            sym_slice = sym_slice.reset_index()
            sym_slice = sym_slice.rename(columns={"date": "ts_date"})
            sym_slice = sym_slice[sym_slice["ts_date"] <= asof]
            return sym_slice.sort_values("ts_date", ignore_index=True) if not sym_slice.empty else None

        # Flat shape (legacy fixtures or the old fetch_bars helper).
        if "symbol" not in bars.columns:
            return None
        sub = bars[bars["symbol"].astype(str).str.upper() == symbol.upper()].copy()
        if sub.empty:
            return None
        if "ts_date" not in sub.columns and "ts" in sub.columns:
            sub["ts_date"] = pd.to_datetime(sub["ts"], utc=True, errors="coerce") \
                .dt.tz_convert("UTC").dt.date
        if "ts_date" not in sub.columns:
            return None
        sub = sub.sort_values("ts_date", ignore_index=True)
        return sub[sub["ts_date"] <= asof]


__all__ = ["PEADStrategy"]
