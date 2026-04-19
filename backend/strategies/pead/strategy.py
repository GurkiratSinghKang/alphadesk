"""Post-Earnings Announcement Drift — production implementation.

Textbook PEAD on the Bernard-Thomas 1989 / Livnat-Mendenhall 2006 lines,
using real FMP earnings + historical surprises data. Long the top-|SUE|
positive surprises, short the bottom-|SUE| negative surprises (when
`allow_shorts=True`), hold for `holding_days` trading days, exit MOC.

See ``spec.md`` for the full academic reference. Data / SUE helpers live
in :mod:`.helpers` to keep this module under the 500-line cap.

Lifecycle summary
-----------------

- ``universe()``        -- the full seed list plus any open positions so
                           the engine marks them daily.
- ``manage()``          -- each day, exits positions that reached their
                           `holding_days` time-stop.
- ``generate_signals()``-- each day, fetches yesterday's earnings
                           announcements, computes SUE, emits MOO entries
                           for today's open.

No hard stops, no take-profits. The drift signal is time-exited only.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Optional

import pandas as pd

from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OrderType, Signal, TimeInForce

from .config import (
    DEFAULTS,
    UNIVERSE_SEED,
    load_universe,
    search_space,
)
from .helpers import (
    compute_sue,
    fetch_bars,
    get_calendar,
    get_surprises,
    has_overlapping_earnings,
    passes_liquidity,
    trading_days_between,
)


log = logging.getLogger("alphadesk.strategies.pead")


# --------------------------------------------------------------------------- #
# Registration shim (tolerates double-loading during Phase 1)                 #
# --------------------------------------------------------------------------- #
def _safe_register(*args, **kwargs):
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
# Calendar warmup: we need at least 4 quarters of historical surprises to
# compute SUE. Default 12 quarters gives comfortable slack (12 * ~90 days = 3y).
_REQUIRED_LOOKBACK_DAYS = 1100  # ~3 years of calendar
_NS = "pead"


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="pead",
    category="equity",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=10,
    supports_shorts=True,
    supports_options=False,
    description=(
        "Post-Earnings Announcement Drift (Bernard-Thomas 1989, "
        "Livnat-Mendenhall 2006). Long/short US equity on standardised "
        "unexpected earnings (SUE), 40-day drift window, MOC time-stop exit. "
        "Real FMP earnings + surprises; no demo RNG, no hardcoded calendar."
    ),
)
class PEADStrategy:
    """Long/short PEAD on US large-caps with SUE-gated entries."""

    name = "pead"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        """Merge tuner/user overrides onto defaults and coerce types."""

        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v

        # Type coercion.
        for k in (
            "holding_days",
            "sue_lookback_quarters",
            "max_concurrent_positions",
            "universe_min_mcap_bn",
            "min_quarters_for_sue",
        ):
            merged[k] = int(merged[k])
        for k in (
            "sue_threshold",
            "allocation_per_position",
            "sue_universe_rank_top_pct",
            "adv_usd_min",
            "price_min",
        ):
            merged[k] = float(merged[k])
        merged["allow_shorts"] = bool(merged["allow_shorts"])

        # Validation.
        if merged["sue_threshold"] <= 0:
            raise ValueError(f"sue_threshold must be > 0, got {merged['sue_threshold']}")
        if merged["holding_days"] <= 0:
            raise ValueError(f"holding_days must be > 0, got {merged['holding_days']}")
        if not (0 < merged["allocation_per_position"] <= 1.0):
            raise ValueError(
                f"allocation_per_position must be in (0, 1], got "
                f"{merged['allocation_per_position']}"
            )
        if merged["max_concurrent_positions"] <= 0:
            raise ValueError(
                f"max_concurrent_positions must be > 0, got "
                f"{merged['max_concurrent_positions']}"
            )
        if not (0 < merged["sue_universe_rank_top_pct"] <= 1.0):
            raise ValueError(
                f"sue_universe_rank_top_pct must be in (0, 1], got "
                f"{merged['sue_universe_rank_top_pct']}"
            )

        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        cache = cache_of(ctx)
        syms = cache.get(f"{_NS}.universe")
        if syms is None:
            syms = load_universe(
                asof=asof,
                fundamentals_provider=getattr(ctx, "fundamentals_provider", None),
            )
            cache[f"{_NS}.universe"] = syms
        out = set(syms)
        for p in ctx.positions:
            out.add(p.symbol)
        return sorted(out)

    # ------------------------------------------------------------------ #
    # Exits (called BEFORE generate_signals each bar)
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        holding = int(p["holding_days"])
        cache = cache_of(ctx)
        entries: dict[str, dict[str, Any]] = cache.setdefault(f"{_NS}.entries", {})

        out: list[Signal] = []
        for pos in ctx.positions:
            if pos.quantity == 0:
                continue
            meta = entries.get(pos.symbol)
            opened = pos.opened_at
            if opened is None and meta is not None:
                opened = meta.get("queued_on")
            if opened is None:
                # Unknown entry date — force close (safety net).
                out.append(self._exit_signal(pos.symbol, asof))
                continue
            held = trading_days_between(
                opened,
                asof,
                calendar_provider=getattr(ctx, "calendar_provider", None),
            )
            if held >= holding:
                out.append(self._exit_signal(pos.symbol, asof))
        return out

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

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        cache = cache_of(ctx)
        universe: list[str] = cache.get(f"{_NS}.universe") or list(UNIVERSE_SEED)

        # 1. Fetch the full calendar once for the whole study (cached).
        cal_start, cal_end = self._study_window(ctx, asof)
        calendar = get_calendar(ctx, cal_start, cal_end, universe)
        if calendar is None or calendar.empty:
            return []

        # 2. Find yesterday's announcements. Any name reporting strictly
        # before today is eligible for a T+1 MOO entry today.
        ann = self._yesterday_announcements(calendar, asof, ctx)
        if ann.empty:
            return []

        # 3. Compute SUE for each announcement.
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

            hist = get_surprises(ctx, sym, cal_start, cal_end)
            sue = compute_sue(
                eps_actual,
                eps_est,
                hist,
                ann_date,
                lookback_quarters=int(p["sue_lookback_quarters"]),
                min_quarters=int(p["min_quarters_for_sue"]),
            )
            if sue is None:
                continue
            scored.append((abs(sue), sym, sue))

        if not scored:
            return []

        # 4. Apply the top-percent |SUE| rank filter.
        scored.sort(reverse=True)
        top_pct = float(p["sue_universe_rank_top_pct"])
        if 0 < top_pct < 1.0:
            keep = max(1, int(round(len(scored) * top_pct)))
            scored = scored[:keep]

        threshold = float(p["sue_threshold"])
        allow_shorts = bool(p["allow_shorts"])
        alloc = float(p["allocation_per_position"])
        holding_days = int(p["holding_days"])
        adv_min = float(p["adv_usd_min"])
        price_min = float(p["price_min"])

        # 5. Capacity.
        held_symbols = {pos.symbol for pos in ctx.positions if pos.quantity != 0}
        capacity = int(p["max_concurrent_positions"]) - len(held_symbols)
        if capacity <= 0:
            return []

        # 6. Signal emission.
        pending: set[str] = set()
        entries_cache: dict[str, dict[str, Any]] = cache.setdefault(
            f"{_NS}.entries", {}
        )
        out: list[Signal] = []
        for _, sym, sue in scored:
            if len(out) >= capacity:
                break
            if sym in held_symbols or sym in pending:
                continue
            if abs(sue) < threshold:
                continue

            # Direction gate.
            if sue > 0:
                direction = +1
            elif sue < 0 and allow_shorts:
                direction = -1
            else:
                continue

            # Liquidity / price filter.
            bars = self._symbol_bars(ctx, sym, asof)
            if not passes_liquidity(bars, asof, adv_min, price_min):
                continue

            # Overlapping earnings filter.
            if has_overlapping_earnings(
                calendar,
                sym,
                asof,
                holding_days,
                calendar_provider=getattr(ctx, "calendar_provider", None),
            ):
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
            out.append(
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
            entries_cache[sym] = {
                "queued_on": asof,
                "sue": float(sue),
                "direction": direction,
            }
        return out

    def on_fill(self, fill: Any, ctx: Context) -> None:
        """Record filled entries so `manage()` can apply the time-stop.

        The engine sets ``pos.opened_at`` on the first fill of a position,
        but the queue-to-fill round-trip may take one bar (MOO → T+1 open).
        We record the filled timestamp in our cache as a belt-and-braces
        signal for the time-stop.
        """

        cache = cache_of(ctx)
        entries: dict[str, dict[str, Any]] = cache.setdefault(
            f"{_NS}.entries", {}
        )
        sym = fill.symbol
        meta = entries.setdefault(sym, {})
        try:
            is_close = fill.tag.startswith("pead-exit") or (
                meta.get("direction") is not None
                and (
                    (meta["direction"] > 0 and fill.side.value == "sell")
                    or (meta["direction"] < 0 and fill.side.value == "buy")
                )
            )
        except Exception:
            is_close = False

        if is_close:
            entries.pop(sym, None)
        else:
            meta["filled_on"] = fill.ts
            meta["entry_price"] = float(fill.price)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _study_window(self, ctx: Context, asof: date) -> tuple[date, date]:
        """Return (start, end) for the full-study calendar cache.

        Calendar start is pegged at the earliest asof we see (minus 60
        days to detect T+1 announcements and warm the overlap filter).
        End grows in 1-year increments so a multi-year backtest doesn't
        refetch the calendar on every session; the :func:`get_calendar`
        chunks the fetch into quarterly windows to stay under FMP's
        4000-row / 5-year limits.

        The per-symbol surprises endpoint returns up to 160 quarters
        (~40y) so a short calendar window does not starve the
        trailing-σ computation.
        """

        cache = cache_of(ctx)
        window = cache.get(f"{_NS}.window")
        if window is None:
            start = asof - timedelta(days=60)
            end = asof + timedelta(days=365)
            window = (start, end)
            cache[f"{_NS}.window"] = window
        elif asof > window[1] - timedelta(days=30):
            # Extend by another year when we approach the existing
            # upper bound. This keeps the calendar frame warm across
            # a multi-year backtest without refetching on every day.
            start, _old_end = window
            window = (start, asof + timedelta(days=365))
            cache[f"{_NS}.window"] = window
        return window

    @staticmethod
    def _yesterday_announcements(
        calendar: pd.DataFrame,
        asof: date,
        ctx: Optional[Context] = None,
    ) -> pd.DataFrame:
        """Return announcements that are actionable via an ``asof`` MOO entry.

        Two announcement classes are distinguished via the
        ``announcement_when`` column populated by
        :class:`FMPEarningsProvider`:

        * **AMC** (after-market close): FMP dates the row on the session
          whose close absorbs the release, so an AMC row dated D-1 is
          actionable at ``asof = D`` (MOO entry at D.open). This was the
          pre-existing behaviour and is preserved.
        * **BMO** (before-market open): FMP dates the row on the session
          during whose open the release hits. A BMO row dated D is
          actionable at ``asof = D+1`` (MOO entry at D+1.open). The
          previous implementation dropped these rows entirely — treating
          every announcement as AMC — which silently excluded ~40-50%
          of the S&P 500 reporter population from the strategy.

        Rows without an ``announcement_when`` classification fall back
        to the AMC anchor to preserve legacy behaviour when the calendar
        frame comes from a provider that did not populate the column.
        """

        if calendar.empty:
            return calendar

        # Determine the previous trading day. Prefer the engine's
        # calendar provider for true NYSE-holiday-aware sessions.
        prev_session: Optional[date] = None
        cal_provider = None
        if ctx is not None:
            cal_provider = (
                getattr(ctx, "calendar_provider", None)
                or getattr(ctx, "calendar", None)
            )
        if cal_provider is not None:
            try:
                if hasattr(cal_provider, "previous_session"):
                    raw = cal_provider.previous_session(asof)
                    if raw is not None:
                        prev_session = (
                            raw if isinstance(raw, date)
                            else pd.Timestamp(raw).date()
                        )
                elif hasattr(cal_provider, "sessions"):
                    # Fallback: enumerate sessions in a small window.
                    sess = list(
                        cal_provider.sessions(
                            asof - timedelta(days=14), asof
                        )
                    )
                    parsed = [
                        s if isinstance(s, date) else pd.Timestamp(s).date()
                        for s in sess
                    ]
                    parsed = sorted({s for s in parsed if s < asof})
                    if parsed:
                        prev_session = parsed[-1]
            except Exception:
                prev_session = None

        if prev_session is None:
            # Mon-Fri fallback (does not honour NYSE holidays — tracked
            # as a separate P2 audit finding). Walks back through the
            # calendar to find a weekday before ``asof``.
            probe = asof - timedelta(days=1)
            for _ in range(7):
                if probe.weekday() < 5:
                    prev_session = probe
                    break
                probe -= timedelta(days=1)
            if prev_session is None:
                return calendar.iloc[0:0]

        # Determine the "BMO anchor" — the session whose BMO releases
        # become actionable on ``asof``. If ``asof`` itself is a trading
        # session, that's ``asof``; otherwise we defer to ``prev_session``.
        bmo_anchor: date = asof
        if cal_provider is not None and hasattr(cal_provider, "is_trading_day"):
            try:
                if not cal_provider.is_trading_day(asof):
                    bmo_anchor = prev_session
            except Exception:
                pass

        # Two-anchor slice. AMC rows dated on the previous session are
        # eligible for today's MOO; BMO rows dated on the ``bmo_anchor``
        # session are eligible for today's MOO (asof.open is the first
        # tradable bar after a BMO release on the same day).
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

    def _symbol_bars(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[pd.DataFrame]:
        """Return a cached OHLCV history for ``sym`` up to ``asof``."""

        cache = cache_of(ctx)
        bucket: dict[str, pd.DataFrame] = cache.setdefault(_NS + ".bars", {})
        existing = bucket.get(sym)
        if existing is not None:
            last_date = (
                existing["ts_date"].iloc[-1] if not existing.empty else None
            )
            if last_date is not None and last_date >= asof:
                return existing[existing["ts_date"] <= asof]

        start = asof - timedelta(days=180)
        end = asof + timedelta(days=400)
        df = fetch_bars(ctx, [sym], start, end)
        if df is None or df.empty:
            bucket[sym] = pd.DataFrame(
                columns=["symbol", "ts", "ts_date", "open", "high", "low", "close", "volume"]
            )
            return None
        sub = df[df["symbol"] == sym].copy()
        if sub.empty:
            bucket[sym] = sub
            return None
        sub = sub.sort_values("ts", ignore_index=True)
        bucket[sym] = sub
        return sub[sub["ts_date"] <= asof]


__all__ = ["PEADStrategy"]
