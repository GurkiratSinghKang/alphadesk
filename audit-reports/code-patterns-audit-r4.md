# AlphaDesk Code-Pattern Correctness Audit — Round 4

Scope: patterns that routinely cause bugs rather than functional bugs already
covered in prior rounds. Focus on error swallowing, null handling, type coercion,
floating-point money math, date/time arithmetic, array/index correctness,
and common JavaScript/Python gotchas.

Ranking key:
- **P0** — can cause real money loss, silent data corruption, or wedge a
  production workflow.
- **P1** — likely to manifest as a user-visible bug or degraded signal quality
  under normal operation.
- **P2** — fragile / style-adjacent; will bite eventually.

---

### [P0] VIX-fetch failure silently defaults the master-agent regime to "bull_low_vol"
**File:** `backend/data/ingestion/daily_pipeline.py:53-81`
**Pattern:** Two `try: ... except Exception: pass` blocks in `_get_vix_level` both fall through to a hard-coded `return 16.5`. Nothing logs the fallback.
**Risk:** If both regime endpoint and Polygon `^VIX` fetch fail (network blip, bad key, URL drift — Polygon `lastTrade` is on a *stocks* route for `VIX` which already looks suspect), the MasterAgent at `master_agent.py:273-282` classifies regime as `bull_low_vol` because `16.5 < 18`. `bull_low_vol` unlocks max deployment. Under real VIX=30, the pipeline would oversize positions at exactly the wrong time.
**Fix:** Log the failure with `logger.exception`, and return `None` from `_get_vix_level` when both providers fail. Propagate up and short-circuit the pipeline run into a "data unavailable" status rather than trading blind. If a static fallback is truly required, pick a conservative value (e.g. 30) and surface it in the log payload and circuit-breaker path.

---

### [P0] Entry order fills but stop-loss order submission is swallowed
**File:** `backend/data/ingestion/daily_pipeline.py:370-384`
**Pattern:**
```python
if effective_stop and effective_stop > 0:
    try:
        stop_oid = await _place_stop_order(...)
    except Exception as e:
        logger.error("Stop-loss order failed for %s: %s", sym, e)
# ... no rollback, no retry, no ledger flag
```
Same pattern for take-profit two lines down.
**Risk:** Position now live with no protective stop. `logger.error` is written but the control flow continues to append to `orders_placed` as if nothing failed. An operator scanning the dashboard sees only "trade placed". In a gap-down this is how accounts bleed.
**Fix:** Either (a) unwind the entry (submit a market sell of the just-filled shares) and raise to circuit-break, or (b) mark the ledger row with `stop_missing = True`, enqueue a retry, and raise a `CRITICAL` alert via Discord/webhook. Do not let the pipeline continue silently.

---

### [P0] Money math in live trade ledger uses `float` and `round()` (banker's rounding)
**File:** `backend/data/ingestion/trade_ledger.py:546-554, 787-789`
**Pattern:** P&L and P&L-% computed on `float(price)`, rounded via Python 3 `round()` which is banker's (half-to-even). E.g. `round((entry_price - float(price)) * qty, 2)`.
**Risk:** Two classes of error: (1) the backtest engine/strategies use `Decimal`, but the live ledger demotes to `float`, so reconciliation between backtest P&L and realised P&L cannot be exact; (2) banker's rounding vs half-up rounding differs at exactly the `.005` boundary, producing asymmetric cents-level drift in `pnl` and `pnl_pct`. Over thousands of trades this creates visible divergence vs. Alpaca's own P&L column.
**Fix:** Use `Decimal` (imported elsewhere in the codebase already) for all price and P&L arithmetic in `trade_ledger.py`, convert to `float` only for DB/JSON serialisation, and standardise rounding with `ROUND_HALF_UP` via `quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)` — consistent with `earnings_vol/strategy.py:41` that already imports `ROUND_HALF_UP`.

---

### [P1] Momentum data / absolute-momentum fetches silently swallow per-symbol failures
**File:** `backend/data/ingestion/daily_pipeline.py:731-755, 762-785`
**Pattern:** Nested `try/except Exception: pass` inside a `for stock in screened[:20]:` / `[:30]` loop. On failure, the symbol is absent from `momentum_data` / `abs_momentum`.
**Risk:** If Alpaca rate-limits or the bars endpoint 5xxs for any subset, `MasterAgent.set_momentum_data` / `set_absolute_momentum` receive partial data. Strategy ranking, factor-crowding detection, and dual-momentum selection now operate on a hidden-biased universe (the symbols that happened to succeed). The warning in `logger.info("Momentum data populated for %d symbols", ...)` shows 18 instead of 30 but makes no noise.
**Fix:** Collect failed symbols, log at WARNING with the list, and if > 20% of attempts fail, treat as an upstream outage — either short-circuit or fall back to a disabled-momentum mode explicitly.

---

### [P1] Backtest engine swallows strategy exceptions at five sites
**File:** `backend/backtest/engine.py:178-181, 260-263, 276-281, 293-298, 316-318, 329-334, 356-361, 423-426, 534-537`
**Pattern:** `try: self.strategy.configure(...) / on_fill / manage / generate_signals ... except Exception: pass` (or assign `[]`).
**Risk:** A real bug in strategy code (e.g. division by zero on one symbol, KeyError on schema drift) disappears from the backtest run. The backtest completes with apparently valid numbers that silently exclude the buggy code path. Tuner objective values are then wrong; walk-forward selects the "least-broken" params rather than the best.
**Fix:** Keep the guard but emit `logger.exception("strategy.<method> raised at %s for %s", session, sym)` and, on any exception inside `generate_signals` / `manage`, tag the `BacktestResult` with `had_errors=True`. Halt walkforward if `had_errors` is set unless the operator explicitly opts in.

---

### [P1] Partial live-quote failures in calendar P&L silently lower reported unrealized P&L
**File:** `backend/api/routes/portfolio.py:884-905`
**Pattern:** Per-position `try: fetch trade ... except Exception: pass`. Any symbol whose latest-trade fetch fails contributes 0 to `total_unrealized`.
**Risk:** Today's calendar cell shows ``total_unrealized = (sum of successful positions only)`` but is labelled as the full day's P&L. If Alpaca 429s half the positions, dashboard day-P&L is understated; next day's close flips the number unexpectedly. This is a credibility hit every time rate limits spike.
**Fix:** Batch-fetch via `/v2/stocks/snapshots?symbols=...` (one request), raise on non-200, and if any single symbol lacks a price, omit the whole day from the calendar with an explicit `has_partial_data` flag so the UI renders "—" rather than a misleading number.

---

### [P1] `getStopOrders` / order-pipeline responses casted to arrays without runtime check
**File:** `frontend/src/lib/api.ts:127-130` (generic) and `lib/api.ts:653-664`
**Pattern:** `apiFetch<T>()` returns `undefined as T` on 204. `getPositions` does `raw.map(...)` on the typed `Record<string, unknown>[]`. If the backend ever returns 204 No Content for a list endpoint (as several list endpoints can), `raw` is `undefined` and `undefined.map` throws — unhandled in the React Query flow.
**Risk:** Hard crash on dashboard mount, bypasses error boundaries, blanks the UI.
**Fix:** Change `apiFetch` to return `undefined as T | undefined`, and have list-returning helpers (`getPositions`, `getOrders`, `getStrategies`, `getBars`) coerce via `return (raw ?? [])`. Alternatively, change the contract: list endpoints should always return `[]` (200) not 204.

---

### [P1] `as unknown as` type laundering around portfolio summary / WebSocket channels
**File:** `frontend/src/lib/api.ts:660, 682-683`; `frontend/src/hooks/useWebSocket.ts:113`; `frontend/src/components/layout/AICopilot.tsx:107`; `frontend/src/components/panels/AnalysisPanel.tsx:646`
**Pattern:** `const rawAny = raw as unknown as Record<string, unknown>;` followed by `(rawAny.day_pnl as number) ?? ...`. This is a double-escape: if `day_pnl` is a string ("NaN" from Python's `float('nan')` → JSON), the `as number` lies; the computation at `dayPnlPct = (dayPnl / lastEquity) * 100` returns `NaN` or `"NaN0100"` depending on JS coercion rules.
**Risk:** Silent NaN propagation into the dashboard's hero number. The UI already has `formatCurrency` that may render `$NaN` or `$—` depending on the code path.
**Fix:** Validate with a small runtime schema (zod or an inline type-guard). Reject non-number `day_pnl` and fall through to `realized_pnl_today`. Remove the `as unknown as` cast once narrowed.

---

### [P1] `parseFloat(x) || default` silently ignores user-entered 0
**File:** `frontend/src/components/panels/PositionSizer.tsx:105, 127`; `frontend/src/components/panels/AnalysisPanel.tsx:828`; `frontend/src/components/panels/BacktestPanel.tsx:699, 703, 722`
**Pattern:** `onChange={(e) => setRiskPct(parseFloat(e.target.value) || 1)}`
**Risk:** A deliberate `"0"` entry is discarded in favour of `1`. For position-sizing inputs this means the user *cannot* set risk % to zero (disable position). The UI appears to accept the keystroke but silently overrides. For stop loss / take profit this is worse — a user who wants `0` to mean "no TP" gets the fallback.
**Fix:** Parse into a nullable, then explicitly handle NaN: `const n = Number(e.target.value); setRiskPct(Number.isFinite(n) ? n : 1);`

---

### [P1] `.slice(-10).reverse()` is safe only because `.slice` returns a fresh array — but the pattern invites a future mutation bug
**File:** `frontend/src/components/dashboard/PerformanceMetrics.tsx:403`
**Pattern:** `data.apiTimings.slice(-10).reverse().map(...)` inside JSX.
**Risk:** Today OK. If anyone refactors to `data.apiTimings.reverse()` for any reason, they mutate a state array and `PerformanceMetrics` starts corrupting the telemetry it renders.
**Fix:** Explicit `[...data.apiTimings].reverse().slice(0, 10)` or `data.apiTimings.slice().reverse().slice(0, 10)` to signal copy intent.

---

### [P1] Python `round()` (banker's) used on currency across backend
**File:** `backend/api/routes/portfolio.py:220, 326-327, 411-412, 636`; `backend/api/routes/trades.py` (see above); `backend/data/ingestion/master_agent.py` several; `backend/strategies/earnings_vol/strategy.py` imports `ROUND_HALF_UP` but ad-hoc `round()` appears too
**Pattern:** `round(value, 2)` where `value` is a P&L, price, or percentage.
**Risk:** Banker's rounding silently shifts values that happen to land on `.xx5`. Users comparing server-reported P&L against Alpaca UI will see 1-cent discrepancies that appear sporadically.
**Fix:** Introduce a `money_round(value: Decimal | float, places: int = 2)` helper that uses `Decimal(...).quantize(..., rounding=ROUND_HALF_UP)`. Replace `round(..., 2)` on dollar-denominated values. Percentage rounding is less sensitive — acceptable to leave.

---

### [P1] Silent `except Exception: pass` in pipeline circuit-breaker notification
**File:** `backend/data/ingestion/daily_pipeline.py:675-681`
**Pattern:** Discord webhook post wrapped in `try: ... except Exception: pass`.
**Risk:** This is the *circuit breaker* path. If the webhook fails (invalid URL, rate limit, network), the operator never learns that the breaker tripped. The pipeline halts silently. They find out on the next morning's equity check.
**Fix:** Keep the try/except but `logger.critical("Circuit breaker fired but notification failed: %s", exc, exc_info=True)`, and also record the breaker event in the ledger or a separate `pipeline_events` row so it surfaces in the UI independent of Discord.

---

### [P2] `SCENARIOS.find(...)!` — non-null assertion on array `.find`
**File:** `frontend/src/components/dashboard/StressTest.tsx:216`
**Pattern:** `: SCENARIOS.find((s) => s.id === selectedScenario)!;`
**Risk:** Today `selectedScenario` is always one of the known ids, so `find` never returns undefined. The `!` makes the assertion a silent lie if anyone ever adds a new id to persisted state but removes it from `SCENARIOS`. Any read of `activeScenario.modifier` then throws.
**Fix:** `const scenario = SCENARIOS.find(...) ?? SCENARIOS[0]; const activeScenario = scenario ?? defaultScenario;` — eliminate the `!`.

---

### [P2] `parseInt(e.target.value)` without radix in reports / analysis inputs
**File:** `frontend/src/app/(dashboard)/reports/page.tsx:649`; `frontend/src/components/panels/AnalysisPanel.tsx:828`; `frontend/src/components/panels/BacktestPanel.tsx:699, 703, 722`
**Pattern:** `parseInt(e.target.value)` no radix.
**Risk:** Modern JS `parseInt` defaults to base-10 for strings not starting with `0x`, so this is mostly safe. Browsers no longer parse leading-zero strings as octal. But ESLint/sonar consistently flag it, and a string `"0x10"` is interpreted as 16 — not impossible if someone pastes a transaction id into a capital/year field.
**Fix:** Always pass `10` as the second argument. (Three of the four hex-parsing sites in `TradingChart.tsx` / `BacktestPanel.tsx` already use `16` correctly for hex color channels.)

---

### [P2] `Math.min(...data)` / `Math.max(...data)` on series with possible NaN or empty
**File:** `frontend/src/components/primitives/Sparkline.tsx:47-50`; `frontend/src/components/dashboard/PortfolioHero.tsx:64-65`; `frontend/src/app/(dashboard)/strategies/[id]/_strategy/EquityPanel.tsx:82-83`
**Pattern:** `const min = Math.min(...data);` with no NaN filtering.
**Risk:** If `data` contains any NaN (trivially produced by `parseFloat("")`, bad backend value), `min` and `max` are NaN; `range` is NaN; every subsequent pixel coordinate is NaN. SVG silently drops the polyline or draws garbage. Also `Math.min(...[])` is `Infinity` — handled by the length check but only in Sparkline.
**Fix:** `const clean = data.filter(Number.isFinite); if (clean.length < 2) return null; const min = Math.min(...clean);`

---

### [P2] Day-diff via `/ 86400000` misses DST transitions
**File:** `frontend/src/components/panels/TradePanel.tsx:1036`
**Pattern:** `const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);`
**Risk:** On the spring-forward and fall-back days, "today minus yesterday" is 23 or 25 hours. `diff` ends up off by one for a window around the transition. Journal entries bucketed into the "last 7 days" chart migrate to the wrong weekday for two days per year.
**Fix:** Use calendar-day subtraction: convert both to `YYYY-MM-DD` in the target tz and diff on the dates, or use `date-fns` `differenceInCalendarDays`.

---

### [P2] `hex.replace("#", "")` only replaces first occurrence (benign here)
**File:** `frontend/src/components/panels/BacktestPanel.tsx:23`, `frontend/src/app/(dashboard)/analytics/page.tsx:27`, `frontend/src/components/charts/TradingChart.tsx:95, 373`
**Pattern:** Replaces only first `#`, which is fine for hex colors but invites bugs if reused elsewhere. Same category: watch for `.replace(regex, ...)` without `g` flag when "replace all" is meant.
**Fix:** For hex colors, use `hex.replace(/^#/, "")` to anchor. Not urgent.

---

### [P2] Copilot fallback spot price `spot = quote.get("last", 100) if quote else 100`
**File:** `backend/agents/earnings.py:126-127`
**Pattern:** If quote dict exists but `"last"` is 0 (stale), `spot = 0` → `spot * 0.02 == 0` → no ATM matches. If quote is missing entirely, spot is the arbitrary literal `100`.
**Risk:** ATM-strike search silently returns empty; expected-move computation returns `None`. Upstream consumer sees "no data" when the real issue is a stale cache.
**Fix:** Reject quotes without a positive `last`. Raise or return an explicit error state.

---

### [P2] Float P&L carries NaN through `Math.max(existing.high, quote.high)` in market store
**File:** `frontend/src/stores/market.ts:57-58`
**Pattern:** `high: Math.max(existing.high || 0, quote.high || 0) || existing.high`
**Risk:** The trailing `|| existing.high` is dead code if both are non-zero finite. If one of them is NaN, `Math.max(NaN, x)` returns NaN. `NaN || existing.high` then falls through to `existing.high`, which masks the bad value. Low impact but an indicator that callers are defending against NaN with short-circuit operators rather than validating upstream.
**Fix:** Filter NaN before max: `const h = [existing.high, quote.high].filter(Number.isFinite); const next = h.length ? Math.max(...h) : existing.high;`

---

### [P2] `async function fetch...catch((err) => {...})` patterns that log but don't surface
**File:** `frontend/src/hooks/useDataPipeline.ts:57-118`
**Pattern:** Five separate `.catch((err) => { console.warn("...", err.message); })` blocks for positions/orders/summary/greeks fetches. Silent in prod.
**Risk:** Dashboard renders stale data indefinitely after a single fetch error. Users have no indication anything is wrong.
**Fix:** Dispatch a toast event (same pattern as `apiFetch` uses at `lib/api.ts:116-120`) so the user sees at least a single "Data refresh failed, retrying" banner.

---

### [P2] `.catch(() => {})` silent error in `useDataPipeline` and strategy detail
**File:** `frontend/src/hooks/useDataPipeline.ts:74`; `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:229`
**Pattern:** Full-silent promise catch returning nothing.
**Risk:** Hides real network errors. See preceding item.
**Fix:** Same as above — at minimum `console.debug` or a dev-only `console.warn`, better yet route to the existing toast bus.

---

### [P2] `quote.low || quote.high` defaults in market store (truthy-on-0 bug)
**File:** `frontend/src/stores/market.ts:58`
**Pattern:** `(existing.low && quote.low) ? Math.min(existing.low, quote.low) : existing.low || quote.low`
**Risk:** If either `low` is `0` (illiquid ticker snapshot, not data-missing), the short-circuit treats it as missing and falls through. `0` is a legitimate low for an option that closed worthless.
**Fix:** Explicit `typeof x === "number" && Number.isFinite(x)` guard.

---

### [P2] `getOrders(status).catch(() => [])` masks 5xx as empty
**File:** `frontend/src/app/(dashboard)/page.tsx:146-147`
**Pattern:** `getOrders("pending").catch(() => [])` and `"open"` variant.
**Risk:** Dashboard "open orders" card renders "No open orders" when the backend is returning 500. User believes orders are clean when they are not retrievable.
**Fix:** Distinguish empty from error — return `null` on error, show a "failed to load" state in the card.

---

### [P2] `.sort((a, b) => ...)` on arrays that LOOK local but are actually inputs to `useMemo`
**File:** `frontend/src/components/dashboard/StressTest.tsx:155`; `frontend/src/components/dashboard/StrategyCorrelation.tsx:106`; `frontend/src/components/dashboard/PnlAttribution.tsx:47`; `frontend/src/components/dashboard/SectorTreemap.tsx:232`
**Pattern:** Array built locally in the useMemo body, then `.sort(...)`, then returned. Safe today because each is a fresh array from `.map`, `.filter`, or `.reduce`.
**Risk:** A future refactor that threads through a prop-derived array without copying would silently mutate the prop. Since none of these places does `[...]` copy first, the next developer that adds `results = props.results` at the top introduces a state-mutation bug.
**Fix:** Start each with `const arr = [...source];` even when `source` is locally built, as a habit. Not urgent.

---

### [P2] `request.legs[0]` trusted throughout trade submit path
**File:** `backend/api/routes/trades.py:312-315, 328, 334, 970`
**Pattern:** Pydantic enforces `min_length=1` so today this is fine. Callers that go through the internal `_submit_to_broker` branch skipping request validation could get an IndexError.
**Risk:** Low today, but the audit trail in `logger.info` at 310-317 is built inline with `.legs[0]` accesses; future multi-leg logging changes could subtly drop legs 2+. E.g. the `limit_price` on line 315 only logs leg 0 — for a 4-leg options structure, observability is truncated.
**Fix:** Iterate `request.legs` and log each leg's side/qty/symbol/limit; keep the first-leg abbreviation only when `len(request.legs) == 1`.

---

### Items checked and deemed OK (not flagged)

- Mutable default args (`def foo(x=[])`): grep returned zero.
- Bare `except:` (no Exception type): zero matches.
- `== None` / `!= None`: zero matches (all use `is None`).
- Division by `len(...)` without guard: all call sites either guard `if x:` or compute on lists proven non-empty.
- `parseInt(hex, 16)` for colors: correct radix.
- Frontend `==` vs `===`: no loose-equality operators found.
- Mutable-state sort on React state array passed via prop: all call sites copy via spread or `filter`/`map`.

---

## Top 15 by actual-bug potential (summary)

1. **Default VIX=16.5 on both-path failure** drives live sizing into `bull_low_vol` even if real VIX is 40 (`daily_pipeline.py:53-81`).
2. **Stop-loss order failure is a non-event** — position is live with no protective exit (`daily_pipeline.py:370-384`).
3. **Live-trade P&L uses `float` + banker's `round`**, diverging from backtest `Decimal` and Alpaca's reported P&L (`trade_ledger.py`).
4. **Momentum / absolute-momentum per-symbol silent fallback** distorts strategy ranking when rate-limited (`daily_pipeline.py:731-785`).
5. **Backtest engine silently swallows strategy exceptions** at five sites; tuner picks "least broken" params (`backtest/engine.py`).
6. **Portfolio calendar today-P&L understates** when any symbol's quote fetch 5xxs (`portfolio.py:884-905`).
7. **apiFetch returns undefined on 204**, then downstream `.map` throws, bypassing the error boundary (`lib/api.ts:127`).
8. **`as unknown as` type laundering on portfolio summary** lets `"NaN"` slip through into the hero number (`lib/api.ts:660-683`).
9. **`parseFloat(x) || 1` discards legitimate `0` inputs** in position-sizing UI (`PositionSizer.tsx`, `AnalysisPanel.tsx`, `BacktestPanel.tsx`).
10. **Circuit-breaker Discord notification is swallowed** — the one path the operator really needs to know about can fail in silence (`daily_pipeline.py:675-681`).
11. **Banker's `round()` used on money** system-wide (`portfolio.py`, `trade_ledger.py`); 1-cent drift vs. broker.
12. **`SCENARIOS.find(...)!` non-null assertion** crashes if persisted scenario id ever diverges from code (`StressTest.tsx:216`).
13. **`Math.min(...data)` without NaN filter** silently blanks sparklines (`Sparkline.tsx`, `PortfolioHero.tsx`, `EquityPanel.tsx`).
14. **`/ 86400000` day-diff ignores DST**, bucketing journal entries to wrong weekday twice a year (`TradePanel.tsx:1036`).
15. **`getOrders(...).catch(() => [])` masks 5xx as empty** on the main dashboard — user believes there are no open orders (`(dashboard)/page.tsx:146-147`).
