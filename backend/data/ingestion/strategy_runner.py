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
MAX_POSITION_DOLLAR = 5_000.0


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
                params={"timeframe": "1Day", "limit": 60, "feed": "iex"},
            )
            if resp.status_code != 200:
                return f"Price data unavailable for {symbol}."

            bars = resp.json().get("bars", [])
            if len(bars) < 20:
                return f"Insufficient price history for {symbol}."

            closes = [b["c"] for b in bars]
            volumes = [b["v"] for b in bars]
            current = closes[-1]
            high_52w = max(closes)
            low_52w = min(closes)

            # 20-day EMA
            ema20 = closes[-20]
            mult = 2 / 21
            for c in closes[-19:]:
                ema20 = c * mult + ema20 * (1 - mult)

            # 50-day EMA (if enough data)
            ema50 = None
            if len(closes) >= 50:
                ema50 = closes[-50]
                mult50 = 2 / 51
                for c in closes[-49:]:
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

            # Distance from 52-week high
            dist_from_high = ((current - high_52w) / high_52w) * 100

            # Trend assessment
            trend = "UPTREND" if current > ema20 and (ema50 is None or current > ema50) else \
                    "DOWNTREND" if current < ema20 and (ema50 is None or current < ema50) else "SIDEWAYS"

            lines = [
                f"TECHNICAL DATA for {symbol}:",
                f"  Current Price: ${current:.2f}",
                f"  52-Week High: ${high_52w:.2f} ({dist_from_high:+.1f}% from high)",
                f"  52-Week Low: ${low_52w:.2f}",
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
    """Invoke Claude via CLI (if available) or Anthropic API (fallback)."""

    # --- Try API first (more reliable in Docker) ---
    try:
        from core.config import settings
        api_key = settings.ANTHROPIC_API_KEY.get_secret_value()
        if api_key:
            return await _call_claude_api(prompt, symbol, api_key)
    except Exception:
        pass

    # --- Fallback to CLI ---
    if CLAUDE_CLI is None:
        logger.error("No Claude CLI or API key available for %s", symbol)
        return {"symbol": symbol, "error": "no_claude"}

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

        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            logger.error("Claude CLI error for %s: %s", symbol, err[:300])
            return {"symbol": symbol, "error": err[:300]}

        raw = stdout.decode(errors="replace").strip()
        try:
            wrapper = json.loads(raw)
            text = wrapper.get("result", raw) if isinstance(wrapper, dict) else raw
        except json.JSONDecodeError:
            text = raw

        return _parse_claude_response(text, symbol)

    except asyncio.TimeoutError:
        logger.error("Claude CLI timeout for %s", symbol)
        return {"symbol": symbol, "error": "timeout"}
    except Exception as e:
        logger.error("Analysis error for %s: %s", symbol, e)
        return {"symbol": symbol, "error": str(e)}


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
            if sig != "buy" or conv < 60:
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
        """Barroso & Santa-Clara momentum crash protection.

        When momentum dispersion is high, scale down exposure.
        Returns a multiplier between 0.3 and 1.0.
        """
        rs_scores = [s.get("metrics", {}).get("rs_score", 50) for s in screener_results]
        if len(rs_scores) < 10:
            return 1.0

        rs_scores.sort()
        top_decile = sum(rs_scores[-len(rs_scores)//10:]) / max(len(rs_scores)//10, 1)
        bottom_decile = sum(rs_scores[:len(rs_scores)//10]) / max(len(rs_scores)//10, 1)
        spread = top_decile - bottom_decile

        # Normal spread is ~60 points. If spread > 80, momentum is volatile
        if spread > 80:
            return 0.5  # Cut momentum exposure by half
        elif spread > 70:
            return 0.7
        return 1.0

    async def screen(self) -> list[dict[str, Any]]:
        all_stocks = _get_screener_results(limit=100)
        candidates = [
            s for s in all_stocks
            if s["metrics"].get("rs_score", 0) > 70
            and s["metrics"].get("f_score", 0) >= 6
        ]

        # Apply momentum crash protection: reduce candidate count when vol is high
        vol_scale = self._momentum_vol_scale(all_stocks)
        if vol_scale < 1.0:
            scaled_count = max(1, int(len(candidates) * vol_scale))
            logger.info(
                "Momentum vol scale %.1f applied: %d -> %d candidates",
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

    async def screen(self) -> list[dict[str, Any]]:
        """Find stocks with recent earnings surprises."""
        all_stocks = _get_screener_results(limit=100)

        # Check for big movers (proxy for earnings reaction)
        # AND check actual earnings calendar
        earnings_stocks = []
        seen_symbols: set[str] = set()
        for s in all_stocks:
            change = abs(s.get("change_pct", 0) or 0)
            # Big move = likely earnings reaction
            if change > 3:
                s["_earnings_proxy"] = True
                earnings_stocks.append(s)
                seen_symbols.add(s["symbol"])

        # Also add stocks with upcoming earnings (within 5 days)
        upcoming = _get_upcoming_earnings()
        for s in all_stocks:
            if s["symbol"] in upcoming and s["symbol"] not in seen_symbols:
                s["_upcoming_earnings"] = True
                earnings_stocks.append(s)
                seen_symbols.add(s["symbol"])

        return earnings_stocks[:15]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            symbol = stock["symbol"]
            price = stock["price"]
            change_pct = stock.get("change_pct", 0)
            composite = stock.get("composite_score", 0)

            # Heuristic: positive drift with strong composite -> buy
            if change_pct > 3 and composite > 55:
                signal = "buy"
                conviction = min(95, int(50 + change_pct * 3 + composite * 0.2))
            elif change_pct < -3 and composite < 45:
                signal = "sell"
                conviction = min(95, int(50 + abs(change_pct) * 3))
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
                    f"PEAD: {symbol} moved {change_pct:+.1f}% "
                    f"(composite {composite:.0f}), drift expected to continue."
                ),
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
        return candidates[:15]

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score based on oversold depth + quality."""
        analyses: list[dict[str, Any]] = []
        for stock in candidates:
            change = abs(stock.get("change_pct", 0))
            f_score = stock.get("metrics", {}).get("f_score", 0)
            composite = stock.get("composite_score", 50)

            # Conviction: deeper oversold + higher quality = higher conviction
            conviction = min(90, int(30 + change * 5 + f_score * 3 + composite * 0.2))

            price = stock.get("price", 100)
            stop_loss = round(price * 0.93, 2)  # 7% stop (wider for mean reversion)
            take_profit = round(price * 1.08, 2)  # 8% target (reversion to mean)

            analyses.append({
                "symbol": stock["symbol"],
                "signal": "buy" if conviction >= 55 else "hold",
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "rationale": f"Mean reversion: {stock['symbol']} oversold ({stock.get('change_pct', 0):.1f}%) with F-Score {f_score}. Expected reversion to {take_profit}.",
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

    async def analyze(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score based on trend alignment + volatility contraction."""
        analyses = []
        for stock in candidates:
            rs = stock.get("metrics", {}).get("rs_score", 50)
            composite = stock.get("composite_score", 50)
            f_score = stock.get("metrics", {}).get("f_score", 5)

            # VCP conviction: strong trend + good fundamentals + tight recent range
            # Higher RS = stronger trend, higher f_score = better fundamentals
            conviction = min(85, int(40 + rs * 0.25 + f_score * 2 + composite * 0.1))

            price = stock.get("price", 100)
            # Breakout strategy: tight stop (3%), generous target (10%)
            stop_loss = round(price * 0.97, 2)
            take_profit = round(price * 1.10, 2)

            signal = "buy" if conviction >= 62 else "hold"

            analyses.append({
                "symbol": stock["symbol"],
                "signal": signal,
                "conviction": conviction,
                "entry_price": price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "rationale": f"VCP Breakout: {stock['symbol']} in Stage 2 uptrend (RS {rs}), F-Score {f_score}. Tight 3% stop, 10% target. Reward/risk: 3.3:1.",
                "sector": stock.get("sector", "Unknown"),
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
]
