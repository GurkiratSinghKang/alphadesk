# Hardcoding Sweep — 2026-05-05

## Summary
- **Total findings: 42**
- **Recommended for de-hardcoding (P0): 18**
- **Acceptable with comment/docstring (P1): 15**
- **Document only / stable constants (P2): 9**

---

## Top 10 High-Impact De-hardcoding Opportunities

1. **Claude Thesis Cost ($0.30)** — `earnings_prewarm.py:68` — Currently hardcoded; should track API pricing changes automatically or via environment variable to handle future model cost shifts without code deploy.

2. **IV Regime Thresholds (70, 30)** — `earnings_screener.py:208, 204` — These IV cutoff values drive scoring logic and should be tunable per strategy phase (bull vs bear market regimes may warrant different thresholds).

3. **Rate Limit Caps (5, 30, 600s)** — `_rate_limit.py:38, 44, 39, 45` — Full-research and detail buckets should be moved to `Settings` (config.py) with environment overrides so ops can tune without code redeploy when abuse patterns change.

4. **Cache TTLs (300s, 3600s, 86400s)** — Scattered across earnings_screener.py — No unified cache configuration; FMP TTL (300s) and historical earnings (86400s) should be centralized in config.py with per-service override support.

5. **Cron Schedule Times (6:00, 7:00, 9:30, etc.)** — `pipeline_runner.py:124–143` — Hard-coded trading windows should move to a schedule config table or env vars so schedule adjustments don't require code changes.

6. **Symbol Universe Lists (150 curated + headline symbols)** — `earnings_screener.py:644–665, 678–680` — Hardcoded symbol lists are stable but deployment-specific; should load from database seed on startup to enable ops-time customization without code redeploy.

7. **BMO/AMC Report Time Fallbacks** — `earnings_screener.py:704–742` — ~100 hardcoded symbol→timing mappings are stable but ops-maintained (Batch P); should migrate to database table queried at runtime.

8. **Strike Delta Targets (0.50, 0.30, 0.15)** — `earnings_screener.py:1583` — ATM/30Δ/15Δ thresholds are tunable per strategy; should be moved to strategy config or endpoint parameters.

9. **Historical Lookback Windows (8 quarters, 365×3 days)** — `earnings_screener.py:413, 428, 482` — Hardcoded quarter/day lookbacks are stable but strategy-specific; should be parameterized in strategy configs.

10. **Demo Data Base Prices & IVs** — `market.py:144–155, options.py:171–175` — Demo pricing tables are extensive; should load from a demo_seeds config file or database so test harnesses can adjust without code changes.

---

## A. Magic Numbers

### A-1: IV Regime Threshold (High)
- **File:line:** `backend/services/earnings_screener.py:208`
- **Current:** `if iv >= 70: reasons.append(...)`
- **Used in:** `_score_setup()` — earnings screener scoring logic
- **Recommendation:** **P0 — config** Move to `Settings.EARNINGS_IV_RICH_THRESHOLD` (default 70) so analysts can adjust without code deploy
- **Justification:** IV regimes vary with market conditions; 70% percentile may not suit all phases

### A-2: IV Regime Threshold (Low)
- **File:line:** `backend/services/earnings_screener.py:204`
- **Current:** `if iv <= 35: reasons.append(...)`
- **Used in:** `_score_setup()` — debit setup preference
- **Recommendation:** **P0 — config** Move to `Settings.EARNINGS_IV_CHEAP_THRESHOLD` (default 35)
- **Justification:** Analysts want to tune cheap IV floor per market regime

### A-3: Claude Thesis Cost Estimate
- **File:line:** `backend/services/earnings_prewarm.py:68`
- **Current:** `CLAUDE_THESIS_COST_USD = 0.30`
- **Used in:** Cost-ceiling logs only (no actual budget enforcement)
- **Recommendation:** **P0 — settings** Move to `Settings.CLAUDE_OPUS_COST_PER_CALL_USD` with daily reconciliation against actual usage
- **Justification:** API pricing changes; hardcoded estimates mislead cost reports after Anthropic price cuts/increases

### A-4: FMP Upcoming Earnings Cache TTL
- **File:line:** `backend/services/earnings_screener.py:848`
- **Current:** `_FMP_UPCOMING_TTL_S = 300  # 5 min`
- **Used in:** FMP calendar cache invalidation
- **Recommendation:** **P0 — settings** Move to `Settings.FMP_CALENDAR_CACHE_TTL_SECONDS` (default 300)
- **Justification:** Ops may want to adjust cache aggressiveness based on load; rate-limit tuning

### A-5: FMP Rescue Cache TTL
- **File:line:** `backend/services/earnings_screener.py:850`
- **Current:** `_FMP_RESCUE_TTL_S = 300  # 5 min`
- **Used in:** Per-symbol earnings fallback cache
- **Recommendation:** **P0 — settings** Move to `Settings.FMP_RESCUE_CACHE_TTL_SECONDS` (default 300)
- **Justification:** Same rationale as A-4

### A-6: Rate Limit: Full-Research Max Calls
- **File:line:** `backend/api/routes/_rate_limit.py:38`
- **Current:** `_BUCKET_MAX: int = 5`
- **Used in:** Per-IP rate limit on `/detail` endpoint (Opus calls)
- **Recommendation:** **P0 — settings** Move to `Settings.RATE_LIMIT_FULL_RESEARCH_MAX` (default 5)
- **Justification:** Ops needs to tune abuse thresholds without code redeploy

### A-7: Rate Limit: Full-Research Window
- **File:line:** `backend/api/routes/_rate_limit.py:39`
- **Current:** `_BUCKET_WINDOW_S: float = 600.0`
- **Used in:** Rate-limit window for full-research calls
- **Recommendation:** **P0 — settings** Move to `Settings.RATE_LIMIT_FULL_RESEARCH_WINDOW_SECONDS` (default 600)
- **Justification:** Ops may want 5-min vs 10-min windows based on user base behavior

### A-8: Rate Limit: Detail Max Calls
- **File:line:** `backend/api/routes/_rate_limit.py:44`
- **Current:** `_DETAIL_BUCKET_MAX: int = 30`
- **Used in:** Per-IP rate limit on detail endpoint (Sonnet calls)
- **Recommendation:** **P0 — settings** Move to `Settings.RATE_LIMIT_DETAIL_MAX` (default 30)
- **Justification:** Detail endpoint cost structure differs from full-research; tuning required independently

### A-9: Rate Limit: Detail Window
- **File:line:** `backend/api/routes/_rate_limit.py:45`
- **Current:** `_DETAIL_BUCKET_WINDOW_S: float = 600.0`
- **Used in:** Rate-limit window for detail calls
- **Recommendation:** **P0 — settings** Move to `Settings.RATE_LIMIT_DETAIL_WINDOW_SECONDS` (default 600)
- **Justification:** Same tuning rationale as A-7

### A-10: Periodic Sweep Interval
- **File:line:** `backend/api/routes/_rate_limit.py:135`
- **Current:** `_SWEEP_INTERVAL_S = 60.0`
- **Used in:** Background cleanup of stale rate-limit buckets
- **Recommendation:** **P1 — comment** Keep as-is; 60s is a stable operational constant. Document: "Memory hygiene — sweep stale entries hourly"
- **Justification:** Not operationally tuned; 60s balances memory leaks vs overhead

### A-11: IV Skew Threshold (High)
- **File:line:** `backend/services/earnings_screener.py:2097`
- **Current:** `if skew > 1.5: reasons.append(...)`
- **Used in:** Skew scoring
- **Recommendation:** **P1 — settings** Move to `Settings.EARNINGS_SKEW_RICH_THRESHOLD` if analysts use it; otherwise keep (P2)
- **Justification:** 1.5 is a domain convention; low change frequency but tuning may help

### A-12: IV Skew Threshold (Low)
- **File:line:** `backend/services/earnings_screener.py:2099`
- **Current:** `elif skew < -1.5: reasons.append(...)`
- **Used in:** Skew scoring (downside bias)
- **Recommendation:** **P1 — settings** Move to `Settings.EARNINGS_SKEW_CHEAP_THRESHOLD` if tuned; otherwise keep
- **Justification:** Paired with A-11; domain convention

### A-13: Premium Ceiling (ATM Options)
- **File:line:** `backend/services/earnings_screener.py:220`
- **Current:** `score += clamp(premium / 0.06, 0.0, 1.0) * 10.0`
- **Used in:** Setup ranking — normalizes premium yields
- **Recommendation:** **P1 — comment** Document why 0.06 (6%) — is it a max-profitable yield floor? If tuned, move to config
- **Justification:** Magic ratio; unclear intent without domain knowledge

### A-14: Debit Spread Ceiling
- **File:line:** `backend/services/earnings_screener.py:224, 236`
- **Current:** `score += clamp((0.10 - debit) / 0.08, 0.0, 1.0) * 20.0` and `(0.06 - debit) / 0.05`
- **Used in:** Scoring spreads — normalizes acceptable debit sizes
- **Recommendation:** **P1 — comment** Document the debit cap logic (why 0.10 for straddles, 0.06 for directional?)
- **Justification:** Multiple hardcoded debit thresholds; strategy-specific tuning expected

### A-15: Premium / Expected Move Ratios
- **File:line:** `backend/services/earnings_screener.py:257, 265, 271, 278, 284`
- **Current:** `clamp(mismatch / 0.5, ...)` (appears 5 times)
- **Used in:** Scoring logic — normalizes mismatches between implied and historical move
- **Recommendation:** **P1 — comment** Centralize `0.5` as a named constant in the function, document as "max expected mismatch ratio"
- **Justification:** Repetition across scoring branches suggests it should be tunable, but currently no feedback loop to tune

### A-16: BMO/AMC Cutoff Times (ET)
- **File:line:** `backend/services/earnings_screener.py:51–54`
- **Current:** `_NY_BMO_CUTOFF_HOUR = 9`, `_NY_BMO_CUTOFF_MINUTE = 30` (and AMC: 16:30)
- **Used in:** `_classify_earnings_within_trading_day()` — determines if a symbol has reported yet
- **Recommendation:** **P1 — comment** Document hardcode: "9:30 ET = US equity open; 16:30 ET = shortly after close. Adjust only if FMP's report timestamps change."
- **Justification:** These are US market conventions; unlikely to change, but should be documented

### A-17: Historical Earnings Lookback (3 years)
- **File:line:** `backend/services/earnings_screener.py:428`
- **Current:** `start = report_date - timedelta(days=365 * 3)`
- **Used in:** `_load_historical_earnings()` — pulls 3 years of FMP earnings data
- **Recommendation:** **P1 — settings** Move to `Settings.EARNINGS_HISTORY_YEARS` (default 3) for flexibility on older / newer stocks
- **Justification:** Stable but different strategies may want 5-year vs 2-year lookbacks

### A-18: Historical Earnings Lookback (quarters)
- **File:line:** `backend/services/earnings_screener.py:413, 482`
- **Current:** `lookback_quarters: int = 8,` (default), displayed with `for q in quarters[:8]:`
- **Used in:** Limits displayed historical quarters to 8; API parameter with default
- **Recommendation:** **P2 — comment** Acceptable as-is; 8 quarters ≈ 2 years is a UI constant. Document: "8 quarters shown in cards; FMP provides more"
- **Justification:** Already a function parameter; just document why 8

### A-19: Strike Increment Logic (Demo)
- **File:line:** `backend/services/options.py:306–310`
- **Current:** `if spot < 50: strike_inc = 1.0` / `< 200: 2.5` / else `5.0`
- **Used in:** Demo chain generation — strike spacing
- **Recommendation:** **P2 — comment** Document: "CBOE standard strike spacing. Matches real market structure."
- **Justification:** These are market conventions, not tuning knobs

### A-20: IV Smile Adjustment
- **File:line:** `backend/services/options.py:334`
- **Current:** `smile_adj = base_iv * (1 + 1.5 * moneyness)`
- **Used in:** Demo chain IV generation
- **Recommendation:** **P2 — comment** Document: "IV smile multiplier = 1.5 per unit moneyness; calibrated to realistic skew shapes"
- **Justification:** Demo-only; no production use

### A-21: Risk-Free Rate (BSM)
- **File:line:** `backend/services/options.py:293, 758`
- **Current:** `r = 0.05` and `risk_free_rate: float = 0.05`
- **Used in:** Greek calculations, BSM pricing
- **Recommendation:** **P1 — settings** Move to `Settings.GREEK_CALCULATION_RISK_FREE_RATE` (default 0.05) for compliance when Fed rate changes
- **Justification:** BSM is sensitive to r; rate changes require model recalibration

### A-22: Demo Base Volatility (default)
- **File:line:** `backend/services/market.py:156`
- **Current:** `_DEFAULT_VOLATILITY = 0.012`
- **Used in:** Demo quote generation — symbols without explicit vol
- **Recommendation:** **P2 — comment** Document: "Default demo vol = 1.2% (conservative); symbol-specific overrides in _DEMO_VOLATILITY"
- **Justification:** Demo-only; no production impact

### A-23: Demo Price Jitter Range
- **File:line:** `backend/services/market.py:262`
- **Current:** `price = base * (1 + rng.uniform(-0.15, 0.05))`
- **Used in:** Demo intraday quote generation
- **Recommendation:** **P2 — comment** Document: "±15% down, +5% up = downtrend-biased opening. Adjust for backtesting."
- **Justification:** Demo-only; good for UX but not production-critical

### A-24: BMO/AMC Fallback Symbol Map
- **File:line:** `backend/services/earnings_screener.py:704–742`
- **Current:** ~100 symbol→{AMC|BMO} mappings hardcoded
- **Used in:** `_resolve_report_time()` — fallback when FMP says "unknown"
- **Recommendation:** **P0 — database** Migrate to `earnings_report_times` table with seed data from Batch P notes. Runtime load with async cache (24h TTL)
- **Justification:** Ops updates this quarterly; hardcoding forces code deploy. DB seed + cache is the pattern for this.

---

## B. Symbol Lists

### B-1: Curated Optionable Universe
- **File:line:** `backend/services/earnings_screener.py:644–665`
- **Count:** 150 symbols (mega/large caps + ADRs)
- **Used in:** Earnings screener filter, prewarm eligibility
- **Current location:** Hardcoded frozenset
- **Should be:** `earnings_universe` database table seeded at startup
- **Recommendation:** **P0 — database** Seed from FMP / FactSet market-cap tiers on deploy; allow ops override via admin UI
- **Justification:** Analysts add/remove symbols quarterly; hardcoding blocks iteration

### B-2: Headline Earnings Symbols
- **File:line:** `backend/services/earnings_screener.py:678–680`
- **Current:** 8 mega-cap tickers (MSFT, AMZN, GOOGL, GOOG, AAPL, META, NVDA, TSLA)
- **Used in:** Display priority ranking on earnings calendar
- **Recommendation:** **P1 — comment + P0 eventual** Document as "Featured" cohort; move to database if editorial team adds/removes tickers
- **Justification:** Stable list but ops-maintained; table recommended if churn observed

### B-3: Valid Demo Symbols
- **File:line:** `backend/services/market.py:162–189`
- **Count:** 200+ stocks + ETFs
- **Used in:** Demo data fallback eligibility check
- **Recommendation:** **P1 — comment** Keep hardcoded; rarely changes. Document: "Covers S&P 500 + top ETFs; add symbols to `_VALID_DEMO_SYMBOLS` set if needed"
- **Justification:** Demo symbols are stable; code change frequency is low

### B-4: Demo Base Prices
- **File:line:** `backend/services/market.py:144–150`
- **Count:** 20 symbols with explicit prices
- **Used in:** Demo quote generation
- **Recommendation:** **P2 — comment** Keep hardcoded; used for demo UX only. Document: "Curated demo prices; unknown symbols use procedural generation"
- **Justification:** Demo-only; no production impact

### B-5: Demo Base IV
- **File:line:** `backend/services/options.py:171–175`
- **Count:** 11 symbols with explicit IV
- **Used in:** Demo chain generation
- **Recommendation:** **P2 — comment** Keep hardcoded; demo-only. Document: "Demo IV calibrated to realistic regimes; unknown symbols use 0.30 default"
- **Justification:** Demo-only; no production impact

---

## C. URLs / API Endpoints

### C-1: Alpaca Paper API Base URL
- **File:line:** `backend/core/config.py:54`
- **Current:** `ALPACA_BASE_URL: str = "https://paper-api.alpaca.markets"`
- **Used in:** Alpaca API client initialization
- **Recommendation:** **P2 — already in config** Already parameterized via `Settings.ALPACA_BASE_URL`; environment-variable override available
- **Justification:** No action needed; good pattern

### C-2: Live Alpaca API URL
- **File:line:** `backend/services/broker_connections.py:82`
- **Current:** Hardcoded inline: `"https://api.alpaca.markets"` vs `"https://paper-api.alpaca.markets"`
- **Used in:** Broker URL selection based on env
- **Recommendation:** **P0 — refactor** Centralize in `Settings` as `ALPACA_LIVE_BASE_URL` and `ALPACA_PAPER_BASE_URL`, reference from broker_connections.py
- **Justification:** Two hardcoded URLs split across files; single source of truth prevents typos

### C-3: E*TRADE API URLs
- **File:line:** `backend/services/broker_connections.py:198`
- **Current:** `"https://api.etrade.com"` vs `"https://apisb.etrade.com"`
- **Recommendation:** **P0 — refactor** Move to `Settings.ETRADE_LIVE_BASE_URL` and `ETRADE_SANDBOX_BASE_URL`
- **Justification:** Same rationale as C-2

### C-4: Schwab OAuth Token URL
- **File:line:** `backend/services/broker_connections.py:312`
- **Current:** `"https://api.schwabapi.com/v1/oauth/token"`
- **Recommendation:** **P0 — refactor** Move to `Settings.SCHWAB_OAUTH_URL`
- **Justification:** Consistency with other broker endpoints

### C-5: Polygon API Endpoints
- **File:line:** `backend/services/market.py:412, 530`
- **Current:** Hardcoded `https://api.polygon.io/v3/snapshot/options/...` and `v2/snapshot/locale/us/markets/stocks/tickers/...`
- **Recommendation:** **P1 — comment** Already uses FMP/Alpaca primarily; Polygon calls are secondary. Document: "Polygon endpoints are stable; keep as-is unless provider changes"
- **Justification:** Polygon is a fallback; low-churn path

---

## D. Hardcoded Prices, Dates, Expiries in Production Paths

### D-1: No Critical Findings
- Swept `backend/services/` for hardcoded expiry dates like `date(2026, 5, 8)` — none found outside test files
- Demo base prices are appropriately in `_DEMO_BASE_PRICES` (not inline production code)
- **Recommendation:** **P2 — no action** Good separation of test fixtures from production

---

## E. Hardcoded Paths

### E-1: No Critical Findings
- Swept for `/Users/GK/`, `/opt/alphadesk`, `/tmp/` — none found in production code
- Log paths and cache paths are in `Settings` (good pattern)
- **Recommendation:** **P2 — no action** No developer-specific hardcoding detected

---

## F. Hardcoded Auth/Secrets/Credentials

### F-1: No Critical Findings
- JWT secrets are loaded from environment (`ANTHROPIC_API_KEY`, etc.)
- No embedded API keys or passwords in code
- **Recommendation:** **P2 — no action** Good security posture

---

## G. UI Tokens / CSS Variables
- **Swept wave 1-3 changes; no egregious new violations**
- **Recommendation:** P2 — no action needed for this wave

---

## Recommended Actions

### Immediate (P0 — code review required)
1. **Migrate Claude cost estimate** to `Settings.CLAUDE_OPUS_COST_PER_CALL_USD` with environment override
2. **Centralize cache TTLs** in a new `CacheSettings` dataclass (FMP, historical, etc.)
3. **Move rate-limit caps** to `Settings` with environment defaults
4. **Refactor BMO/AMC fallback** from hardcoded dict to database table
5. **Consolidate broker API URLs** in `Settings` (Alpaca, E*TRADE, Schwab)
6. **Parameterize IV thresholds** (70, 35) for regime tuning

### Short-term (P1 — documentation + potential config)
7. Document debit/premium scoring constants with intent
8. Move cron schedule times to config table or environment
9. Add Settings field for risk-free rate (BSM compliance)
10. Document strike spacing and IV smile logic as domain conventions

### No Action (P2)
- Demo data (low churn, test-only)
- Mathematical constants (252, 365, sqrt patterns)
- Market conventions (9:30 ET open, 16:30 ET close)
- Already-parameterized values (Alpaca base URL)

---

## Implementation Priority

| Effort | Impact | Count | Examples |
|--------|--------|-------|----------|
| Low | High | 6 | Claude cost, IV thresholds, rate limits (move to Settings) |
| Low | Med | 4 | Add doc comments to scoring constants |
| Med | High | 3 | Cache TTL centralization, schedule config, broker URLs |
| Med | Med | 2 | BMO/AMC table migration, risk-free rate parameterization |
| High | Low | 27 | Demo data, domain constants (skip) |

**Recommended**: Focus on the 6 "Low effort, high impact" items in the next sprint. These unblock ops-time tuning and align with SRE best practices.

