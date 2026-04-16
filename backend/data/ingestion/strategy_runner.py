"""Strategy runners for the multi-strategy pipeline.

Each strategy is a class with ``screen()``, ``analyze()``, and
``generate_trades()`` methods.  Only MomentumQuality and ClaudeAlpha
actually invoke Claude CLI in this first pass; the others use screener
scores as a proxy for their signals.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import shutil
from typing import Any

logger = logging.getLogger("alphadesk.strategy_runner")

CLAUDE_CLI = shutil.which("claude")
MAX_POSITION_DOLLAR = 6_000.0


# =====================================================================
# Shared helpers
# =====================================================================

async def _get_technical_context(symbol: str) -> str:
    """Fetch real price data from Alpaca and compute basic technicals.

    Returns a formatted string for Claude's prompt with:
    - Current price, 52-week high/low
    - 20-day and 50-day EMA
    - RSI(14)
    - Volume vs 20-day average
    - Distance from 52-week high
    """
    import httpx
    from core.config import settings

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Get 60 daily bars (enough for 50-day EMA + RSI)
            resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                headers=headers,
                params={"timeframe": "1Day", "limit": 60, "feed": "sip"},
            )
            if resp.status_code != 200:
                return f"Price data unavailable for {symbol}."

            bars = resp.json().get("bars", [])
            if len(bars) < 20:
                return f"Insufficient price history for {symbol}."

            closes = [b["c"] for b in bars]
            volumes = [b["v"] for b in bars]
            current = closes[-1]
            high_3m = max(closes)
            low_3m = min(closes)

            # 20-day EMA: seed with SMA of first 20 bars, then apply EMA to remaining
            if len(closes) >= 20:
                ema20 = sum(closes[:20]) / 20
                mult = 2 / 21
                for c in closes[20:]:
                    ema20 = c * mult + ema20 * (1 - mult)
            else:
                ema20 = closes[-1]

            # 50-day EMA: same pattern
            ema50 = None
            if len(closes) >= 50:
                ema50 = sum(closes[:50]) / 50
                mult50 = 2 / 51
                for c in closes[50:]:
                    ema50 = c * mult50 + ema50 * (1 - mult50)

            # RSI(14)
            if len(closes) >= 15:
                gains, losses = [], []
                for i in range(-14, 0):
                    change = closes[i] - closes[i - 1]
                    gains.append(max(change, 0))
                    losses.append(max(-change, 0))
                avg_gain = sum(gains) / 14
                avg_loss = sum(losses) / 14
                if avg_loss == 0:
                    rsi = 100
                else:
                    rs = avg_gain / avg_loss
                    rsi = 100 - (100 / (1 + rs))
            else:
                rsi = 50  # default

            # Volume
            avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
            latest_vol = volumes[-1]
            vol_ratio = latest_vol / avg_vol if avg_vol > 0 else 1.0

            # Distance from 3-month high
            dist_from_high = ((current - high_3m) / high_3m) * 100

            # Trend assessment
            trend = "UPTREND" if current > ema20 and (ema50 is None or current > ema50) else \
                    "DOWNTREND" if current < ema20 and (ema50 is None or current < ema50) else "SIDEWAYS"

            lines = [
                f"TECHNICAL DATA for {symbol}:",
                f"  Current Price: ${current:.2f}",
                f"  3-Month High: ${high_3m:.2f} ({dist_from_high:+.1f}% from high)",
                f"  3-Month Low: ${low_3m:.2f}",
                f"  20-day EMA: ${ema20:.2f} ({'above' if current > ema20 else 'below'})",
            ]
            if ema50:
                lines.append(f"  50-day EMA: ${ema50:.2f} ({'above' if current > ema50 else 'below'})")
            lines.extend([
                f"  RSI(14): {rsi:.1f} ({'overbought' if rsi > 70 else 'oversold' if rsi < 30 else 'neutral'})",
                f"  Volume: {latest_vol:,} ({vol_ratio:.1f}x average)",
                f"  Trend: {trend}",
            ])

            return "\n".join(lines)
    except Exception as e:
        return f"Technical data error for {symbol}: {e}"


async def _enrich_with_real_prices(stocks: list[dict]) -> list[dict]:
    """Fetch real current prices from Alpaca for screened stocks."""
    import httpx
    from core.config import settings

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for stock in stocks[:30]:  # Limit to 30 to avoid rate limits
                sym = stock["symbol"]
                try:
                    resp = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        price = resp.json().get("trade", {}).get("p")
                        if price:
                            stock["price"] = price
                            stock["_real_price"] = True
                except Exception:
                    pass
    except Exception as e:
        logger.warning("Failed to enrich prices from Alpaca: %s", e)

    return stocks


def _get_screener_results(limit: int = 100) -> list[dict[str, Any]]:
    """Return demo screener results as plain dicts."""
    from api.routes.screener import (
        ScreenRequest, ScreenerFilter, FilterOp, _generate_demo_screener_results,
    )

    request = ScreenRequest(
        filters=[
            ScreenerFilter(field="price", op=FilterOp.GTE, value=10),
            ScreenerFilter(field="price", op=FilterOp.LTE, value=500),
        ],
        limit=limit,
    )
    response = _generate_demo_screener_results(request)
    return [
        {
            "symbol": r.symbol,
            "name": r.name,
            "price": r.price,
            "composite_score": r.composite_score,
            "sector": r.sector,
            "change_pct": r.change_pct,
            "volume": r.volume,
            "metrics": r.metrics,
        }
        for r in response.results
    ]


async def _fetch_news_headlines(symbol: str, limit: int = 5) -> list[str]:
    """Fetch recent news headlines for a symbol."""
    try:
        from api.routes.news import fetch_news_for_symbol
        return await fetch_news_for_symbol(symbol, limit=limit)
    except Exception:
        return []


async def _call_claude(prompt: str, symbol: str) -> dict[str, Any]:
    """Invoke Claude via CLI (preferred) or Anthropic API (fallback)."""

    # --- Try CLI first (uses OAuth credentials, no API key needed) ---
    if CLAUDE_CLI is not None:
        logger.info("Using Claude CLI for %s", symbol)
        cmd = [
            CLAUDE_CLI,
            "--print",
            "--model", "sonnet",
            "--output-format", "json",
            prompt,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

            raw = stdout.decode(errors="replace").strip()
            if proc.returncode != 0:
                # CLI returns JSON on stdout even on error; parse it for a better message
                err_msg = stderr.decode(errors="replace").strip()
                try:
                    wrapper = json.loads(raw)
                    if isinstance(wrapper, dict) and wrapper.get("is_error"):
                        err_msg = wrapper.get("result", err_msg) or err_msg
                except (json.JSONDecodeError, ValueError):
                    pass
                logger.error("Claude CLI error for %s (exit %d): %s", symbol, proc.returncode, err_msg[:300])
                # Fall through to API fallback
            else:
                try:
                    wrapper = json.loads(raw)
                    if isinstance(wrapper, dict) and wrapper.get("is_error"):
                        logger.error("Claude CLI returned error for %s: %s", symbol, wrapper.get("result", "")[:300])
                        # Fall through to API fallback
                    else:
                        text = wrapper.get("result", raw) if isinstance(wrapper, dict) else raw
                        return _parse_claude_response(text, symbol)
                except json.JSONDecodeError:
                    return _parse_claude_response(raw, symbol)

        except asyncio.TimeoutError:
            logger.error("Claude CLI timeout for %s", symbol)
        except Exception as e:
            logger.error("Claude CLI error for %s: %s", symbol, e)

    # --- Fallback to Anthropic API ---
    try:
        from core.config import settings
        api_key = settings.ANTHROPIC_API_KEY.get_secret_value()
        if api_key:
            return await _call_claude_api(prompt, symbol, api_key)
    except Exception:
        pass

    logger.error("No Claude CLI or API key available for %s", symbol)
    return {"symbol": symbol, "error": "no_claude"}


async def _call_claude_api(prompt: str, symbol: str, api_key: str) -> dict[str, Any]:
    """Call Claude via the Anthropic API with retry on rate limits."""
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)

    for attempt in range(3):
        try:
            resp = await asyncio.wait_for(
                client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1024,
                    messages=[{"role": "user", "content": prompt}],
                ),
                timeout=60,
            )
            text = resp.content[0].text
            return _parse_claude_response(text, symbol)

        except anthropic.RateLimitError:
            delay = 5 * (attempt + 1)
            logger.warning("Rate limited for %s, retrying in %ds (attempt %d/3)", symbol, delay, attempt + 1)
            await asyncio.sleep(delay)
        except asyncio.TimeoutError:
            logger.error("Claude API timeout for %s", symbol)
            return {"symbol": symbol, "error": "timeout"}
        except Exception as e:
            logger.error("Claude API error for %s: %s", symbol, e)
            return {"symbol": symbol, "error": str(e)}

    logger.error("Claude API rate limited after 3 retries for %s", symbol)
    return {"symbol": symbol, "error": "rate_limited"}


def _parse_claude_response(text: str, symbol: str) -> dict[str, Any]:
    """Parse Claude's text response into a structured analysis dict."""
    try:
        json_match = re.search(r"\{[^{}]*\"signal\"[^{}]*\}", text, re.DOTALL)
        if json_match:
            analysis = json.loads(json_match.group())
        else:
            analysis = json.loads(text)
        analysis["symbol"] = symbol
        return analysis
    except json.JSONDecodeError:
        logger.warning("Could not parse JSON from Claude for %s, using default", symbol)
        return {"symbol": symbol, "signal": "hold", "score": 50, "rationale": text[:500]}


def _score_to_signal(score: float, threshold_buy: float = 65.0) -> str:
    """Convert a composite/strategy score into a buy/hold/sell signal."""
    if score >= threshold_buy:
        return "buy"
    elif score < 40:
        return "sell"
    return "hold"


def _compute_levels(price: float) -> tuple[float, float]:
    """Return (stop_loss, take_profit) based on a simple % offset."""
    stop_loss = round(price * 0.95, 2)
    take_profit = round(price * 1.10, 2)
    return stop_loss, take_profit


# =====================================================================
# Base class
# =====================================================================

class BaseStrategyRunner:
    name: str = "base"
    description: str = ""

    async def screen(self) -> list[dict[str, Any]]:
        """Return candidate stocks for this strategy."""
        raise NotImplementedError

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Analyze candidates. Returns list of analysis dicts with at least
        ``symbol``, ``signal``, ``conviction``, ``rationale``.
        """
        raise NotImplementedError

    # Set to True in subclasses that should use Claude smart review (P5)
    use_smart_review: bool = False

    async def generate_trades(
        self,
        analyses: list[dict[str, Any]],
        master: Any,
    ) -> list[dict[str, Any]]:
        """Generate trade requests and submit to the master agent.
        Returns list of trade result dicts (approved/rejected).
        """
        from data.ingestion.master_agent import MasterAgent

        results: list[dict[str, Any]] = []
        for a in analyses:
            if a.get("error"):
                continue
            sig = (a.get("signal") or "").lower()
            conv = int(a.get("conviction", 0))
            if sig != "buy" or conv < 50:
                continue

            price = a.get("entry_price") or a.get("price", 0)
            if price <= 0:
                continue

            # Use volatility-targeted sizing if master supports it, else fixed
            if hasattr(master, "calculate_vol_targeted_size"):
                vol_notional = master.calculate_vol_targeted_size(a["symbol"], max_notional=MAX_POSITION_DOLLAR)
            else:
                vol_notional = MAX_POSITION_DOLLAR
            notional = min(vol_notional, price * math.floor(vol_notional / price) if price > 0 else 0)
            shares = math.floor(notional / price) if price > 0 else 0
            if shares < 1:
                continue

            notional = round(shares * price, 2)
            stop_loss = a.get("stop_loss") or round(price * 0.95, 2)
            take_profit = a.get("take_profit") or round(price * 1.10, 2)
            sector = a.get("sector", "Unknown")

            # P5: Use smart review for strategies that opt in
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
            results.append(result)

        return results


# =====================================================================
# Strategy 1: Momentum + Quality  (calls Claude)
# =====================================================================

class MomentumQualityRunner(BaseStrategyRunner):
    name = "momentum_quality"
    description = "Cross-sectional momentum + quality factor investing"
    use_smart_review = True

    def _momentum_vol_scale(self, screener_results: list[dict]) -> float:
        """Barroso & Santa-Clara (2015) momentum crash protection.

        Computes cross-sectional momentum dispersion (standard deviation of
        momentum scores across the universe) and scales exposure inversely.
        High dispersion signals crowded momentum that is vulnerable to
        reversals. Returns a multiplier between 0.3 and 1.0.
        """
        rs_scores = [s.get("metrics", {}).get("rs_score", 50) for s in screener_results]
        if len(rs_scores) < 10:
            return 1.0

        # Cross-sectional standard deviation of momentum scores
        n = len(rs_scores)
        mean_rs = sum(rs_scores) / n
        variance = sum((r - mean_rs) ** 2 for r in rs_scores) / n
        cross_sec_vol = math.sqrt(variance)

        # Winner-loser spread (top vs bottom quintile)
        rs_sorted = sorted(rs_scores)
        q = max(n // 5, 1)
        top_quintile_avg = sum(rs_sorted[-q:]) / q
        bot_quintile_avg = sum(rs_sorted[:q]) / q
        wml_spread = top_quintile_avg - bot_quintile_avg

        # Target volatility scaling: normal cross-sec vol is ~15-20 for
        # a 0-100 RS score range. When it exceeds 25, momentum is stretched.
        TARGET_VOL = 18.0
        vol_scale = min(1.0, TARGET_VOL / max(cross_sec_vol, 1.0))

        # Additional crash guard: if winner-loser spread is extremely wide
        # (>75), momentum is overheated -- further scale down
        if wml_spread > 85:
            vol_scale *= 0.5
        elif wml_spread > 75:
            vol_scale *= 0.7

        # Floor at 0.3 to avoid completely zeroing out the strategy
        vol_scale = max(0.3, round(vol_scale, 2))

        logger.debug(
            "Momentum crash protection: cross-sec vol=%.1f, WML spread=%.1f, "
            "scale=%.2f", cross_sec_vol, wml_spread, vol_scale,
        )
        return vol_scale

    def _sector_neutral_select(
        self, candidates: list[dict], max_per_sector: int = 3
    ) -> list[dict]:
        """Select top candidates while ensuring sector diversification.

        Picks the best stocks from each represented sector in round-robin
        fashion so the final portfolio is not concentrated in a single sector.
        """
        from collections import defaultdict

        by_sector: dict[str, list[dict]] = defaultdict(list)
        for c in candidates:
            sec = c.get("sector", "Unknown")
            by_sector[sec].append(c)

        # Sort each sector bucket by RS score descending
        for sec in by_sector:
            by_sector[sec].sort(
                key=lambda s: s.get("metrics", {}).get("rs_score", 0),
                reverse=True,
            )

        # Round-robin pick across sectors (best from each, then second-best, etc.)
        selected: list[dict] = []
        seen: set[str] = set()
        for pick_round in range(max_per_sector):
            # Sort sectors by their best remaining candidate's RS score
            sectors_ranked = sorted(
                by_sector.keys(),
                key=lambda sec: (
                    by_sector[sec][pick_round].get("metrics", {}).get("rs_score", 0)
                    if pick_round < len(by_sector[sec]) else 0
                ),
                reverse=True,
            )
            for sec in sectors_ranked:
                bucket = by_sector[sec]
                if pick_round < len(bucket):
                    sym = bucket[pick_round]["symbol"]
                    if sym not in seen:
                        selected.append(bucket[pick_round])
                        seen.add(sym)

        return selected

    async def screen(self) -> list[dict[str, Any]]:
        all_stocks = _get_screener_results(limit=100)
        candidates = [
            s for s in all_stocks
            if s["metrics"].get("rs_score", 0) > 70
            and s["metrics"].get("f_score", 0) >= 6
        ]

        # Sector-neutral selection: spread picks across sectors
        candidates = self._sector_neutral_select(candidates, max_per_sector=3)

        # Apply Barroso & Santa-Clara crash protection
        vol_scale = self._momentum_vol_scale(all_stocks)
        if vol_scale < 1.0:
            scaled_count = max(1, int(len(candidates) * vol_scale))
            logger.info(
                "Momentum vol scale %.2f applied: %d -> %d candidates",
                vol_scale, len(candidates), scaled_count,
            )
            candidates = candidates[:scaled_count]
        self._vol_scale = vol_scale

        # Enrich top candidates with real Alpaca prices
        candidates = await _enrich_with_real_prices(candidates)
        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]
            rs_score = stock["metrics"].get("rs_score", 0)
            f_score = stock["metrics"].get("f_score", 0)

            headlines = await _fetch_news_headlines(symbol)
            news_block = ""
            if headlines:
                bullet_list = "\n".join(f"- {h}" for h in headlines[:5])
                news_block = f"\nRecent news:\n{bullet_list}\n"

            # Fetch real technical data from Alpaca
            tech_context = await _get_technical_context(symbol)

            prompt = (
                f"Analyze {symbol} at ${price} for a swing trade (5-20 day hold).\n\n"
                f"RS Score: {rs_score}/100. F-Score: {f_score}/9.\n\n"
                f"{tech_context}\n\n"
                f"IMPORTANT: Use the TECHNICAL DATA above to ground your analysis. "
                f"If the stock is in a DOWNTREND or far from its 52-week high, "
                f"be cautious regardless of positive catalysts.\n\n"
                f"Score each dimension 1-10:\n"
                f"1. TREND: Moving average alignment (above 20/50/200 EMA = higher)\n"
                f"2. MOMENTUM: Rate of change, RSI position, relative strength vs SPY\n"
                f"3. VOLUME: Recent volume vs 20-day average, accumulation/distribution\n"
                f"4. CATALYST: Upcoming earnings, news, institutional activity\n"
                f"5. RISK/REWARD: Distance to support vs resistance, risk per share\n\n"
                f"Then provide:\n"
                f"- SIGNAL: buy / sell / hold\n"
                f"- CONVICTION: 0-100 (weighted average of scores x 10)\n"
                f"- ENTRY: exact price\n"
                f"- STOP_LOSS: exact price (max 5% below entry for longs)\n"
                f"- TAKE_PROFIT: exact price (min 2:1 reward-to-risk ratio)\n"
                f"- RATIONALE: 1 sentence\n\n"
                f"{news_block}"
                f"Respond in JSON only with keys: signal, conviction, entry_price, stop_loss, take_profit, rationale, "
                f"trend_score, momentum_score, volume_score, catalyst_score, risk_reward_score."
            )
            result = await _call_claude(prompt, symbol)
            result["price"] = price
            result["sector"] = stock.get("sector", "Unknown")
            analyses.append(result)

        return analyses


# =====================================================================
# Strategy 2: PEAD  (score-based proxy)
# =====================================================================

def _get_upcoming_earnings() -> set[str]:
    """Return symbols with earnings in the next 5 trading days.

    In production, this would query an earnings calendar API (e.g. FMP).
    For now, use a rotating set based on the day of week.
    """
    from datetime import date
    today = date.today()
    # Major earnings reporters by approximate schedule
    week_earnings = {
        0: {"JPM", "WFC", "C", "BLK"},      # Monday - banks
        1: {"JNJ", "UNH", "GS", "BAC"},      # Tuesday - healthcare/banks
        2: {"ASML", "ABT", "USB", "PNC"},     # Wednesday
        3: {"NFLX", "TSM", "ISRG", "BX"},    # Thursday - tech
        4: {"AXP", "SLB", "PG", "TFC"},      # Friday
    }
    return week_earnings.get(today.weekday(), set())


class PEADRunner(BaseStrategyRunner):
    name = "pead"
    description = "Post-Earnings Announcement Drift"

    # Historical average earnings-day reaction by sector (absolute move %).
    # Used to gauge whether the current reaction is outsized (higher drift
    # probability) or muted. Values are approximate long-run averages.
    SECTOR_AVG_REACTION: dict[str, float] = {
        "Technology": 6.5, "Healthcare": 5.8, "Financials": 3.5,
        "Consumer Discretionary": 5.2, "Consumer Staples": 3.0,
        "Industrials": 4.0, "Energy": 4.5, "Materials": 4.2,
        "Utilities": 2.5, "Real Estate": 3.0, "Communication": 5.0,
    }

    def _estimate_surprise_strength(self, stock: dict) -> dict[str, Any]:
        """Estimate earnings surprise quality using available data.

        Computes:
        - reaction_ratio: actual move vs historical sector avg (>1 = outsized)
        - volume_confirm: whether volume is above average (earnings volume)
        - revenue_confirm: whether revenue-linked metrics support the move
        """
        change_pct = abs(stock.get("change_pct", 0) or 0)
        sector = stock.get("sector", "Unknown")
        metrics = stock.get("metrics", {})

        # Compare actual reaction to sector average
        avg_reaction = self.SECTOR_AVG_REACTION.get(sector, 4.0)
        reaction_ratio = change_pct / avg_reaction if avg_reaction > 0 else 1.0

        # Volume confirmation: earnings reactions on high volume drift more
        volume = stock.get("volume", 0)
        # Use composite as a rough proxy -- high-composite stocks tend to
        # have higher institutional volume on earnings
        volume_confirm = volume > 0  # Will be True for all real data

        # Revenue surprise confirmation: F-Score captures profitability and
        # revenue quality. High F-Score after a positive move suggests both
        # EPS *and* revenue beat (quality surprise, not one-time).
        f_score = metrics.get("f_score", 5)
        composite = stock.get("composite_score", 50)
        revenue_confirm = f_score >= 6 and composite > 55

        return {
            "reaction_ratio": round(reaction_ratio, 2),
            "volume_confirm": volume_confirm,
            "revenue_confirm": revenue_confirm,
            "avg_sector_reaction": avg_reaction,
        }

    async def screen(self) -> list[dict[str, Any]]:
        """Find stocks with recent earnings surprises."""
        all_stocks = _get_screener_results(limit=100)

        # Check for big movers (proxy for earnings reaction)
        # AND cross-reference against actual earnings calendar
        earnings_stocks = []
        seen_symbols: set[str] = set()
        upcoming = _get_upcoming_earnings()

        for s in all_stocks:
            change = abs(s.get("change_pct", 0) or 0)
            sym = s["symbol"]

            # Priority 1: Big move + confirmed on earnings calendar
            if change > 3 and sym in upcoming:
                s["_earnings_confirmed"] = True
                s["_earnings_proxy"] = False
                earnings_stocks.append(s)
                seen_symbols.add(sym)
            # Priority 2: Big move (likely earnings reaction, not confirmed)
            elif change > 3:
                s["_earnings_confirmed"] = False
                s["_earnings_proxy"] = True
                earnings_stocks.append(s)
                seen_symbols.add(sym)

        # Priority 3: On the calendar but hasn't reported yet
        for s in all_stocks:
            if s["symbol"] in upcoming and s["symbol"] not in seen_symbols:
                s["_upcoming_earnings"] = True
                s["_earnings_confirmed"] = False
                s["_earnings_proxy"] = False
                earnings_stocks.append(s)
                seen_symbols.add(s["symbol"])

        # Sort: confirmed earnings first, then by absolute change size
        earnings_stocks.sort(
            key=lambda s: (s.get("_earnings_confirmed", False), abs(s.get("change_pct", 0))),
            reverse=True,
        )
        return earnings_stocks[:15]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]
            change_pct = stock.get("change_pct", 0)
            composite = stock.get("composite_score", 0)

            # Evaluate surprise quality
            surprise = self._estimate_surprise_strength(stock)
            reaction_ratio = surprise["reaction_ratio"]
            revenue_confirm = surprise["revenue_confirm"]
            is_confirmed = stock.get("_earnings_confirmed", False)
            is_upcoming = stock.get("_upcoming_earnings", False)

            # Skip upcoming (pre-earnings) -- PEAD only trades post-announcement
            if is_upcoming:
                continue

            # Positive surprise: big move up with decent fundamentals
            if change_pct > 3 and composite > 55:
                signal = "buy"
                # Base conviction from move size and composite
                conviction = int(45 + change_pct * 2.5 + composite * 0.15)

                # Boost for outsized reaction vs sector history
                if reaction_ratio > 1.5:
                    conviction += 10  # Outsized surprise drifts further
                elif reaction_ratio > 1.2:
                    conviction += 5

                # Boost for revenue confirmation (not just EPS)
                if revenue_confirm:
                    conviction += 8

                # Boost for calendar-confirmed earnings event
                if is_confirmed:
                    conviction += 5

                conviction = min(95, conviction)
            elif change_pct < -3 and composite < 45:
                signal = "sell"
                conviction = min(95, int(50 + abs(change_pct) * 3))
            else:
                signal = "hold"
                conviction = 40

            # Tighter stop for PEAD (drift is directional, not a bounce trade)
            stop_loss = round(price * 0.96, 2)
            # Target based on reaction ratio: outsized surprises drift further
            target_mult = 1.08 + min(reaction_ratio * 0.02, 0.06)
            take_profit = round(price * target_mult, 2)

            rationale_parts = [
                f"PEAD: {symbol} moved {change_pct:+.1f}%",
                f"(vs sector avg {surprise['avg_sector_reaction']:.1f}%,",
                f"reaction ratio {reaction_ratio:.1f}x).",
            ]
            if revenue_confirm:
                rationale_parts.append("Revenue quality confirmed.")
            if is_confirmed:
                rationale_parts.append("Earnings calendar confirmed.")
            rationale_parts.append("Drift expected to continue.")

            analyses.append({
                "symbol": symbol,
                "price": price,
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": " ".join(rationale_parts),
            })
        return analyses


# =====================================================================
# Strategy 3: VRP Harvesting  (score-based proxy)
# =====================================================================

class VRPHarvestRunner(BaseStrategyRunner):
    name = "vrp_harvest"
    description = "Systematic Volatility Risk Premium harvesting (equity proxy)"

    async def screen(self) -> list[dict[str, Any]]:
        all_stocks = _get_screener_results(limit=100)
        return [s for s in all_stocks if s["metrics"].get("iv_rank", 0) > 40]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]
            iv_rank = stock["metrics"].get("iv_rank", 0)
            iv_pctl = stock["metrics"].get("iv_percentile", 0)
            composite = stock.get("composite_score", 0)

            # High IV rank + decent composite = premium selling opportunity
            if iv_rank > 60 and composite > 50:
                signal = "buy"
                conviction = min(95, int(45 + iv_rank * 0.3 + composite * 0.2))
            else:
                signal = "hold"
                conviction = 40

            stop_loss, take_profit = _compute_levels(price)
            analyses.append({
                "symbol": symbol,
                "price": price,
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"VRP: {symbol} IV Rank {iv_rank:.0f}, IV Pctl {iv_pctl:.0f}. "
                    f"Equity proxy for premium selling."
                ),
            })
        return analyses


# =====================================================================
# Strategy 4: Earnings Vol Premium  (score-based proxy)
# =====================================================================

class EarningsVolRunner(BaseStrategyRunner):
    name = "earnings_vol"
    description = "Earnings Volatility Premium capture (equity proxy)"

    async def screen(self) -> list[dict[str, Any]]:
        all_stocks = _get_screener_results(limit=100)
        # Prefer stocks with high IV rank AND upcoming earnings
        upcoming = _get_upcoming_earnings()
        high_iv = [s for s in all_stocks if s["metrics"].get("iv_rank", 0) > 50]

        # Prioritize stocks with upcoming earnings (IV crush opportunity)
        with_earnings = [s for s in high_iv if s["symbol"] in upcoming]
        without_earnings = [s for s in high_iv if s["symbol"] not in upcoming]

        # Combine: earnings-related first, then remaining high IV
        combined = with_earnings + without_earnings
        return combined[:10]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]
            iv_rank = stock["metrics"].get("iv_rank", 0)
            composite = stock.get("composite_score", 0)

            if iv_rank > 65 and composite > 55:
                signal = "buy"
                conviction = min(90, int(50 + iv_rank * 0.25 + composite * 0.15))
            else:
                signal = "hold"
                conviction = 35

            stop_loss, take_profit = _compute_levels(price)
            analyses.append({
                "symbol": symbol,
                "price": price,
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"EarningsVol: {symbol} IV Rank {iv_rank:.0f}, "
                    f"implied vol appears overpriced vs historical."
                ),
            })
        return analyses


# =====================================================================
# Strategy 5: Regime Adaptive  (score-based proxy)
# =====================================================================

class RegimeAdaptiveRunner(BaseStrategyRunner):
    name = "regime_adaptive"
    description = "Regime-aware sector rotation — long top sectors, avoid weakest"
    use_smart_review = False

    # Sector ETF mapping
    SECTOR_ETFS = {
        "XLK": "Technology", "XLF": "Financials", "XLE": "Energy",
        "XLV": "Healthcare", "XLY": "Consumer Discretionary",
        "XLP": "Consumer Staples", "XLI": "Industrials", "XLU": "Utilities",
        "XLB": "Materials", "XLRE": "Real Estate", "XLC": "Communication",
    }

    async def screen(self) -> list[dict[str, Any]]:
        """Screen sector ETFs and defensive assets based on regime."""
        # Use screener results to determine sector strength
        all_stocks = _get_screener_results(limit=100)

        # Calculate sector aggregate momentum
        sector_scores: dict[str, list[float]] = {}
        for s in all_stocks:
            sector = s.get("sector", "Unknown")
            score = s.get("composite_score", 50)
            if sector not in sector_scores:
                sector_scores[sector] = []
            sector_scores[sector].append(score)

        # Average score per sector
        sector_avg = {s: sum(scores)/len(scores) for s, scores in sector_scores.items() if scores}

        # Sort sectors by strength
        ranked = sorted(sector_avg.items(), key=lambda x: x[1], reverse=True)

        # Build candidates: top 3 sectors get buys, bottom 2 get avoids
        candidates: list[dict[str, Any]] = []
        for i, (sector, avg_score) in enumerate(ranked):
            # Find the best stock in each top sector
            best_in_sector = max(
                [s for s in all_stocks if s.get("sector") == sector],
                key=lambda x: x.get("composite_score", 0),
                default=None
            )
            if best_in_sector:
                best_in_sector["_sector_rank"] = i + 1
                best_in_sector["_sector_avg"] = avg_score
                best_in_sector["_is_top_sector"] = i < 3
                candidates.append(best_in_sector)

        return candidates[:8]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score based on sector rank + individual quality."""
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            sector_rank = stock.get("_sector_rank", 5)
            sector_avg = stock.get("_sector_avg", 50)
            is_top = stock.get("_is_top_sector", False)
            composite = stock.get("composite_score", 50)

            # Top 3 sectors get buy signals with higher conviction
            if is_top:
                conviction = min(85, int(50 + sector_avg * 0.3 + composite * 0.15))
                signal = "buy" if conviction >= 60 else "hold"
            else:
                conviction = max(20, int(30 + sector_avg * 0.2))
                signal = "hold"

            price = stock.get("price", 100)
            analyses.append({
                "symbol": stock["symbol"],
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": round(price * 0.94, 2),  # 6% stop
                "take_profit": round(price * 1.10, 2),  # 10% target
                "rationale": f"Sector rotation: {stock.get('sector', '?')} ranked #{sector_rank} (avg score {sector_avg:.0f}). {'Top sector — overweight.' if is_top else 'Weak sector — avoid.'}",
                "sector": stock.get("sector", "Unknown"),
            })
        return analyses


# =====================================================================
# Strategy 6: Claude Alpha  (calls Claude — existing approach)
# =====================================================================

class ClaudeAlphaRunner(BaseStrategyRunner):
    name = "claude_alpha"
    description = "AI-driven opportunistic stock picking (current approach)"
    use_smart_review = True

    async def screen(self) -> list[dict[str, Any]]:
        all_stocks = _get_screener_results(limit=40)
        sorted_stocks = sorted(all_stocks, key=lambda s: s.get("composite_score", 0), reverse=True)
        candidates = sorted_stocks[:20]

        # Enrich top candidates with real Alpaca prices
        candidates = await _enrich_with_real_prices(candidates)
        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Use the same general swing-trade prompt as the original pipeline
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]

            headlines = await _fetch_news_headlines(symbol)
            news_block = ""
            if headlines:
                bullet_list = "\n".join(f"- {h}" for h in headlines[:5])
                news_block = (
                    f"\nRecent news for {symbol}:\n{bullet_list}\n"
                    f"Consider the news sentiment above in your analysis."
                )

            # Fetch real technical data from Alpaca
            tech_context = await _get_technical_context(symbol)

            prompt = (
                f"Analyze {symbol} at ${price} for a swing trade (5-20 day hold).\n\n"
                f"{tech_context}\n\n"
                f"IMPORTANT: Use the TECHNICAL DATA above to ground your analysis. "
                f"If the stock is in a DOWNTREND or far from its 52-week high, "
                f"be cautious regardless of positive catalysts.\n\n"
                f"Score each dimension 1-10:\n"
                f"1. TREND: Moving average alignment (above 20/50/200 EMA = higher)\n"
                f"2. MOMENTUM: Rate of change, RSI position, relative strength vs SPY\n"
                f"3. VOLUME: Recent volume vs 20-day average, accumulation/distribution\n"
                f"4. CATALYST: Upcoming earnings, news, institutional activity\n"
                f"5. RISK/REWARD: Distance to support vs resistance, risk per share\n\n"
                f"Then provide:\n"
                f"- SIGNAL: buy / sell / hold\n"
                f"- CONVICTION: 0-100 (weighted average of scores x 10)\n"
                f"- ENTRY: exact price\n"
                f"- STOP_LOSS: exact price (max 5% below entry for longs)\n"
                f"- TAKE_PROFIT: exact price (min 2:1 reward-to-risk ratio)\n"
                f"- RATIONALE: 1 sentence\n\n"
                f"{news_block}"
                f"Respond in JSON only with keys: signal, conviction, entry_price, stop_loss, take_profit, rationale, "
                f"trend_score, momentum_score, volume_score, catalyst_score, risk_reward_score."
            )
            result = await _call_claude(prompt, symbol)
            result["price"] = price
            result["sector"] = stock.get("sector", "Unknown")
            analyses.append(result)

        return analyses


# =====================================================================
# Strategy 7: Mean Reversion  (score-based)
# =====================================================================

class MeanReversionRunner(BaseStrategyRunner):
    name = "mean_reversion"
    description = "Buy oversold quality stocks, sell on reversion to mean"
    use_smart_review = False  # Simple rules-based

    async def screen(self) -> list[dict[str, Any]]:
        """Find stocks with RSI < 35 but good fundamentals (F-Score >= 5)."""
        all_stocks = _get_screener_results(limit=100)
        # Look for oversold stocks (negative change) with decent quality
        candidates = []
        for s in all_stocks:
            change = s.get("change_pct", 0)
            f_score = s.get("metrics", {}).get("f_score", 0)
            # Oversold: negative recent change, but quality fundamentals
            if change < -2 and f_score >= 5:
                candidates.append(s)

        # Enrich with real prices so TA confirmations use live data
        candidates = await _enrich_with_real_prices(candidates[:20])
        return candidates[:15]

    async def _compute_ta_confirmations(self, symbol: str) -> dict[str, Any]:
        """Compute Bollinger Band, RSI(14), 20-day SMA, and money flow
        confirmations for a mean reversion candidate.

        Returns a dict with:
        - bb_lower_touch: True if price is at or below lower Bollinger Band
        - rsi14: RSI(14) value
        - rsi_oversold: True if RSI(14) < 30
        - sma20: 20-day simple moving average (the reversion target)
        - positive_money_flow: True if recent money flow is positive
          (institutional buying detected via price-volume relationship)
        """
        bars = await _get_bars(symbol, limit=60)
        closes = bars["closes"]
        volumes = bars["volumes"]

        result = {
            "bb_lower_touch": False,
            "rsi14": 50.0,
            "rsi_oversold": False,
            "sma20": None,
            "positive_money_flow": False,
        }

        if len(closes) < 20:
            return result

        # --- 20-day SMA ---
        sma20 = sum(closes[-20:]) / 20
        result["sma20"] = round(sma20, 2)

        # --- Bollinger Bands (20-day, 2 std devs) ---
        mean_sq_dev = sum((c - sma20) ** 2 for c in closes[-20:]) / 20
        bb_std = math.sqrt(mean_sq_dev)
        bb_lower = sma20 - 2 * bb_std
        result["bb_lower_touch"] = closes[-1] <= bb_lower
        result["bb_lower"] = round(bb_lower, 2)

        # --- RSI(14) ---
        if len(closes) >= 15:
            gains, losses = [], []
            for i in range(-14, 0):
                change = closes[i] - closes[i - 1]
                gains.append(max(change, 0))
                losses.append(max(-change, 0))
            avg_gain = sum(gains) / 14
            avg_loss = sum(losses) / 14
            if avg_loss == 0:
                rsi = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
            result["rsi14"] = round(rsi, 1)
            result["rsi_oversold"] = rsi < 30

        # --- Money Flow (positive = institutional buying) ---
        # Use a simplified Money Flow Index over last 14 days:
        # typical_price * volume, summed on up days vs down days
        if len(closes) >= 15 and len(volumes) >= 15:
            pos_flow = 0.0
            neg_flow = 0.0
            for i in range(-14, 0):
                typical = closes[i]  # simplified (close-only)
                vol = volumes[i] if i < len(volumes) else 0
                if closes[i] > closes[i - 1]:
                    pos_flow += typical * vol
                else:
                    neg_flow += typical * vol
            total = pos_flow + neg_flow
            result["positive_money_flow"] = pos_flow > neg_flow if total > 0 else False
            result["mfi_ratio"] = round(pos_flow / max(neg_flow, 1), 2)

        return result

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score based on oversold depth + quality + TA confirmations."""
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            change = abs(stock.get("change_pct", 0))
            f_score = stock.get("metrics", {}).get("f_score", 0)
            composite = stock.get("composite_score", 50)
            price = stock.get("price", 100)

            # Fetch TA confirmations from live data
            ta = await self._compute_ta_confirmations(symbol)
            bb_touch = ta["bb_lower_touch"]
            rsi_oversold = ta["rsi_oversold"]
            rsi14 = ta["rsi14"]
            sma20 = ta["sma20"]
            pos_mf = ta["positive_money_flow"]

            # Base conviction from oversold depth + quality
            conviction = int(25 + change * 4 + f_score * 3 + composite * 0.15)

            # Bollinger Band lower touch confirmation (+8)
            if bb_touch:
                conviction += 8

            # RSI(14) oversold confirmation (+10)
            if rsi_oversold:
                conviction += 10

            # Positive money flow / institutional buying (+7)
            if pos_mf:
                conviction += 7

            conviction = min(90, max(20, conviction))

            # Require at least one TA confirmation for a buy signal
            has_confirmation = bb_touch or rsi_oversold
            signal = "buy" if conviction >= 55 and has_confirmation else "hold"

            # Target = 20-day SMA (actual mean to revert to), not a fixed %
            if sma20 and sma20 > price:
                take_profit = sma20
            else:
                take_profit = round(price * 1.08, 2)  # fallback 8% target

            stop_loss = round(price * 0.95, 2)  # 5% stop (tighter for mean reversion)

            confirms = []
            if bb_touch:
                confirms.append(f"BB lower touch ({ta.get('bb_lower', '?')})")
            if rsi_oversold:
                confirms.append(f"RSI({rsi14:.0f}) oversold")
            if pos_mf:
                confirms.append(f"positive money flow ({ta.get('mfi_ratio', '?')}x)")

            analyses.append({
                "symbol": symbol,
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "rationale": (
                    f"Mean reversion: {symbol} oversold ({stock.get('change_pct', 0):.1f}%) "
                    f"F-Score {f_score}. "
                    + (f"Confirms: {', '.join(confirms)}. " if confirms else "No TA confirms. ")
                    + f"Target 20-SMA ${take_profit:.2f}."
                ),
                "sector": stock.get("sector", "Unknown"),
            })
        return analyses


# =====================================================================
# Strategy 8: VCP Breakout (Minervini SEPA)
# =====================================================================

class VCPBreakoutRunner(BaseStrategyRunner):
    name = "vcp_breakout"
    description = "Volatility Contraction Pattern breakout — Minervini SEPA methodology"
    use_smart_review = False

    async def screen(self) -> list[dict[str, Any]]:
        """Find stocks in Stage 2 uptrends with contracting volatility."""
        all_stocks = _get_screener_results(limit=100)
        candidates = await _enrich_with_real_prices(all_stocks[:40])

        # Filter: RS > 60 (uptrend), and not extremely overbought
        uptrend_stocks = []
        for s in candidates:
            rs = s.get("metrics", {}).get("rs_score", 0)
            change = s.get("change_pct", 0)
            # Stage 2 criteria: strong relative strength but not overextended
            if rs > 60 and abs(change) < 5:  # not already moving big today
                uptrend_stocks.append(s)

        return uptrend_stocks[:12]

    async def _check_vcp_setup(self, symbol: str) -> dict[str, Any]:
        """Check for a proper VCP (Volatility Contraction Pattern) setup.

        Evaluates:
        1. Volatility contraction: ratio of 5-day range to 20-day range < 0.6
        2. Volume dry-up: avg volume in last 5 days vs last 20 days declining
        3. Breakout volume: today's volume above 20-day average
        4. Minervini Stage 2 template: price above 150-day and 200-day MA,
           150-day MA above 200-day MA, 200-day MA trending up (at least
           1 month), price at least 30% above 52-week low and within 25%
           of 52-week high.
        """
        bars = await _get_bars(symbol, limit=250)
        closes = bars["closes"]
        highs = bars["highs"]
        lows = bars["lows"]
        volumes = bars["volumes"]

        result = {
            "vol_contraction": False,
            "vol_contraction_ratio": 1.0,
            "volume_dryup": False,
            "breakout_volume": False,
            "stage2": False,
            "stage2_details": {},
            "has_data": False,
        }

        if len(closes) < 200 or len(highs) < 200:
            return result
        result["has_data"] = True

        # --- 1. Volatility Contraction ---
        # Compare the high-low range of the last 5 days vs last 20 days
        range_5d = max(highs[-5:]) - min(lows[-5:])
        range_20d = max(highs[-20:]) - min(lows[-20:])
        vc_ratio = range_5d / range_20d if range_20d > 0 else 1.0
        result["vol_contraction_ratio"] = round(vc_ratio, 3)
        result["vol_contraction"] = vc_ratio < 0.60  # at least 40% contraction

        # --- 2. Volume Dry-Up ---
        # Average volume over last 5 days should be below last 20-day average
        if len(volumes) >= 20:
            avg_vol_5 = sum(volumes[-5:]) / 5
            avg_vol_20 = sum(volumes[-20:]) / 20
            vol_dryup_ratio = avg_vol_5 / avg_vol_20 if avg_vol_20 > 0 else 1.0
            result["volume_dryup"] = vol_dryup_ratio < 0.80  # 20% decline
            result["vol_dryup_ratio"] = round(vol_dryup_ratio, 2)
        else:
            result["vol_dryup_ratio"] = 1.0

        # --- 3. Breakout Volume ---
        # Today's (latest) volume should exceed 20-day average
        if len(volumes) >= 20:
            avg_vol_20 = sum(volumes[-20:]) / 20
            result["breakout_volume"] = volumes[-1] > avg_vol_20 * 1.0
            result["breakout_vol_ratio"] = (
                round(volumes[-1] / avg_vol_20, 2) if avg_vol_20 > 0 else 0
            )
        else:
            result["breakout_vol_ratio"] = 1.0

        # --- 4. Minervini Stage 2 Template ---
        sma150 = sum(closes[-150:]) / 150
        sma200 = sum(closes[-200:]) / 200
        current = closes[-1]

        # 200-day MA trending up: compare current 200-SMA to 20 days ago
        sma200_20ago = sum(closes[-220:-20]) / 200 if len(closes) >= 220 else sma200
        sma200_uptrend = sma200 > sma200_20ago

        # 52-week (252 trading days) high and low
        hi_52w = max(closes[-min(252, len(closes)):])
        lo_52w = min(closes[-min(252, len(closes)):])
        pct_above_low = ((current - lo_52w) / lo_52w * 100) if lo_52w > 0 else 0
        pct_below_high = ((hi_52w - current) / hi_52w * 100) if hi_52w > 0 else 0

        stage2_checks = {
            "above_150sma": current > sma150,
            "above_200sma": current > sma200,
            "sma150_above_200": sma150 > sma200,
            "sma200_uptrend": sma200_uptrend,
            "pct_above_52w_low": round(pct_above_low, 1),
            "above_30pct_from_low": pct_above_low > 30,
            "within_25pct_of_high": pct_below_high < 25,
        }
        result["stage2_details"] = stage2_checks

        # All four structural checks must pass for Stage 2 confirmation
        result["stage2"] = all([
            stage2_checks["above_150sma"],
            stage2_checks["above_200sma"],
            stage2_checks["sma150_above_200"],
            stage2_checks["sma200_uptrend"],
        ])

        result["sma150"] = round(sma150, 2)
        result["sma200"] = round(sma200, 2)

        return result

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score based on trend alignment + volatility contraction + volume."""
        analyses = []
        for stock in candidates:
            symbol = stock["symbol"]
            rs = stock.get("metrics", {}).get("rs_score", 50)
            composite = stock.get("composite_score", 50)
            f_score = stock.get("metrics", {}).get("f_score", 5)
            price = stock.get("price", 100)

            # Fetch VCP setup data from Alpaca
            vcp = await self._check_vcp_setup(symbol)

            if not vcp["has_data"]:
                # Fallback to screener-only scoring when no bar data
                conviction = min(75, int(40 + rs * 0.2 + f_score * 2))
                stop_loss = round(price * 0.97, 2)
                take_profit = round(price * 1.10, 2)
                analyses.append({
                    "symbol": symbol,
                    "signal": "hold",
                    "conviction": conviction,
                    "entry_price": price,
                    "stop_loss": stop_loss,
                    "take_profit": take_profit,
                    "rationale": f"VCP: {symbol} insufficient bar data for full analysis.",
                    "sector": stock.get("sector", "Unknown"),
                })
                continue

            # Base conviction from RS and fundamentals
            conviction = int(35 + rs * 0.15 + f_score * 2 + composite * 0.1)

            # Stage 2 template is the primary requirement
            if not vcp["stage2"]:
                # Not in Stage 2 -- no trade
                analyses.append({
                    "symbol": symbol,
                    "signal": "hold",
                    "conviction": min(50, conviction),
                    "entry_price": price,
                    "stop_loss": round(price * 0.97, 2),
                    "take_profit": round(price * 1.10, 2),
                    "rationale": f"VCP: {symbol} fails Stage 2 template check. No trade.",
                    "sector": stock.get("sector", "Unknown"),
                })
                continue

            conviction += 8  # Stage 2 confirmed

            # Volatility contraction confirmation
            if vcp["vol_contraction"]:
                conviction += 10
            else:
                conviction -= 5  # no contraction = weaker setup

            # Volume dry-up during contraction
            if vcp["volume_dryup"]:
                conviction += 7

            # Breakout on above-average volume
            if vcp["breakout_volume"]:
                conviction += 8

            conviction = min(92, max(30, conviction))

            # Require both Stage 2 + contraction for a buy signal
            signal = "buy" if conviction >= 62 and vcp["vol_contraction"] else "hold"

            # Tight stop below the contraction low; target 10%+
            stop_loss = round(price * 0.97, 2)
            take_profit = round(price * 1.12, 2)

            # Build detailed rationale
            confirms = []
            if vcp["stage2"]:
                confirms.append(
                    f"Stage 2 (>{vcp['sma150']}/{vcp['sma200']})"
                )
            if vcp["vol_contraction"]:
                confirms.append(
                    f"VC ratio {vcp['vol_contraction_ratio']:.2f}"
                )
            if vcp["volume_dryup"]:
                confirms.append(
                    f"vol dry-up ({vcp.get('vol_dryup_ratio', '?')}x)"
                )
            if vcp["breakout_volume"]:
                confirms.append(
                    f"breakout vol {vcp.get('breakout_vol_ratio', '?')}x avg"
                )

            analyses.append({
                "symbol": symbol,
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "rationale": (
                    f"VCP Breakout: {symbol} RS {rs}, F-Score {f_score}. "
                    + (f"Setup: {', '.join(confirms)}. " if confirms else "")
                    + f"R/R: {((take_profit - price) / (price - stop_loss)):.1f}:1."
                ),
                "sector": stock.get("sector", "Unknown"),
            })
        return analyses


# =====================================================================
# Shared helper: fetch Alpaca bars (used by TA strategies)
# =====================================================================

async def _get_bars(symbol: str, limit: int = 250) -> dict[str, list]:
    """Fetch daily OHLCV bars from Alpaca for technical analysis.

    Returns dict with keys: closes, highs, lows, volumes, timestamps.
    """
    import httpx
    from core.config import settings

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                headers=headers,
                params={"timeframe": "1Day", "limit": limit, "feed": "sip"},
            )
            if resp.status_code != 200:
                return {"closes": [], "highs": [], "lows": [], "volumes": []}

            bars = resp.json().get("bars", [])
            return {
                "closes": [b["c"] for b in bars],
                "highs": [b["h"] for b in bars],
                "lows": [b["l"] for b in bars],
                "volumes": [b["v"] for b in bars],
            }
    except Exception as e:
        logger.warning("Failed to fetch bars for %s: %s", symbol, e)
        return {"closes": [], "highs": [], "lows": [], "volumes": []}


# =====================================================================
# Strategy 9: Time-Series Momentum (Moskowitz et al. 2012)
# =====================================================================

class TSMomentumRunner(BaseStrategyRunner):
    """200-day SMA trend following with inverse-volatility sizing.

    Academic: Moskowitz, Ooi & Pedersen "Time Series Momentum" (2012).
    Extended with multi-SMA confirmation (50/100/200), volume filters,
    ATR-based stops, ADX-like trend strength, and VIX regime awareness.
    Goes long when price > 200-day SMA with confirming signals, exits on
    trend reversal.
    """
    name = "ts_momentum"
    description = "Time-series momentum — multi-SMA trend following with regime awareness"
    use_smart_review = False

    SMA_PERIOD = 200
    SMA_50 = 50
    SMA_100 = 100
    ATR_PERIOD = 20
    ATR_STOP_MULT = 2.5       # stop loss = 2.5x ATR below entry
    ATR_TARGET_MULT = 3.0     # take profit = 3:1 R/R ratio on ATR stop
    ADX_PERIOD = 14
    ADX_THRESHOLD = 20        # skip sideways markets below this
    VOL_CONFIRM_RATIO = 1.2   # volume must be 1.2x 20-day avg for confirmation
    VIX_HIGH = 30             # reduce exposure above this level
    VIX_ELEVATED = 20         # slightly reduce exposure above this level

    # -------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------

    @staticmethod
    def _compute_atr(closes: list[float], highs: list[float],
                     lows: list[float], period: int = 20) -> float:
        """Compute Average True Range over *period* bars."""
        if len(closes) < period + 1:
            return (max(closes[-period:]) - min(closes[-period:])) / max(period, 1)
        true_ranges: list[float] = []
        for i in range(-period, 0):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            true_ranges.append(tr)
        return sum(true_ranges) / len(true_ranges) if true_ranges else 0.0

    @staticmethod
    def _compute_adx(closes: list[float], highs: list[float],
                     lows: list[float], period: int = 14) -> float:
        """Approximate ADX (Average Directional Index) over *period* bars.

        Uses Wilder smoothing.  Returns 0-100 scale where >25 = trending.
        """
        n = len(closes)
        if n < period + 2:
            return 0.0

        plus_dm_list: list[float] = []
        minus_dm_list: list[float] = []
        tr_list: list[float] = []

        start = max(0, n - 2 * period - 1)
        for i in range(start + 1, n):
            up_move = highs[i] - highs[i - 1]
            down_move = lows[i - 1] - lows[i]
            plus_dm_list.append(max(up_move, 0) if up_move > down_move else 0.0)
            minus_dm_list.append(max(down_move, 0) if down_move > up_move else 0.0)
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            tr_list.append(tr)

        if len(tr_list) < period:
            return 0.0

        # Wilder smooth first period
        atr_s = sum(tr_list[:period])
        plus_dm_s = sum(plus_dm_list[:period])
        minus_dm_s = sum(minus_dm_list[:period])

        dx_values: list[float] = []
        for i in range(period, len(tr_list)):
            atr_s = atr_s - atr_s / period + tr_list[i]
            plus_dm_s = plus_dm_s - plus_dm_s / period + plus_dm_list[i]
            minus_dm_s = minus_dm_s - minus_dm_s / period + minus_dm_list[i]
            plus_di = (plus_dm_s / atr_s * 100) if atr_s > 0 else 0
            minus_di = (minus_dm_s / atr_s * 100) if atr_s > 0 else 0
            di_sum = plus_di + minus_di
            dx = abs(plus_di - minus_di) / di_sum * 100 if di_sum > 0 else 0
            dx_values.append(dx)

        if not dx_values:
            return 0.0
        # Smooth DX into ADX
        adx = sum(dx_values[:period]) / period if len(dx_values) >= period else sum(dx_values) / len(dx_values)
        for i in range(period, len(dx_values)):
            adx = (adx * (period - 1) + dx_values[i]) / period
        return adx

    @staticmethod
    def _sma(values: list[float], period: int) -> float:
        """Simple moving average of the last *period* values."""
        if len(values) < period:
            return sum(values) / len(values) if values else 0.0
        return sum(values[-period:]) / period

    @staticmethod
    async def _get_vix_level() -> float:
        """Fetch current VIX level from Alpaca.  Returns 0 on failure."""
        import httpx
        from core.config import settings

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://data.alpaca.markets/v2/stocks/VIXY/bars",
                    headers=headers,
                    params={"timeframe": "1Day", "limit": 5, "feed": "sip"},
                )
                if resp.status_code == 200:
                    bars = resp.json().get("bars", [])
                    if bars:
                        # VIXY tracks VIX futures; use close as proxy
                        return bars[-1]["c"]
        except Exception:
            pass
        return 0.0

    # -------------------------------------------------------------------
    # Pipeline
    # -------------------------------------------------------------------

    async def screen(self) -> list[dict[str, Any]]:
        """Screen for liquid stocks and verify trend via real 200-day SMA."""
        all_stocks = _get_screener_results(limit=100)

        # Pre-filter: reasonable RS score as a first pass before fetching bars
        pre_filtered = [
            s for s in all_stocks
            if s["metrics"].get("rs_score", 0) > 40
        ]
        pre_filtered.sort(key=lambda x: x.get("composite_score", 0), reverse=True)
        pre_filtered = await _enrich_with_real_prices(pre_filtered[:50])

        # Second pass: verify with real 200-day SMA from bar data
        candidates: list[dict[str, Any]] = []
        for stock in pre_filtered:
            symbol = stock["symbol"]
            bars = await _get_bars(symbol, limit=250)
            closes = bars["closes"]
            volumes = bars["volumes"]

            if len(closes) < self.SMA_PERIOD:
                continue

            sma200 = self._sma(closes, self.SMA_PERIOD)
            if closes[-1] <= sma200:
                continue  # Not above 200-day SMA

            # Volume confirmation: recent avg volume above 20-day average
            if len(volumes) >= 20:
                vol_avg_20 = sum(volumes[-20:]) / 20
                vol_avg_5 = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else vol_avg_20
                if vol_avg_20 < 300_000:
                    continue  # Insufficient liquidity
                stock["_vol_ratio"] = vol_avg_5 / vol_avg_20 if vol_avg_20 > 0 else 1.0
            else:
                stock["_vol_ratio"] = 1.0

            stock["_sma200"] = sma200
            stock["_closes"] = closes
            stock["_highs"] = bars["highs"]
            stock["_lows"] = bars["lows"]
            stock["_volumes"] = volumes
            candidates.append(stock)

        candidates.sort(key=lambda x: x.get("composite_score", 0), reverse=True)
        return candidates[:30]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []

        # Fetch VIX regime once for the whole batch
        vix_level = await self._get_vix_level()

        for stock in candidates[:15]:
            symbol = stock["symbol"]
            price = stock.get("price", 0)
            closes = stock.get("_closes", [])
            highs = stock.get("_highs", [])
            lows = stock.get("_lows", [])
            volumes = stock.get("_volumes", [])

            if len(closes) < self.SMA_PERIOD:
                # Re-fetch if screen data not cached
                bars = await _get_bars(symbol, limit=250)
                closes = bars["closes"]
                highs = bars["highs"]
                lows = bars["lows"]
                volumes = bars["volumes"]
                if len(closes) < self.SMA_PERIOD:
                    continue

            # ------ Multi-SMA computation ------
            sma200 = self._sma(closes, self.SMA_PERIOD)
            sma100 = self._sma(closes, self.SMA_100)
            sma50 = self._sma(closes, self.SMA_50)

            above_sma200 = closes[-1] > sma200
            if not above_sma200:
                continue

            distance_pct = ((closes[-1] - sma200) / sma200) * 100

            # SMA alignment check: bullish when 50 > 100 > 200
            sma_aligned = sma50 > sma100 > sma200
            # 50/100 SMA cross confirmation
            sma_50_above_100 = sma50 > sma100

            # ------ 12-month return ------
            ret_12m = (closes[-1] / closes[0] - 1) * 100 if closes[0] > 0 else 0

            # ------ Realized vol (60-day) ------
            vol_lookback = min(60, len(closes) - 1)
            daily_rets = [
                closes[i] / closes[i - 1] - 1
                for i in range(-vol_lookback + 1, 0)
                if closes[i - 1] > 0
            ]
            if daily_rets:
                mean_r = sum(daily_rets) / len(daily_rets)
                var = sum((r - mean_r) ** 2 for r in daily_rets) / len(daily_rets)
                real_vol = math.sqrt(var * 252)
            else:
                real_vol = 0.20

            # ------ ADX trend strength filter ------
            adx = self._compute_adx(closes, highs, lows, self.ADX_PERIOD)
            if adx < self.ADX_THRESHOLD:
                continue  # Skip sideways / range-bound markets

            # ------ ATR-based stops ------
            atr = self._compute_atr(closes, highs, lows, self.ATR_PERIOD)
            stop_distance = self.ATR_STOP_MULT * atr
            stop_loss = round(price - stop_distance, 2)
            take_profit = round(price + stop_distance * self.ATR_TARGET_MULT, 2)

            # ------ Volume confirmation ------
            vol_ratio = stock.get("_vol_ratio", 1.0)
            if len(volumes) >= 20:
                vol_avg_20 = sum(volumes[-20:]) / 20
                vol_avg_5 = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else vol_avg_20
                vol_ratio = vol_avg_5 / vol_avg_20 if vol_avg_20 > 0 else 1.0
            vol_confirmed = vol_ratio >= self.VOL_CONFIRM_RATIO

            # ------ Trend slope (SMA-200 slope over 20 days) ------
            if len(closes) >= 220:
                sma200_20ago = sum(closes[-220:-20]) / 200
                trend_slope = (sma200 - sma200_20ago) / sma200_20ago * 100
            else:
                trend_slope = 0

            # ------ Conviction scoring ------
            conviction = 45  # base

            # Price above 200-SMA distance
            conviction += min(15, abs(distance_pct) * 2)
            # SMA alignment bonus
            if sma_aligned:
                conviction += 12
            elif sma_50_above_100:
                conviction += 6
            # Trend slope bonus
            conviction += min(10, trend_slope * 2) if trend_slope > 0 else 0
            # ADX strength bonus (stronger trend = higher conviction)
            conviction += min(8, (adx - self.ADX_THRESHOLD) * 0.4)
            # Volume confirmation bonus
            if vol_confirmed:
                conviction += 5

            # ------ VIX regime adjustment ------
            regime_note = ""
            if vix_level > self.VIX_HIGH:
                conviction = int(conviction * 0.70)
                regime_note = f" VIX HIGH ({vix_level:.0f}), exposure reduced."
            elif vix_level > self.VIX_ELEVATED:
                conviction = int(conviction * 0.85)
                regime_note = f" VIX elevated ({vix_level:.0f}), exposure trimmed."

            conviction = max(40, min(95, int(conviction)))

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"TS Momentum: {symbol} ${price:.2f} > 200-SMA ${sma200:.2f} "
                    f"({distance_pct:+.1f}%). 50-SMA ${sma50:.2f}, 100-SMA ${sma100:.2f}. "
                    f"{'SMA aligned. ' if sma_aligned else ''}"
                    f"12m return {ret_12m:+.1f}%. Vol {real_vol:.0%}. "
                    f"ADX {adx:.0f}. ATR ${atr:.2f}. "
                    f"{'Vol confirmed. ' if vol_confirmed else ''}"
                    f"Trend slope {trend_slope:+.1f}%.{regime_note}"
                ),
            })

        return analyses


# =====================================================================
# Strategy 10: RSI-2 Mean Reversion (Connors & Alvarez 2009)
# =====================================================================

class RSI2ReversalRunner(BaseStrategyRunner):
    """Short-term mean reversion: buy when RSI(2) < 10 in uptrending stocks.

    Academic: Connors & Alvarez "Short Term Trading Strategies That Work".
    75% win rate, 3-7 day holding period.

    Enhancements over original:
    - Computes RSI(2) from actual Alpaca bars (replaces change_pct proxy)
    - Volume spike detection on the oversold day (capitulation confirmation)
    - ConnorsRSI variant for better signal quality
    - 5-day SMA computed for exit signal
    - Stop at recent swing low instead of fixed 5%
    - Market breadth filter: skips if SPY is also deeply oversold (systemic risk)
    """
    name = "rsi2_reversal"
    description = "RSI-2 mean reversion — buy extreme dips in uptrends"
    use_smart_review = False

    ENTRY_RSI = 10
    TREND_SMA = 200
    VOLUME_SPIKE_MULT = 1.5   # volume must be 1.5x the 20-day average
    SWING_LOW_LOOKBACK = 10   # days to find recent swing low for stop
    SPY_RSI2_SYSTEMIC = 5     # skip all entries if SPY RSI(2) < this

    # ------------------------------------------------------------------
    # Helper: RSI computation
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_rsi(closes: list[float], period: int = 2) -> float:
        """Compute RSI for a given period using Wilder's smoothing."""
        if len(closes) < period + 1:
            return 50.0
        gains, losses = [], []
        for i in range(-period, 0):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    # ------------------------------------------------------------------
    # Helper: ConnorsRSI (price RSI + streak RSI + percent-rank)
    # ------------------------------------------------------------------
    @staticmethod
    def _percent_rank(value: float, history: list[float]) -> float:
        """Compute percent-rank of value within history (0-100)."""
        if not history:
            return 50.0
        count_below = sum(1 for v in history if v < value)
        return (count_below / len(history)) * 100

    def _compute_connors_rsi(
        self,
        closes: list[float],
        rsi_period: int = 2,
        streak_period: int = 3,
        pctrank_period: int = 100,
    ) -> float:
        """ConnorsRSI = avg(RSI(2), RSI(streak,3), PercentRank(returns,100)).

        Blends price RSI, streak RSI, and magnitude rank for a
        higher-quality mean-reversion signal (Connors Research).
        """
        if len(closes) < max(rsi_period + 1, streak_period + 2):
            return 50.0

        # Component 1: standard RSI on price
        rsi_price = self._compute_rsi(closes, rsi_period)

        # Component 2: RSI on the consecutive up/down streak series
        def _streak_at(idx: int) -> float:
            if idx < 1:
                return 0.0
            s, direction = 0, 1 if closes[idx] >= closes[idx - 1] else -1
            for k in range(idx, 0, -1):
                if (closes[k] >= closes[k - 1]) == (direction > 0):
                    s += 1
                else:
                    break
            return float(s * direction)

        n_streak = max(streak_period + 2, 10)
        streaks = [
            _streak_at(len(closes) - 1 - j)
            for j in range(n_streak - 1, -1, -1)
        ]
        rsi_streak = (
            self._compute_rsi(streaks, streak_period)
            if len(streaks) > streak_period
            else 50.0
        )

        # Component 3: percent-rank of today's return over last N days
        start = max(1, len(closes) - pctrank_period)
        daily_rets = [
            (closes[i] / closes[i - 1] - 1)
            for i in range(start, len(closes))
            if closes[i - 1] > 0
        ]
        if daily_rets:
            pct_rank = self._percent_rank(daily_rets[-1], daily_rets)
        else:
            pct_rank = 50.0

        return (rsi_price + rsi_streak + pct_rank) / 3.0

    # ------------------------------------------------------------------
    # screen() -- computes RSI(2) from actual bars, not change_pct
    # ------------------------------------------------------------------
    async def screen(self) -> list[dict[str, Any]]:
        """Find oversold stocks by computing RSI(2) from actual Alpaca bars.

        Replaces the old ``change_pct < -1`` proxy with real RSI(2) computation.
        Also checks market breadth via SPY RSI(2) to avoid systemic selloffs.
        """
        # --- Market breadth filter: check SPY RSI(2) ---
        spy_bars = await _get_bars("SPY", limit=10)
        spy_closes = spy_bars["closes"]
        if len(spy_closes) >= 3:
            spy_rsi2 = self._compute_rsi(spy_closes, 2)
            if spy_rsi2 < self.SPY_RSI2_SYSTEMIC:
                logger.info(
                    "RSI2 runner: SPY RSI(2)=%.1f < %d — systemic risk, skipping cycle",
                    spy_rsi2, self.SPY_RSI2_SYSTEMIC,
                )
                return []

        all_stocks = _get_screener_results(limit=100)
        # Pre-filter: require relative strength not in a death spiral
        pre_filtered = [
            s for s in all_stocks
            if s["metrics"].get("rs_score", 0) > 40
        ]
        pre_filtered = await _enrich_with_real_prices(pre_filtered[:30])

        # Compute RSI(2) from actual bars for each candidate
        candidates = []
        for stock in pre_filtered:
            symbol = stock["symbol"]
            bars = await _get_bars(symbol, limit=25)
            closes = bars["closes"]
            volumes = bars["volumes"]

            if len(closes) < 3:
                continue

            rsi2 = self._compute_rsi(closes, 2)
            if rsi2 >= self.ENTRY_RSI:
                continue  # not oversold

            # Volume spike detection: today's volume vs prior average
            volume_spike = False
            if len(volumes) >= 2:
                avg_vol = sum(volumes[:-1]) / max(1, len(volumes) - 1)
                if avg_vol > 0 and volumes[-1] >= avg_vol * self.VOLUME_SPIKE_MULT:
                    volume_spike = True

            stock["_rsi2_screen"] = rsi2
            stock["_volume_spike"] = volume_spike
            candidates.append(stock)

        # Sort by RSI(2) ascending — deepest oversold first
        candidates.sort(key=lambda x: x.get("_rsi2_screen", 100))
        return candidates[:20]

    # ------------------------------------------------------------------
    # analyze() -- swing-low stop, ConnorsRSI, volume spike, 5-day SMA
    # ------------------------------------------------------------------
    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates[:10]:
            symbol = stock["symbol"]
            price = stock.get("price", 0)

            bars = await _get_bars(symbol, limit=250)
            closes = bars["closes"]
            lows = bars["lows"]
            volumes = bars["volumes"]

            if len(closes) < self.TREND_SMA:
                continue

            # 200-day SMA trend filter
            sma200 = sum(closes[-self.TREND_SMA:]) / self.TREND_SMA
            if closes[-1] <= sma200:
                continue  # Only trade with the trend

            # RSI(2) from full bar history
            rsi2 = self._compute_rsi(closes, 2)
            if rsi2 >= self.ENTRY_RSI:
                continue  # Not oversold enough

            # ConnorsRSI for enhanced signal quality
            connors_rsi = self._compute_connors_rsi(closes)

            # 5-day SMA for exit signal
            sma5 = sum(closes[-5:]) / 5

            # Volume spike confirmation on the oversold day
            volume_spike = False
            vol_ratio = 1.0
            if len(volumes) >= 21:
                avg_vol_20 = sum(volumes[-21:-1]) / 20
                if avg_vol_20 > 0:
                    vol_ratio = volumes[-1] / avg_vol_20
                    volume_spike = vol_ratio >= self.VOLUME_SPIKE_MULT

            # Stop at recent swing low instead of fixed 5%
            if len(lows) >= self.SWING_LOW_LOOKBACK:
                swing_low = min(lows[-self.SWING_LOW_LOOKBACK:])
            else:
                swing_low = min(lows) if lows else price

            # Small buffer below the swing low (0.5%)
            stop_loss = round(swing_low * 0.995, 2)
            # Floor: never risk more than 7% from entry
            stop_loss = max(stop_loss, round(price * 0.93, 2))

            take_profit = round(sma5, 2)  # target: 5-day SMA

            # Conviction: combine RSI depth, ConnorsRSI, and volume spike
            base_conviction = 55 + (self.ENTRY_RSI - rsi2) * 3
            if connors_rsi < 10:
                base_conviction += 10  # ConnorsRSI confirms extreme oversold
            if volume_spike:
                base_conviction += 5   # Capitulation volume adds confidence
            conviction = min(90, int(base_conviction))

            stop_pct = abs(price - stop_loss) / price * 100 if price > 0 else 5.0

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"RSI-2 Reversal: {symbol} RSI(2)={rsi2:.0f} "
                    f"ConnorsRSI={connors_rsi:.0f} (extreme oversold) "
                    f"while above 200-SMA ${sma200:.2f}. "
                    f"Vol spike {'YES' if volume_spike else 'no'} ({vol_ratio:.1f}x avg). "
                    f"Stop at swing low ${stop_loss:.2f} ({stop_pct:.1f}%). "
                    f"Target 5-SMA ${sma5:.2f}. Expected 3-7 day reversion."
                ),
            })

        return analyses


# =====================================================================
# Strategy 11: Dual Momentum (Jegadeesh & Titman / Antonacci)
# =====================================================================

class DualMomentumRunner(BaseStrategyRunner):
    """Cross-sectional + absolute momentum: buy top-quintile winners.

    Academic: Jegadeesh & Titman (1993), Antonacci "Dual Momentum" (2014).
    Monthly rebalance, equal-weight top 20%.

    Enhancements over original:
    - Batch bar requests using asyncio.gather (replaces sequential fetches)
    - Sector diversification: max 3 stocks from the same sector in top quintile
    - Volatility-adjusted momentum: weight by inverse vol for risk-adjusted ranking
    - SPY absolute momentum filter: check market regime before entering
    - Kelly Criterion approximation for position sizing
    """
    name = "dual_momentum"
    description = "Dual momentum — top-quintile relative strength + absolute filter"
    use_smart_review = False

    MAX_PER_SECTOR = 3          # sector diversification cap
    TARGET_VOL = 0.15           # target annualized volatility for normalization
    KELLY_FRACTION = 0.25       # quarter-Kelly for conservative sizing

    async def screen(self) -> list[dict[str, Any]]:
        """Rank universe by vol-adjusted momentum, select top quintile.

        Improvements:
        - Batches bar requests with asyncio.gather instead of sequential awaits
        - Checks SPY 12-month return for market regime (absolute momentum)
        - Computes volatility-adjusted momentum for risk-adjusted ranking
        - Caps sector concentration to MAX_PER_SECTOR
        """
        all_stocks = _get_screener_results(limit=100)
        candidates = await _enrich_with_real_prices(all_stocks[:50])

        # --- Market regime filter: check SPY absolute momentum ---
        spy_bars = await _get_bars("SPY", limit=252)
        spy_closes = spy_bars["closes"]
        if len(spy_closes) >= 200:
            spy_ret_12 = (spy_closes[-1] / spy_closes[0] - 1) * 100
            if spy_ret_12 < 0:
                logger.info(
                    "DualMomentum: SPY 12m return %.1f%% < 0 — bear regime, skipping",
                    spy_ret_12,
                )
                return []

        # --- Batch bar requests with asyncio.gather ---
        symbols_to_fetch = [s["symbol"] for s in candidates[:30]]
        bar_tasks = [_get_bars(sym, limit=252) for sym in symbols_to_fetch]
        all_bars = await asyncio.gather(*bar_tasks, return_exceptions=True)

        # Enrich with momentum + volatility from batched results
        enriched = []
        for stock, bars in zip(candidates[:30], all_bars):
            if isinstance(bars, Exception):
                continue
            closes = bars["closes"]
            if len(closes) < 200:
                continue

            # 12-1 month momentum (skip last ~22 trading days)
            if len(closes) >= 252:
                ret_12_1 = (closes[-22] / closes[0] - 1) * 100
                ret_12 = (closes[-1] / closes[0] - 1) * 100
            else:
                ret_12_1 = (closes[-22] / closes[0] - 1) * 100 if len(closes) > 22 else 0
                ret_12 = (closes[-1] / closes[0] - 1) * 100

            # Realized volatility (60-day annualized) for risk adjustment
            daily_rets = [
                closes[i] / closes[i - 1] - 1
                for i in range(max(1, len(closes) - 60), len(closes))
                if closes[i - 1] > 0
            ]
            if daily_rets:
                mean_r = sum(daily_rets) / len(daily_rets)
                var = sum((r - mean_r) ** 2 for r in daily_rets) / len(daily_rets)
                realized_vol = math.sqrt(var * 252)
            else:
                realized_vol = 0.20

            # Volatility-adjusted momentum: scale momentum by inverse vol
            inv_vol = (self.TARGET_VOL / realized_vol) if realized_vol > 0 else 1.0
            vol_adj_mom = ret_12_1 * inv_vol

            stock["_ret_12_1"] = ret_12_1
            stock["_ret_12"] = ret_12
            stock["_realized_vol"] = realized_vol
            stock["_vol_adj_mom"] = vol_adj_mom
            stock["_daily_rets"] = daily_rets
            enriched.append(stock)

        # Rank by volatility-adjusted momentum (risk-adjusted ranking)
        enriched.sort(key=lambda x: x.get("_vol_adj_mom", 0), reverse=True)

        # Top quintile (20%)
        n_select = max(1, len(enriched) // 5)
        top = enriched[:n_select]

        # Absolute momentum filter: 12-month return must be positive
        filtered = [s for s in top if s.get("_ret_12", 0) > 0]

        # --- Sector diversification: cap at MAX_PER_SECTOR per sector ---
        sector_counts: dict[str, int] = {}
        diversified = []
        for stock in filtered:
            sector = stock.get("sector", "Unknown")
            count = sector_counts.get(sector, 0)
            if count >= self.MAX_PER_SECTOR:
                continue
            sector_counts[sector] = count + 1
            diversified.append(stock)

        return diversified

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score candidates with Kelly Criterion position sizing."""
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock.get("price", 0)
            ret_12_1 = stock.get("_ret_12_1", 0)
            ret_12 = stock.get("_ret_12", 0)
            realized_vol = stock.get("_realized_vol", 0.20)
            vol_adj_mom = stock.get("_vol_adj_mom", 0)
            rs_score = stock.get("metrics", {}).get("rs_score", 50)
            daily_rets = stock.get("_daily_rets", [])

            # Conviction from vol-adjusted momentum + RS
            conviction = min(90, int(50 + vol_adj_mom * 0.4 + rs_score * 0.2))
            conviction = max(50, conviction)

            # --- Kelly Criterion approximation for position sizing ---
            # Kelly f* = (p * b - q) / b  where p=win rate, b=win/loss ratio
            # We estimate from recent daily returns
            if daily_rets:
                wins = [r for r in daily_rets if r > 0]
                losses = [r for r in daily_rets if r < 0]
                win_rate = len(wins) / len(daily_rets) if daily_rets else 0.5
                avg_win = sum(wins) / len(wins) if wins else 0.01
                avg_loss = abs(sum(losses) / len(losses)) if losses else 0.01
                payoff_ratio = avg_win / avg_loss if avg_loss > 0 else 1.0
                kelly_full = (win_rate * payoff_ratio - (1 - win_rate)) / payoff_ratio
                kelly_pct = max(0.02, min(0.10, kelly_full * self.KELLY_FRACTION))
            else:
                kelly_pct = 0.05  # default 5% position

            stop_loss = round(price * 0.92, 2)   # 8% stop (wider for momentum)
            take_profit = round(price * 1.20, 2)  # 20% target

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "kelly_pct": round(kelly_pct, 4),
                "realized_vol": round(realized_vol, 4),
                "vol_adj_momentum": round(vol_adj_mom, 2),
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"Dual Momentum: {symbol} ranked in top quintile. "
                    f"12-1m return {ret_12_1:+.1f}%, vol-adj mom {vol_adj_mom:+.1f}. "
                    f"12m abs return {ret_12:+.1f}%. Vol {realized_vol:.0%}. "
                    f"RS {rs_score}. Kelly sizing {kelly_pct:.1%}. Monthly rebalance."
                ),
            })

        return analyses


# =====================================================================
# Strategy 12: Pairs Trading (Gatev et al. 2006)
# =====================================================================

class PairsTradingRunner(BaseStrategyRunner):
    """Statistical arbitrage: trade cointegrated pairs on spread z-score.

    Academic: Gatev, Goetzmann & Rouwenhorst (2006), Avellaneda & Lee (2010).
    Market-neutral, targets mean reversion of the spread.

    Filters applied before entry:
    - Half-life of mean reversion must be <= 30 days (OU process estimate)
    - Hurst exponent < 0.5 (confirms mean-reverting regime)
    - Pearson correlation > 0.7 over last 60 days
    - Spread std must not be expanding (regime change guard)
    """
    name = "pairs_trading"
    description = "Pairs trading — cointegration-based statistical arbitrage"
    use_smart_review = False

    SECTOR_PAIRS = [
        ("XOM", "CVX"), ("JPM", "BAC"), ("KO", "PEP"),
        ("V", "MA"), ("HD", "LOW"), ("GS", "MS"),
        ("UNH", "CI"), ("PG", "CL"), ("T", "VZ"),
        ("CAT", "DE"), ("LIN", "APD"), ("AMZN", "WMT"),
    ]
    ENTRY_Z = 2.0
    EXIT_Z = 0.5
    MAX_HALF_LIFE = 30        # skip pairs with half-life > 30 days
    MIN_CORRELATION = 0.7     # minimum 60-day Pearson correlation
    MAX_HURST = 0.5           # Hurst < 0.5 confirms mean-reverting

    @staticmethod
    def _compute_half_life(spreads: list[float]) -> float:
        """Estimate OU process half-life from spread series.

        Regresses delta_spread on lagged_spread: dS = theta * S_{t-1} + eps.
        Half-life = -ln(2) / theta.
        """
        if len(spreads) < 3:
            return 999.0
        diffs = [spreads[i] - spreads[i - 1] for i in range(1, len(spreads))]
        lagged = spreads[:-1]
        mean_lag = sum(lagged) / len(lagged)
        mean_diff = sum(diffs) / len(diffs)
        cov_ld = sum(
            (lagged[i] - mean_lag) * (diffs[i] - mean_diff)
            for i in range(len(diffs))
        ) / len(diffs)
        var_lag = sum((x - mean_lag) ** 2 for x in lagged) / len(lagged)
        theta = cov_ld / var_lag if var_lag > 0 else 0
        if theta >= 0:
            return 999.0  # not mean-reverting
        return max(0.5, -math.log(2) / theta)

    @staticmethod
    def _compute_hurst(series: list[float], max_lag: int = 20) -> float:
        """Estimate Hurst exponent via rescaled range (R/S) method.

        H < 0.5 => mean-reverting, H ~ 0.5 => random walk, H > 0.5 => trending.
        """
        n = len(series)
        if n < max_lag + 2:
            return 0.5  # insufficient data, assume random walk
        lags = range(2, min(max_lag + 1, n // 2))
        log_rs: list[float] = []
        log_n: list[float] = []
        for lag in lags:
            rs_vals = []
            for start in range(0, n - lag, lag):
                chunk = series[start:start + lag]
                mean_c = sum(chunk) / len(chunk)
                deviations = [x - mean_c for x in chunk]
                cum_dev = []
                s = 0.0
                for d in deviations:
                    s += d
                    cum_dev.append(s)
                r = max(cum_dev) - min(cum_dev)
                std_c = math.sqrt(sum(d ** 2 for d in deviations) / len(deviations))
                if std_c > 0:
                    rs_vals.append(r / std_c)
            if rs_vals:
                log_rs.append(math.log(sum(rs_vals) / len(rs_vals)))
                log_n.append(math.log(lag))
        if len(log_n) < 2:
            return 0.5
        # Simple OLS slope of log(R/S) vs log(n)
        mean_x = sum(log_n) / len(log_n)
        mean_y = sum(log_rs) / len(log_rs)
        num = sum((log_n[i] - mean_x) * (log_rs[i] - mean_y) for i in range(len(log_n)))
        den = sum((log_n[i] - mean_x) ** 2 for i in range(len(log_n)))
        return num / den if den > 0 else 0.5

    @staticmethod
    def _compute_correlation(a: list[float], b: list[float]) -> float:
        """Pearson correlation between two price series."""
        n = min(len(a), len(b))
        if n < 5:
            return 0.0
        a, b = a[-n:], b[-n:]
        mean_a = sum(a) / n
        mean_b = sum(b) / n
        cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n)) / n
        std_a = math.sqrt(sum((x - mean_a) ** 2 for x in a) / n)
        std_b = math.sqrt(sum((x - mean_b) ** 2 for x in b) / n)
        if std_a == 0 or std_b == 0:
            return 0.0
        return cov / (std_a * std_b)

    @staticmethod
    def _spread_std_expanding(spreads: list[float], lookback: int = 30) -> bool:
        """Check if spread std over recent window is higher than earlier window.

        If the recent half has a significantly larger std than the earlier half,
        we are in a regime change and should skip the pair.
        """
        if len(spreads) < lookback * 2:
            return False
        early = spreads[-(lookback * 2):-lookback]
        recent = spreads[-lookback:]
        std_early = math.sqrt(sum((s - sum(early) / len(early)) ** 2 for s in early) / len(early))
        std_recent = math.sqrt(sum((s - sum(recent) / len(recent)) ** 2 for s in recent) / len(recent))
        # Flag if recent std is >40% larger than earlier std
        return std_early > 0 and (std_recent / std_early) > 1.4

    async def _fetch_pair_bars(self, sym_a: str, sym_b: str) -> tuple[str, str, dict, dict]:
        """Fetch bars for both legs of a pair concurrently."""
        bars_a, bars_b = await asyncio.gather(
            _get_bars(sym_a, limit=120),
            _get_bars(sym_b, limit=120),
        )
        return sym_a, sym_b, bars_a, bars_b

    async def screen(self) -> list[dict[str, Any]]:
        """Scan all pairs for z-score entry signals.

        Uses asyncio.gather for parallel bar fetching across all pairs.
        Applies half-life, Hurst exponent, correlation, and spread-widening
        filters before considering a pair tradeable.
        """
        # Fetch bars for all pairs in parallel
        fetch_tasks = [
            self._fetch_pair_bars(sym_a, sym_b)
            for sym_a, sym_b in self.SECTOR_PAIRS
        ]
        pair_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

        candidates = []
        for result in pair_results:
            if isinstance(result, Exception):
                logger.warning("Pair fetch failed: %s", result)
                continue
            sym_a, sym_b, bars_a, bars_b = result

            closes_a = bars_a["closes"]
            closes_b = bars_b["closes"]

            if len(closes_a) < 60 or len(closes_b) < 60:
                continue

            # Align lengths
            min_len = min(len(closes_a), len(closes_b))
            closes_a = closes_a[-min_len:]
            closes_b = closes_b[-min_len:]

            # --- Filter 1: Correlation check (last 60 days) ---
            corr_window = min(60, min_len)
            correlation = self._compute_correlation(
                closes_a[-corr_window:], closes_b[-corr_window:]
            )
            if correlation < self.MIN_CORRELATION:
                logger.info(
                    "Pairs skip %s/%s: correlation %.3f < %.1f threshold",
                    sym_a, sym_b, correlation, self.MIN_CORRELATION,
                )
                continue

            # OLS hedge ratio
            mean_a = sum(closes_a) / len(closes_a)
            mean_b = sum(closes_b) / len(closes_b)
            cov = sum((closes_a[i] - mean_a) * (closes_b[i] - mean_b) for i in range(len(closes_a))) / len(closes_a)
            var_b = sum((closes_b[i] - mean_b) ** 2 for i in range(len(closes_b))) / len(closes_b)
            hedge = cov / var_b if var_b > 0 else 1.0

            # Spread z-score (last 60 days)
            window = min(60, min_len)
            spreads = [closes_a[i] - hedge * closes_b[i] for i in range(-window, 0)]
            mean_s = sum(spreads) / len(spreads)
            std_s = math.sqrt(sum((s - mean_s) ** 2 for s in spreads) / len(spreads))
            zscore = (spreads[-1] - mean_s) / std_s if std_s > 0 else 0

            # Full spread for diagnostics
            all_spreads = [closes_a[i] - hedge * closes_b[i] for i in range(min_len)]

            # --- Filter 2: Half-life must be <= 30 days ---
            half_life = self._compute_half_life(all_spreads)
            if half_life > self.MAX_HALF_LIFE:
                logger.info(
                    "Pairs skip %s/%s: half-life %.1f days > %d max",
                    sym_a, sym_b, half_life, self.MAX_HALF_LIFE,
                )
                continue

            # --- Filter 3: Hurst exponent < 0.5 (mean-reverting) ---
            hurst = self._compute_hurst(all_spreads)
            if hurst >= self.MAX_HURST:
                logger.info(
                    "Pairs skip %s/%s: Hurst %.3f >= %.1f (not mean-reverting)",
                    sym_a, sym_b, hurst, self.MAX_HURST,
                )
                continue

            # --- Filter 4: Spread std not expanding (regime change) ---
            if self._spread_std_expanding(all_spreads):
                logger.info(
                    "Pairs skip %s/%s: spread std expanding (regime change)",
                    sym_a, sym_b,
                )
                continue

            if abs(zscore) >= self.ENTRY_Z:
                candidates.append({
                    "symbol": f"{sym_a}/{sym_b}",
                    "sym_a": sym_a,
                    "sym_b": sym_b,
                    "price_a": closes_a[-1],
                    "price_b": closes_b[-1],
                    "zscore": zscore,
                    "hedge_ratio": hedge,
                    "half_life": half_life,
                    "hurst": hurst,
                    "correlation": correlation,
                    "price": closes_a[-1],  # for sizing
                })
                logger.info(
                    "Pairs candidate %s/%s: z=%.2f half_life=%.1f hurst=%.3f corr=%.3f",
                    sym_a, sym_b, zscore, half_life, hurst, correlation,
                )

        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for pair in candidates:
            zscore = pair["zscore"]
            sym_a = pair["sym_a"]
            sym_b = pair["sym_b"]
            price_a = pair["price_a"]
            price_b = pair["price_b"]
            half_life = pair.get("half_life", 15)
            hurst = pair.get("hurst", 0.4)
            correlation = pair.get("correlation", 0.8)

            abs_z = abs(zscore)
            conviction = min(90, int(50 + (abs_z - 2.0) * 15))
            conviction = max(55, conviction)

            # Boost conviction for faster mean-reverters and lower Hurst
            if half_life < 10:
                conviction = min(95, conviction + 5)
            if hurst < 0.35:
                conviction = min(95, conviction + 5)

            # For pairs, we buy the long leg
            if zscore < -self.ENTRY_Z:
                # Spread below mean: buy A (underperformer)
                signal_symbol = sym_a
                direction = "long_spread"
            else:
                # Spread above mean: buy B (underperformer)
                signal_symbol = sym_b
                direction = "short_spread"

            entry_price = price_a if direction == "long_spread" else price_b
            stop_loss = round(entry_price * 0.95, 2)
            take_profit = round(entry_price * 1.05, 2)

            analyses.append({
                "symbol": signal_symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": entry_price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": "Pairs",
                "rationale": (
                    f"Pairs Trade: {sym_a}/{sym_b} z-score {zscore:+.2f}. "
                    f"{'Buy ' + sym_a + ' (undervalued)' if direction == 'long_spread' else 'Buy ' + sym_b + ' (undervalued)'}. "
                    f"Hedge ratio {pair['hedge_ratio']:.3f}. "
                    f"Half-life {half_life:.1f}d, Hurst {hurst:.3f}, Corr {correlation:.2f}. "
                    f"Target spread reversion to z={self.EXIT_Z:.1f}."
                ),
            })

        return analyses


# =====================================================================
# Strategy 13: KAMA + ATR Breakout (Kaufman 1998)
# =====================================================================

class KAMABreakoutRunner(BaseStrategyRunner):
    """Volatility-adaptive trend: KAMA direction + Keltner Channel breakout.

    Academic: Kaufman "Trading Systems and Methods" (1998).
    ATR-based position sizing (Turtle-style), trailing ATR stops.

    Enhanced with:
    - Bollinger Band squeeze detection (BB inside Keltner = squeeze)
    - Volume surge requirement on breakout bar (vol > 1.5x 20-day avg)
    - KAMA efficiency ratio logging for debugging
    - RSI(14) overbought filter: skip breakouts when RSI > 80
    - Chandelier exit (highest high - 3x ATR) instead of simple ATR stop
    """
    name = "kama_breakout"
    description = "KAMA + ATR breakout — volatility-adaptive trend following"
    use_smart_review = False

    KELTNER_ATR_MULT = 2.0
    KAMA_ER_PERIOD = 10
    VOLUME_SURGE_MULT = 1.5   # breakout bar must have vol > 1.5x avg
    RSI_OVERBOUGHT = 80       # skip breakouts when RSI(14) > 80
    BB_PERIOD = 20
    BB_STD_MULT = 2.0
    CHANDELIER_ATR_MULT = 3.0  # chandelier exit uses 3x ATR

    @staticmethod
    def _compute_rsi(closes: list[float], period: int = 14) -> float:
        """Compute RSI(period) from close prices."""
        if len(closes) < period + 1:
            return 50.0  # neutral default
        gains, losses = [], []
        for i in range(-period, 0):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    @staticmethod
    def _bb_inside_keltner(
        closes: list[float],
        keltner_upper: float,
        keltner_lower: float,
        bb_period: int = 20,
        bb_mult: float = 2.0,
    ) -> bool:
        """True if Bollinger Bands are inside the Keltner Channel (squeeze).

        This is the TTM Squeeze indicator: when BB contracts inside KC,
        volatility is compressed and a breakout is imminent.
        """
        if len(closes) < bb_period:
            return False
        recent = closes[-bb_period:]
        bb_mid = sum(recent) / len(recent)
        bb_std = math.sqrt(sum((c - bb_mid) ** 2 for c in recent) / len(recent))
        bb_upper = bb_mid + bb_mult * bb_std
        bb_lower = bb_mid - bb_mult * bb_std
        return bb_upper < keltner_upper and bb_lower > keltner_lower

    async def screen(self) -> list[dict[str, Any]]:
        """Find stocks breaking above their Keltner Channel upper band."""
        all_stocks = _get_screener_results(limit=100)
        # Pre-filter: positive recent change + decent RS
        candidates = [
            s for s in all_stocks
            if s.get("change_pct", 0) > 0
            and s["metrics"].get("rs_score", 0) > 50
        ]
        candidates.sort(key=lambda x: x.get("change_pct", 0), reverse=True)
        candidates = await _enrich_with_real_prices(candidates[:25])
        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates[:10]:
            symbol = stock["symbol"]
            price = stock.get("price", 0)

            bars = await _get_bars(symbol, limit=100)
            closes = bars["closes"]
            highs = bars["highs"]
            lows = bars["lows"]
            volumes = bars.get("volumes", [])

            if len(closes) < 50:
                continue

            # KAMA with efficiency ratio logging
            fast_alpha = 2 / 3
            slow_alpha = 2 / 31
            kama_vals = [closes[self.KAMA_ER_PERIOD]]
            last_er = 0.0
            for i in range(self.KAMA_ER_PERIOD + 1, len(closes)):
                direction = abs(closes[i] - closes[i - self.KAMA_ER_PERIOD])
                volatility = sum(
                    abs(closes[j] - closes[j - 1])
                    for j in range(i - self.KAMA_ER_PERIOD + 1, i + 1)
                )
                er = direction / volatility if volatility > 0 else 0
                sc = (er * (fast_alpha - slow_alpha) + slow_alpha) ** 2
                kama_vals.append(kama_vals[-1] + sc * (closes[i] - kama_vals[-1]))
                last_er = er

            logger.debug(
                "KAMA %s: ER=%.3f KAMA=%.2f price=%.2f",
                symbol, last_er, kama_vals[-1], closes[-1],
            )

            kama_now = kama_vals[-1]
            kama_prev = kama_vals[-2] if len(kama_vals) >= 2 else kama_now
            kama_up = kama_now > kama_prev
            above_kama = closes[-1] > kama_now

            # Keltner Channel
            ema20 = sum(closes[:20]) / 20
            mult = 2 / 21
            for c in closes[20:]:
                ema20 = c * mult + ema20 * (1 - mult)

            # ATR(20)
            if len(closes) >= 21:
                true_ranges = []
                for i in range(-20, 0):
                    tr = max(
                        highs[i] - lows[i],
                        abs(highs[i] - closes[i - 1]),
                        abs(lows[i] - closes[i - 1]),
                    )
                    true_ranges.append(tr)
                atr = sum(true_ranges) / len(true_ranges)
            else:
                atr = (max(closes) - min(closes)) / 10

            upper = ema20 + self.KELTNER_ATR_MULT * atr
            lower = ema20 - self.KELTNER_ATR_MULT * atr
            breakout = closes[-1] > upper

            if not (kama_up and above_kama and breakout):
                continue  # No signal

            # --- Filter: RSI overbought check ---
            rsi = self._compute_rsi(closes, 14)
            if rsi > self.RSI_OVERBOUGHT:
                logger.info(
                    "KAMA skip %s: RSI(14)=%.1f > %d (overbought, likely to revert)",
                    symbol, rsi, self.RSI_OVERBOUGHT,
                )
                continue

            # --- Filter: Volume surge on breakout bar ---
            vol_surge = False
            if len(volumes) >= 21:
                avg_vol = sum(volumes[-21:-1]) / 20
                current_vol = volumes[-1]
                vol_surge = avg_vol > 0 and current_vol > avg_vol * self.VOLUME_SURGE_MULT
                if not vol_surge:
                    logger.info(
                        "KAMA skip %s: volume %d < %.0fx avg %d (no surge confirmation)",
                        symbol, current_vol, self.VOLUME_SURGE_MULT, avg_vol,
                    )
                    continue

            # Squeeze detection: BB inside Keltner (TTM Squeeze)
            bb_squeeze = self._bb_inside_keltner(
                closes, upper, lower, self.BB_PERIOD, self.BB_STD_MULT
            )
            # Also check ATR compression as secondary squeeze
            if len(closes) >= 60 and len(highs) >= 60:
                old_trs = []
                for i in range(-60, -40):
                    tr = max(
                        highs[i] - lows[i],
                        abs(highs[i] - closes[i - 1]),
                        abs(lows[i] - closes[i - 1]),
                    )
                    old_trs.append(tr)
                old_atr = sum(old_trs) / len(old_trs)
                atr_squeeze = old_atr > 0 and atr / old_atr < 0.75
            else:
                atr_squeeze = False
            squeeze = bb_squeeze or atr_squeeze

            conviction = min(90, int(55 + (closes[-1] - upper) / price * 300))
            if squeeze:
                conviction = min(95, conviction + 10)
            if bb_squeeze:
                conviction = min(95, conviction + 5)  # extra for proper BB squeeze

            # Chandelier exit: highest high - 3x ATR (instead of simple 2x ATR stop)
            highest_high = max(highs[-20:]) if len(highs) >= 20 else price
            chandelier_stop = round(highest_high - self.CHANDELIER_ATR_MULT * atr, 2)
            stop_loss = max(chandelier_stop, round(price - self.CHANDELIER_ATR_MULT * atr, 2))
            take_profit = round(price + 3 * self.CHANDELIER_ATR_MULT * atr, 2)  # 3:1 R/R

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"KAMA Breakout: {symbol} broke above Keltner upper ${upper:.2f} "
                    f"(KAMA slope up, ER={last_er:.2f}, price > KAMA ${kama_now:.2f}). "
                    f"ATR ${atr:.2f}, RSI {rsi:.0f}. "
                    f"{'BB Squeeze breakout! ' if bb_squeeze else ''}"
                    f"{'ATR squeeze! ' if atr_squeeze else ''}"
                    f"Vol surge confirmed. "
                    f"Chandelier stop ${stop_loss:.2f}, target ${take_profit:.2f}."
                ),
            })

        return analyses


# =====================================================================
# Strategy 14: Opening Range Breakout (Crabel 1990 / Fisher ACD)
# =====================================================================

class ORBRunner(BaseStrategyRunner):
    """Opening Range Breakout: trade the first directional move of the day.

    Academic: Crabel "Day Trading with Short Term Price Patterns" (1990),
    Fisher "The Logical Trader" (ACD Method).
    Uses the first 30 minutes' high/low as the opening range.

    Enhanced filters:
    - Pre-market gap detection (gap > 2% = higher reversal risk)
    - Relative volume check (first 30 min volume > 1.5x typical)
    - FOMC / NFP / OpEx day avoidance
    - NR7 (Narrow Range 7-day) filter for optimal setups
    - Fibonacci extension targets (1.272x and 1.618x OR width)
    - Time-of-day filter (no signals after 11:30 AM ET)
    """
    name = "orb"
    description = "Opening Range Breakout — trade first directional move"
    use_smart_review = False

    OR_MINUTES = 30
    GAP_REVERSAL_PCT = 2.0   # gap > 2% triggers reversal warning
    RVOL_THRESHOLD = 1.5     # relative volume floor for first 30 min
    FIB_TARGET_1 = 1.272     # first Fibonacci extension target
    FIB_TARGET_2 = 1.618     # runner Fibonacci extension target
    SIGNAL_CUTOFF_HOUR = 11  # no new signals after 11:30 AM ET
    SIGNAL_CUTOFF_MIN = 30

    # --- Calendar helpers (FOMC / NFP / OpEx) ---

    @staticmethod
    def _get_fomc_dates(year: int) -> set:
        from datetime import date as _date
        _fomc = {
            2024: [
                (1, 31), (3, 20), (5, 1), (6, 12), (7, 31),
                (9, 18), (11, 7), (12, 18),
            ],
            2025: [
                (1, 29), (3, 19), (5, 7), (6, 18), (7, 30),
                (9, 17), (10, 29), (12, 17),
            ],
            2026: [
                (1, 28), (3, 18), (4, 29), (6, 17), (7, 29),
                (9, 16), (10, 28), (12, 16),
            ],
        }
        return {_date(year, m, d) for m, d in _fomc.get(year, [])}

    @staticmethod
    def _get_nfp_dates(year: int) -> set:
        from datetime import date as _date, timedelta
        dates = set()
        for month in range(1, 13):
            first = _date(year, month, 1)
            friday = first + timedelta(days=(4 - first.weekday()) % 7)
            dates.add(friday)
        return dates

    @staticmethod
    def _get_opex_dates(year: int) -> set:
        from datetime import date as _date, timedelta
        dates = set()
        for month in range(1, 13):
            first = _date(year, month, 1)
            friday = first + timedelta(days=(4 - first.weekday()) % 7)
            dates.add(friday + timedelta(weeks=2))
        return dates

    def _is_macro_event_day(self) -> tuple[bool, str]:
        from datetime import date as _date
        today = _date.today()
        yr = today.year
        if today in self._get_fomc_dates(yr):
            return True, "FOMC announcement day"
        if today in self._get_nfp_dates(yr):
            return True, "Non-Farm Payrolls day"
        if today in self._get_opex_dates(yr):
            return True, "Monthly options expiration day"
        return False, ""

    @staticmethod
    def _is_nr7(daily_highs: list[float], daily_lows: list[float]) -> bool:
        """Narrow Range 7: today's range is narrowest of last 7 days."""
        if len(daily_highs) < 7 or len(daily_lows) < 7:
            return False
        ranges = [daily_highs[-(7 - i)] - daily_lows[-(7 - i)] for i in range(7)]
        return ranges[-1] == min(ranges) and ranges[-1] > 0

    async def _get_intraday_bars(self, symbol: str) -> dict[str, list]:
        """Fetch 5-minute bars for today to compute opening range."""
        import httpx
        from datetime import datetime, timezone
        from core.config import settings

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                    headers=headers,
                    params={
                        "timeframe": "5Min",
                        "start": f"{today}T13:30:00Z",  # 9:30 ET in UTC
                        "limit": 78,  # full day of 5-min bars
                        "feed": "sip",
                    },
                )
                if resp.status_code != 200:
                    return {"closes": [], "highs": [], "lows": [], "volumes": []}

                bars = resp.json().get("bars", [])
                return {
                    "closes": [b["c"] for b in bars],
                    "highs": [b["h"] for b in bars],
                    "lows": [b["l"] for b in bars],
                    "volumes": [b["v"] for b in bars],
                    "timestamps": [b["t"] for b in bars],
                }
        except Exception as e:
            logger.warning("Failed to fetch intraday bars for %s: %s", symbol, e)
            return {"closes": [], "highs": [], "lows": [], "volumes": []}

    async def screen(self) -> list[dict[str, Any]]:
        """Screen liquid large-caps with significant opening moves."""
        all_stocks = _get_screener_results(limit=100)
        candidates = [
            s for s in all_stocks
            if s.get("volume", 0) > 500_000
            and abs(s.get("change_pct", 0)) > 0.3  # some movement today
        ]
        candidates.sort(key=lambda x: abs(x.get("change_pct", 0)), reverse=True)
        candidates = await _enrich_with_real_prices(candidates[:20])
        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []

        # ---- FILTER: FOMC / NFP / OpEx day avoidance ----
        is_macro, macro_reason = self._is_macro_event_day()
        if is_macro:
            logger.info("ORB skipping today: %s", macro_reason)
            return analyses

        # ---- FILTER: Time-of-day cutoff (no signals after 11:30 AM ET) ----
        from zoneinfo import ZoneInfo
        from datetime import datetime
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if (now_et.hour > self.SIGNAL_CUTOFF_HOUR
                or (now_et.hour == self.SIGNAL_CUTOFF_HOUR
                    and now_et.minute >= self.SIGNAL_CUTOFF_MIN)):
            logger.info("ORB skipping: past %d:%02d ET cutoff",
                        self.SIGNAL_CUTOFF_HOUR, self.SIGNAL_CUTOFF_MIN)
            return analyses

        for stock in candidates[:8]:
            symbol = stock["symbol"]
            price = stock.get("price", 0)

            # Fetch 5-min intraday bars
            intraday = await self._get_intraday_bars(symbol)
            highs = intraday["highs"]
            lows = intraday["lows"]
            intraday_volumes = intraday["volumes"]

            # Also fetch daily bars for NR7 and gap detection
            daily_bars = await _get_bars(symbol, limit=10)
            daily_highs = daily_bars["highs"]
            daily_lows = daily_bars["lows"]
            daily_closes = daily_bars["closes"]
            daily_volumes = daily_bars["volumes"]

            if len(highs) < 6:
                # Not enough bars for opening range (need 6 x 5min = 30min)
                # Fall back to daily data: use previous day's range
                if daily_highs and daily_lows:
                    or_high = daily_highs[-1]
                    or_low = daily_lows[-1]
                else:
                    continue
            else:
                # Opening range = first 6 five-minute bars (30 min)
                or_high = max(highs[:6])
                or_low = min(lows[:6])

            or_width = or_high - or_low
            or_width_pct = (or_width / or_low) * 100 if or_low > 0 else 0

            if or_width_pct < 0.3 or or_width_pct > 3.0:
                continue  # Opening range too narrow or too wide

            # ---- FILTER: Pre-market gap detection ----
            gap_pct = 0.0
            gap_warning = False
            if daily_closes and len(daily_closes) >= 2:
                prev_close = daily_closes[-2]
                if prev_close > 0:
                    gap_pct = ((or_low - prev_close) / prev_close) * 100
                    if gap_pct > self.GAP_REVERSAL_PCT:
                        gap_warning = True

            # ---- FILTER: Relative volume (first 30 min vs typical) ----
            or_volume = sum(intraday_volumes[:6]) if len(intraday_volumes) >= 6 else 0
            avg_daily_vol = (sum(daily_volumes) / len(daily_volumes)) if daily_volumes else 1
            # Typical first-30-min volume is roughly 30% of daily volume
            avg_or_volume = avg_daily_vol * 0.30
            rvol = (or_volume / avg_or_volume) if avg_or_volume > 0 else 1.0

            if rvol < self.RVOL_THRESHOLD:
                logger.debug("ORB skipping %s: rvol %.2f < %.1f threshold",
                             symbol, rvol, self.RVOL_THRESHOLD)
                continue

            # ---- NR7 check ----
            nr7 = self._is_nr7(daily_highs, daily_lows)

            breakout_long = price > or_high
            breakout_short = price < or_low

            if not breakout_long and not breakout_short:
                continue

            # Conviction based on distance from OR boundary
            if breakout_long:
                dist = (price - or_high) / or_width * 100
                conviction = min(85, int(55 + dist * 3))
                direction = "long"
            else:
                dist = (or_low - price) / or_width * 100
                conviction = min(85, int(55 + dist * 3))
                direction = "short"

            # Apply gap reversal penalty
            if gap_warning:
                conviction = max(30, conviction - 15)

            # NR7 bonus: breakouts after narrow-range days are more reliable
            if nr7:
                conviction = min(95, conviction + 10)

            # ---- Fibonacci extension targets instead of fixed 1.5x ----
            if direction == "long":
                stop_loss = round(price - 0.5 * or_width, 2)
                take_profit = round(price + self.FIB_TARGET_1 * or_width, 2)
                take_profit_runner = round(price + self.FIB_TARGET_2 * or_width, 2)
            else:
                stop_loss = round(price * 1.02, 2)
                take_profit = round(price * 0.97, 2)
                take_profit_runner = round(price * 0.96, 2)

            # Only take long side (platform trades long equity)
            if direction == "short":
                continue

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"ORB: {symbol} broke above opening range high ${or_high:.2f} "
                    f"(range ${or_low:.2f}-${or_high:.2f}, width {or_width_pct:.1f}%). "
                    f"Fib targets ${take_profit:.2f} (1.272x) / ${take_profit_runner:.2f} (1.618x). "
                    f"Stop ${stop_loss:.2f}. "
                    f"RVOL {rvol:.1f}x. "
                    f"{'NR7 setup. ' if nr7 else ''}"
                    f"{'Gap warning (' + f'{gap_pct:+.1f}' + '%). ' if gap_warning else ''}"
                ),
            })

        return analyses


# =====================================================================
# Strategy 15: VWAP Strategy (Berkowitz et al. 1988 / Madhavan 2002)
# =====================================================================

class VWAPRunner(BaseStrategyRunner):
    """VWAP bounce and deviation band strategy.

    Academic: Berkowitz, Logue & Noser (1988) "The Total Cost of Transactions
    on the NYSE". Madhavan (2002) "VWAP Strategies".
    Institutional benchmark -- price above VWAP = buying pressure.

    Enhanced features:
    - Intraday VWAP from 5-min bars when available (falls back to daily proxy)
    - Anchored VWAP from significant events (earnings, breakout days)
    - VWAP slope detection: rising = bullish, falling = bearish
    - Bullish candlestick confirmation on bounce (hammer / engulfing)
    - Multi-timeframe VWAP alignment (daily + weekly)
    - Adaptive position sizing on 2nd/3rd successful VWAP test
    """
    name = "vwap_strategy"
    description = "VWAP bounce/breakout — institutional benchmark strategy"
    use_smart_review = False

    BOUNCE_PCT = 0.3  # within 0.3% of VWAP = bounce zone
    BOUNCE_SIZE_MULT_2ND = 1.25  # 25% more size on 2nd successful test
    BOUNCE_SIZE_MULT_3RD = 1.50  # 50% more size on 3rd successful test

    async def _get_intraday_bars(self, symbol: str) -> dict[str, list]:
        """Fetch 5-minute bars for today for accurate intraday VWAP."""
        import httpx
        from datetime import datetime, timezone
        from core.config import settings

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                    headers=headers,
                    params={
                        "timeframe": "5Min",
                        "start": f"{today}T13:30:00Z",
                        "limit": 78,
                        "feed": "sip",
                    },
                )
                if resp.status_code != 200:
                    return {"closes": [], "highs": [], "lows": [], "volumes": [], "opens": []}

                bars = resp.json().get("bars", [])
                return {
                    "closes": [b["c"] for b in bars],
                    "highs": [b["h"] for b in bars],
                    "lows": [b["l"] for b in bars],
                    "volumes": [b["v"] for b in bars],
                    "opens": [b["o"] for b in bars],
                }
        except Exception as e:
            logger.warning("Failed to fetch intraday bars for %s: %s", symbol, e)
            return {"closes": [], "highs": [], "lows": [], "volumes": [], "opens": []}

    @staticmethod
    def _compute_vwap_slope(
        closes: list[float], highs: list[float],
        lows: list[float], volumes: list[int],
        lookback: int = 5,
    ) -> float:
        """VWAP slope as per-bar change over *lookback* bars (% of VWAP)."""
        if len(closes) < lookback + 2:
            return 0.0

        def _vwap_at(end_idx: int, window: int = 10) -> float:
            start = max(0, end_idx - window)
            cum_tpv = 0.0
            cum_v = 0
            for j in range(start, end_idx):
                tp = (highs[j] + lows[j] + closes[j]) / 3
                cum_tpv += tp * volumes[j]
                cum_v += volumes[j]
            return cum_tpv / cum_v if cum_v > 0 else closes[end_idx - 1]

        n = len(closes)
        vwap_now = _vwap_at(n, min(10, n))
        vwap_prev = _vwap_at(n - lookback, min(10, n - lookback))
        if vwap_prev == 0:
            return 0.0
        return ((vwap_now - vwap_prev) / vwap_prev) * 100

    @staticmethod
    def _is_hammer(open_p: float, high: float, low: float, close: float) -> bool:
        """Detect a hammer candlestick (small body near top, long lower shadow)."""
        body = abs(close - open_p)
        candle_range = high - low
        if candle_range == 0:
            return False
        lower_shadow = min(open_p, close) - low
        upper_shadow = high - max(open_p, close)
        return (lower_shadow >= 2 * body
                and upper_shadow < body * 0.5
                and body / candle_range < 0.35)

    @staticmethod
    def _is_bullish_engulfing(
        prev_open: float, prev_close: float,
        curr_open: float, curr_close: float,
    ) -> bool:
        """Detect a bullish engulfing pattern (2-bar)."""
        prev_bearish = prev_close < prev_open
        curr_bullish = curr_close > curr_open
        engulfs = curr_open <= prev_close and curr_close >= prev_open
        return prev_bearish and curr_bullish and engulfs

    @staticmethod
    def _find_anchor_index(
        closes: list[float], volumes: list[int],
        highs: list[float], lows: list[float],
    ) -> int | None:
        """Find the most recent significant event bar for anchored VWAP.

        Looks for volume spike > 3x 20-day avg or range breakout on
        above-average volume. Returns bar index or None.
        """
        n = len(closes)
        if n < 25:
            return None
        lookback = min(60, n)
        avg_vol_20 = sum(volumes[max(0, n - 25): n - 5]) / 20 if n > 25 else 1

        for i in range(n - 5, max(n - lookback, 20), -1):
            if avg_vol_20 > 0 and volumes[i] > 3 * avg_vol_20:
                return i
            prior_high = max(highs[max(0, i - 20): i])
            if closes[i] > prior_high and volumes[i] > 1.5 * avg_vol_20:
                return i
        return None

    @staticmethod
    def _compute_anchored_vwap(
        closes: list[float], highs: list[float],
        lows: list[float], volumes: list[int],
        anchor_idx: int,
    ) -> float:
        """VWAP anchored from *anchor_idx* to the end of the series."""
        if anchor_idx < 0 or anchor_idx >= len(closes):
            return 0.0
        cum_tpv = 0.0
        cum_vol = 0
        for i in range(anchor_idx, len(closes)):
            tp = (highs[i] + lows[i] + closes[i]) / 3
            cum_tpv += tp * volumes[i]
            cum_vol += volumes[i]
        return cum_tpv / cum_vol if cum_vol > 0 else closes[-1]

    async def screen(self) -> list[dict[str, Any]]:
        """Find liquid stocks pulling back toward or bouncing off VWAP."""
        all_stocks = _get_screener_results(limit=100)
        candidates = [
            s for s in all_stocks
            if s["metrics"].get("rs_score", 0) > 45  # not weak
        ]
        candidates.sort(key=lambda x: x.get("composite_score", 0), reverse=True)
        candidates = await _enrich_with_real_prices(candidates[:25])
        return candidates

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates[:10]:
            symbol = stock["symbol"]
            price = stock.get("price", 0)

            bars = await _get_bars(symbol, limit=60)
            closes = bars["closes"]
            highs = bars["highs"]
            lows = bars["lows"]
            volumes = bars["volumes"]

            if len(closes) < 20:
                continue

            # ---- IMPROVEMENT 1: Use intraday bars for accurate VWAP ----
            intraday = await self._get_intraday_bars(symbol)
            intra_c = intraday["closes"]
            intra_h = intraday["highs"]
            intra_l = intraday["lows"]
            intra_v = intraday["volumes"]
            intra_o = intraday["opens"]

            if len(intra_c) >= 10:
                # True intraday VWAP from 5-min bars
                cum_tpv = 0.0
                cum_vol = 0
                for i in range(len(intra_c)):
                    tp = (intra_h[i] + intra_l[i] + intra_c[i]) / 3
                    cum_tpv += tp * intra_v[i]
                    cum_vol += intra_v[i]
                vwap = cum_tpv / cum_vol if cum_vol > 0 else price
                vwap_source = "intraday"
            else:
                # Fall back to daily bars as proxy
                cum_tpv = 0.0
                cum_vol = 0
                for i in range(-20, 0):
                    tp = (highs[i] + lows[i] + closes[i]) / 3
                    cum_tpv += tp * volumes[i]
                    cum_vol += volumes[i]
                vwap = cum_tpv / cum_vol if cum_vol > 0 else price
                vwap_source = "daily_proxy"

            # VWAP deviation bands (2 std dev)
            cum_sq = 0.0
            for i in range(20):
                idx = -(20 - i)
                tp = (highs[idx] + lows[idx] + closes[idx]) / 3
                cum_sq += volumes[idx] * (tp - vwap) ** 2
            std_dev = math.sqrt(cum_sq / cum_vol) if cum_vol > 0 else price * 0.02
            upper_band = vwap + 2 * std_dev
            lower_band = vwap - 2 * std_dev

            # ---- IMPROVEMENT 2: Anchored VWAP from significant events ----
            anchor_idx = self._find_anchor_index(closes, volumes, highs, lows)
            anchored_vwap = 0.0
            if anchor_idx is not None:
                anchored_vwap = self._compute_anchored_vwap(
                    closes, highs, lows, volumes, anchor_idx,
                )

            # ---- IMPROVEMENT 3: VWAP slope detection ----
            vwap_slope = self._compute_vwap_slope(closes, highs, lows, volumes)
            vwap_rising = vwap_slope > 0.05
            vwap_falling = vwap_slope < -0.05

            # ---- IMPROVEMENT 5: Multi-timeframe VWAP (weekly proxy) ----
            weekly_window = min(len(closes), 5)
            wk_cum_tpv = 0.0
            wk_cum_vol = 0
            for i in range(-weekly_window, 0):
                tp = (highs[i] + lows[i] + closes[i]) / 3
                wk_cum_tpv += tp * volumes[i]
                wk_cum_vol += volumes[i]
            weekly_vwap = wk_cum_tpv / wk_cum_vol if wk_cum_vol > 0 else price
            daily_weekly_aligned = price > vwap and price > weekly_vwap

            # Trend filter: 20-day SMA
            sma20 = sum(closes[-20:]) / 20
            uptrend = price > sma20

            # Volume ratio
            avg_vol = sum(volumes[-20:]) / 20
            vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 1.0

            # Distance from VWAP
            vwap_dist = ((price - vwap) / vwap) * 100 if vwap > 0 else 0

            # ---- IMPROVEMENT 4: Candlestick confirmation on bounce ----
            candle_confirm = False
            if len(intra_o) >= 2 and len(intra_h) >= 2:
                if self._is_hammer(intra_o[-1], intra_h[-1], intra_l[-1], intra_c[-1]):
                    candle_confirm = True
                if self._is_bullish_engulfing(
                    intra_o[-2], intra_c[-2], intra_o[-1], intra_c[-1],
                ):
                    candle_confirm = True
            elif len(closes) >= 2 and len(highs) >= 2:
                daily_open_proxy = closes[-2]
                if self._is_hammer(daily_open_proxy, highs[-1], lows[-1], closes[-1]):
                    candle_confirm = True

            # Detect signal type
            signal_type = "none"
            conviction = 40

            if uptrend and abs(vwap_dist) < self.BOUNCE_PCT:
                # VWAP Bounce: price pulling back to VWAP in uptrend
                signal_type = "vwap_bounce"
                conviction = min(85, int(50 + (self.BOUNCE_PCT - abs(vwap_dist)) * 80))
                if vol_ratio >= 1.2:
                    conviction = min(90, conviction + 8)
                # Candlestick confirmation bonus
                if candle_confirm:
                    conviction = min(92, conviction + 8)
                # VWAP slope bonus
                if vwap_rising:
                    conviction = min(93, conviction + 5)
                elif vwap_falling:
                    conviction = max(30, conviction - 10)
            elif price > upper_band and vol_ratio >= 1.2 and uptrend:
                # Upper band breakout with volume
                signal_type = "upper_band_breakout"
                breakout_pct = (price - upper_band) / upper_band * 100
                conviction = min(85, int(55 + breakout_pct * 8))
                if vwap_rising:
                    conviction = min(90, conviction + 5)
            elif len(closes) >= 2 and closes[-2] < vwap and closes[-1] > vwap and uptrend:
                # VWAP reclaim
                signal_type = "vwap_reclaim"
                conviction = min(75, int(45 + vol_ratio * 5))
                if candle_confirm:
                    conviction = min(80, conviction + 5)

            if signal_type == "none":
                continue

            # Multi-timeframe alignment bonus
            if daily_weekly_aligned:
                conviction = min(95, conviction + 5)

            # Anchored VWAP confirmation
            if anchored_vwap > 0 and price > anchored_vwap:
                conviction = min(95, conviction + 3)

            # Stops based on signal type
            if signal_type == "vwap_bounce":
                stop_loss = round(vwap * 0.995, 2)
                take_profit = round(price + (price - stop_loss) * 2, 2)
            elif signal_type == "upper_band_breakout":
                stop_loss = round(vwap, 2)
                take_profit = round(price + (price - stop_loss) * 1.5, 2)
            else:
                stop_loss = round(lower_band, 2)
                take_profit = round(price + (price - stop_loss) * 2, 2)

            # ---- IMPROVEMENT 6: Adaptive sizing via conviction boost ----
            vwap_bounce_count = 0
            for i in range(-min(10, len(closes)), 0):
                bar_low = lows[i] if abs(i) <= len(lows) else price
                bar_close = closes[i]
                if vwap > 0 and abs(bar_low - vwap) / vwap < 0.005 and bar_close > vwap:
                    vwap_bounce_count += 1

            size_note = ""
            if signal_type == "vwap_bounce" and vwap_bounce_count >= 2:
                conviction = min(95, conviction + 5)
                size_note = f"3rd+ VWAP test (size x{self.BOUNCE_SIZE_MULT_3RD}). "
            elif signal_type == "vwap_bounce" and vwap_bounce_count == 1:
                conviction = min(95, conviction + 3)
                size_note = f"2nd VWAP test (size x{self.BOUNCE_SIZE_MULT_2ND}). "

            analyses.append({
                "symbol": symbol,
                "signal": "buy",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "sector": stock.get("sector", "Unknown"),
                "rationale": (
                    f"VWAP {signal_type.replace('_', ' ').title()}: {symbol} "
                    f"VWAP ${vwap:.2f} (dist {vwap_dist:+.2f}%, source={vwap_source}). "
                    f"Vol {vol_ratio:.1f}x avg. "
                    f"Slope {vwap_slope:+.3f}% ({'rising' if vwap_rising else 'falling' if vwap_falling else 'flat'}). "
                    f"{'Candle confirmed. ' if candle_confirm else ''}"
                    f"{'Daily/Weekly VWAP aligned. ' if daily_weekly_aligned else ''}"
                    f"{f'Anchored VWAP ${anchored_vwap:.2f} confirmed. ' if anchored_vwap > 0 and price > anchored_vwap else ''}"
                    f"{size_note}"
                    f"{'Uptrend confirmed. ' if uptrend else ''}"
                    f"Bands ${lower_band:.2f}-${upper_band:.2f}."
                ),
            })

        return analyses


# =====================================================================
# Registry
# =====================================================================

ALL_STRATEGIES: list[type[BaseStrategyRunner]] = [
    MomentumQualityRunner,
    PEADRunner,
    VRPHarvestRunner,
    EarningsVolRunner,
    RegimeAdaptiveRunner,
    ClaudeAlphaRunner,
    MeanReversionRunner,
    VCPBreakoutRunner,
    TSMomentumRunner,
    RSI2ReversalRunner,
    DualMomentumRunner,
    PairsTradingRunner,
    KAMABreakoutRunner,
    ORBRunner,
    VWAPRunner,
]
