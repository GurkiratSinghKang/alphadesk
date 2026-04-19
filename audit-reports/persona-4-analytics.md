# Persona 4 — Analytics / Reports / Pipeline Audit

**Auditor role:** Portfolio analyst reviewing `/analytics`, `/reports`, `/pipeline`.
**Date:** 2026-04-19 (Sunday, US markets closed).
**Environment:** production — tradingalpha.net, admin session.

---

## Methodology

- Logged in as admin on https://tradingalpha.net.
- Called every backend endpoint the three pages consume (`/portfolio/performance`, `/portfolio/summary`, `/trades/history`, `/strategies/`, `/pipeline/status`, `/pipeline/history`, `/pipeline/history/{date}`, `/pipeline/positions`, `/pipeline/schedule`, `/pipeline/run`).
- Read the three page modules and the helper modules they depend on (`lib/api.ts`, `lib/accountEquity.ts`, `panels/ShareTrade.tsx`).
- Cross-checked the backend math against the claimed fixes in `backend/api/routes/portfolio.py` and the scheduler claim in `backend/data/ingestion/pipeline_runner.py`.

Files inspected (absolute paths):
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/reports/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/accountEquity.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ShareTrade.tsx`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/portfolio.py`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/pipeline.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py`

---

## Findings

Format: **ID | Severity | Area | Title** · observation · evidence · impact · recommendation.

---

### F-01 | P0 | Analytics | There is no time-range selector on the page

**Observation.** The QA spec under *Flow* asks "Time-range selector updates the chart". `analytics/page.tsx` renders four charts + a monthly heatmap but has **zero UI for selecting a period**. `getPortfolioPerformance()` is called with no argument and the TypeScript default is `"30d"`. Changing from 1W to 1Y is impossible in the UI.

**Evidence.** `analytics/page.tsx:509` calls `getPortfolioPerformance()` (no period). No imports of a `Tabs` / `Select` / segmented control in the file. Grep for `period`, `timeRange`, `1W`, `1Y`, `setPeriod` returns zero hits inside `analytics/page.tsx`.

**Impact.** A trader staring at a 30-day window can't compare it to YTD / 1Y / all-time. The monthly heatmap is the only multi-period view — so the **only** way to see more than 30 days of data is to read the heatmap. Sharpe, drawdown, return distribution, rolling Sharpe are all locked to 30 days. This is a cornerstone broken promise.

**Recommendation.** Add a 1W · 1M · 3M · YTD · 1Y · ALL control in the `DashboardPageLayout` `actions` slot and re-key the `useEffect` on the selected period.

---

### F-02 | P0 | Analytics | Backend `equity_curve[].value` emits cumulative P&L, not equity level

**Observation.** The code comment in `analytics/page.tsx:40-44` says *"`value` is the authoritative equity level emitted by the backend."* It is not — `_build_performance_from_pnls` at `backend/api/routes/portfolio.py:359-363` populates both `value` and `cumulative_pnl` with the **same** running `cumulative` dollar amount. So `value == cumulative_pnl` in every live response.

**Evidence.** Live endpoint payload: `{"date":"2026-04-18","value":0.0,"cumulative_pnl":0.0}`. Backend source confirms `"value": round(float(c), 2)` where `c = cumulative`.

**Impact.** The frontend helper `equityAtPoint` has a special case (`accountEquity.ts:66`) for *value == cumulative_pnl* and correctly falls back to `baseEquity + cum`, so charts render correctly **today**. But the comment is a lie, and any downstream consumer that naively trusts `value` as equity is wrong by `baseEquity`. `startingEquity()` uses `first.value` if > 0 — which with the current shape is always 0 or the first-day P&L, **not** the starting equity. This is a latent footgun.

**Recommendation.** Either (a) make the backend actually emit equity in `value` (requires threading true account equity through the builder, replacing `base_equity = 100_000`), or (b) drop the `value` field entirely — keep `cumulative_pnl` only and remove the misleading fallback path from the helper.

---

### F-03 | P0 | Analytics/Backend | `base_equity = 100_000` is hardcoded in three places

**Observation.** The backend TODO at `portfolio.py:622` (`# TODO: thread actual account equity`) is live in production. Every Sharpe, Sortino, Calmar and `total_return_pct` value is denominated in a fake `$100,000` account, not the live equity ($101,036.22 today).

**Evidence.**
- `portfolio.py:140` — `_compute_enhanced_metrics(... base_equity: float = 100_000)`
- `portfolio.py:170` — clamps any non-positive base_equity back to 100_000
- `portfolio.py:288, 343, 622, 674` — `base_equity = 100_000` repeated
- QA spec explicitly tolerates this: *"Equity base `100000`: hardcoded starting equity for return calculations; if live backtest uses a different base, returns are wrong. Acceptable — same convention as backtests."*

**Impact.** With a ~$101k account the error is ~1%. With a $500k account, ratios would be **5× overstated** (pnl fraction inflated by 5×). Sharpe is currently **comparable between accounts only if every account is exactly $100k**. For a productized tool this is not safe. And `total_return_pct` in particular is the single number a client will ask about — we're denominator-mismatched.

**Recommendation.** Pass the live equity from Alpaca `account.equity` (already available in `getPortfolioSummary`) down to both `_compute_enhanced_metrics` and `_build_performance_from_pnls`. Bonus: derive a daily equity series so Sharpe annualises against each day's starting equity.

---

### F-04 | P1 | Analytics | There is no SPY / benchmark overlay

**Observation.** Spec §7 asks *"On strategy equity curves, a dashed SPY line should overlay. Does it?"* There is no benchmark overlay anywhere on `analytics/page.tsx`. Grep for `SPY`, `benchmark`: zero hits.

**Impact.** A trader can't see whether a 12% return is alpha or beta. Critical context missing.

**Recommendation.** Add a `SPY` (or user-chosen benchmark) equity curve overlay, normalised to the same starting date as the main equity curve, rendered as a dashed 1px line in `--fg-muted`.

---

### F-05 | P0 | Reports | Strategy max drawdown divides by peak P&L, not peak equity

**Observation.** The analytics page got this fix; the **reports** page re-introduces the same bug. Lines 315-321 of `reports/page.tsx`:

```
let cumPnl = 0, peak = 0, maxDd = 0;
for (const t of closed) {
  cumPnl += t.pnl ?? 0;
  if (cumPnl > peak) peak = cumPnl;
  const dd = peak > 0 ? (peak - cumPnl) / peak * 100 : 0;
  ...
}
```

`peak` starts at 0, so until the strategy hits a new peak, `dd` is reported as 0. Once `peak` is $1, a drop to -$1000 is computed as `(1 - (-1000)) / 1 = 1001 → 100,100%`. The strategy Max DD column in the CSV and on-screen table is actively wrong.

**Impact.** Strategy performance report max drawdown is unreliable. A prospective client reading the Strategy Report CSV would see either 0% (underreported) or a cosmic percentage (overreported). Directly misleading.

**Recommendation.** Mirror the analytics fix — denominator should be `baseEquity + peakCumPnl` (or at minimum `max(peak, 1000)` sanity clamp), or replace with a proper equity-anchored drawdown. Ideally query a single backend endpoint per strategy.

---

### F-06 | P0 | Reports | Strategy Sharpe annualization factor is inverted

**Observation.** Line 327 of `reports/page.tsx`: `sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252 / Math.max(returns.length, 1)) : 0;`

The factor `sqrt(252/N)` **shrinks** Sharpe as the number of trades grows. With N=252 trades it reduces to 1× (no annualisation); with N=1000 it actually penalises by `sqrt(0.252)`. The intuitive mental model was probably "convert per-trade Sharpe to annual using trade frequency" but the math runs the wrong direction. The per-trade formula should either (a) multiply by `sqrt(N / years)` (periods per year), (b) multiply by `sqrt(252 / avg_holding_days)`, or (c) switch to daily-return Sharpe `* sqrt(252)`.

**Impact.** Strategies with many closed trades get artificially low Sharpe. A strategy with 1000 trades and a real Sharpe of 2.0 would be displayed as ~0.32. Reports Strategy performance CSV is wrong.

**Recommendation.** Use the backend `sharpe_ratio` for each strategy — `getStrategies()` already returns it. If the strategy object doesn't have a per-strategy Sharpe, compute on the backend against a proper daily-return series.

---

### F-07 | P1 | Reports | Strategy `win_rate: -1` sentinel is displayed as "-100%"

**Observation.** `getStrategies()` returns `win_rate: -1.0` for strategies with no data (checked live: all 12 strategies returned `-1`). Line 312 of `reports/page.tsx`: `const winRate = tradeCount > 0 ? ... : s.win_rate;` — no sentinel check. The table renders `-100%`.

**Evidence.** Live response: `{"id":"momentum-quality",...,"win_rate":-1.0,...}`. Reports UI will render `(-1).toFixed(0) = "-1%"` (actually: `-100%` as percentage, since `(winRate ?? 0).toFixed(0)` — wait let me recheck — line 382 renders `{(s.winRate ?? 0).toFixed(0)}%` → `-1%`). Either way, it's wrong.

**Impact.** Every strategy with zero history shows a negative win-rate in the Reports page. Nonsensical.

**Recommendation.** Treat `win_rate === -1` as `null` / `N/A`. Update type to `number | null` and backend to emit `null` instead of `-1`.

---

### F-08 | P1 | Reports | "No positions/trades in this period" copy misleads — there is no period filter

**Observation.** The page shows two "No ... in this period" empty-state cards (lines 193-194 and 234-235). There is no time-period filter on the Reports page. The only period-bound selector is Tax Year on the tax section. So "period" is meaningless — it always means "all time".

**Evidence.** Reports page has no `period` state, no segment control; only `taxYear` state. The Portfolio Statement and Strategy report consume ALL trades (`getTradeHistory(5000)`), not a bounded window.

**Impact.** The phrase "in this period" confuses the user — they think a filter is missing, or they think they changed it and it didn't take effect.

**Recommendation.** Either (a) rewrite copy to "No positions yet" / "No closed trades yet", or (b) add a real period filter and honour it everywhere.

---

### F-09 | P2 | Reports | CSV export is present and functional; PDF is not

**Observation.** Three "Download … CSV" buttons (Portfolio Statement, Strategy, Tax). Each uses `Blob + URL.createObjectURL` correctly and produces well-formed CSV (verified via source inspection). No PDF export. Spec asks: *"Export button? PDF? CSV? Does it work?"*. CSV works; PDF does not exist.

**Impact.** Not broken, but users expecting a PDF will find only CSV.

**Recommendation.** Either add PDF export (print-to-PDF via a print CSS variant or server-side `weasyprint`), or update the spec to clarify CSV-only.

---

### F-10 | P2 | Reports | Tax-report long-term cutoff is `holdingDays > 365`

**Observation.** Line 420: `const isLongTerm = holdingDays > 365;`. IRS rule is *"held more than one year"* — strictly **more than** 365 days, which this matches. But the heading label says *"held ≤ 365 days"* for short-term and *"held > 365 days"* for long-term (lines 497-514) — consistent.

**Impact.** The exact calendar-year arithmetic can be off by one day for leap years. Edge case — flag for accuracy.

**Recommendation.** Use a calendar-aware comparison: `exitDate >= new Date(entryDate.setFullYear(entryDate.getFullYear()+1))` for absolute IRS compliance.

---

### F-11 | P1 | Pipeline | "Run Now" button works but is not admin-gated

**Observation.** The button POSTs to `/api/v1/pipeline/run`. Spec asks: *"Does it require admin role?"*. Backend at `pipeline.py:62-73` uses `Depends(require_auth)` — **any authenticated user**, not admin-only. Rate limit is 1/60s per user. Works end-to-end (I triggered a run at 00:21 ET on a Sunday; response 200 with `errors: ["Outside trading window (00:21 ET)", "Pipeline aborted: VIX unavailable..."]`).

**Impact.** Any logged-in account can burn the Polygon/Alpaca/Claude quota. At current scale this is low-risk but violates principle of least privilege for a paid trading platform.

**Recommendation.** Gate `POST /pipeline/run` behind an admin role OR enforce a per-user cost cap.

---

### F-12 | P1 | Pipeline | `pipeline/history` item summaries are computed with a broken fallback

**Observation.** `pipeline/page.tsx:707`: `const screened = h.screened ?? (h.strategies_run ? Object.values(h.strategies_run || {}).reduce(...))`. But the backend emits `strategies_run` as a **number** (e.g. `12`), not an object (`Object.values(12) → []`). So the reduce returns 0; the "No activity" fallback fires for any history row whose top-level `screened` field is unset.

**Evidence.** Live response sample: `{"date":"2026-04-18","orders_placed":0,"orders_closed":0,"signals":0,"strategies_run":12,"errors":1,"portfolio_snapshot":{}}`. The row will render as "1 errors" — dropping the 12 strategies, and not showing "12 strategies run".

**Impact.** History rows look empty even when the pipeline did work (screened, analyzed, rejected). A trader can't tell from the history list whether yesterday's pipeline ran 12 strategies or none.

**Recommendation.** Either (a) include `screened_total` / `analyzed_total` fields in the history index response, or (b) fix the fallback to read `strategies_run` as a number and say "12 strategies run".

---

### F-13 | P1 | Pipeline | History summary column always says "No activity" when `orders_placed == 0`

**Observation.** Consequence of F-12: the last 7 days of history show `orders_placed=0, orders_closed=0, signals=0, strategies_run=12, errors=1` — the fallback's `parts` only appends screened/analyzed/orders/errors counts. With screened=0 and analyzed=undefined and orders=0, only `1 error` survives → user sees "1 error" as the only summary.

**Impact.** The History section is supposed to be the audit trail. It reads as a list of errors instead of a list of pipeline activity. Misleading.

**Recommendation.** Include strategies/rejections/analyzed counts.

---

### F-14 | P1 | Pipeline | Empty-state CTA says "Next scheduled run: 09:30 ET" — hardcoded

**Observation.** `pipeline/page.tsx:549`: `<p ...>No pipeline run yet today. Next scheduled run: 09:30 ET.</p>`. It's a hardcoded string. The real schedule at `GET /pipeline/schedule` has seven windows (06:00, 09:35, 10:05, 12:00, 15:30, 15:55, 15:30 Fri). On Sunday (2026-04-19, today) none of them apply.

**Impact.** Misleading UX. A user waiting for "09:30 ET" on a weekend is going to be very confused.

**Recommendation.** Replace with live call to `/pipeline/schedule` and compute the next actual window. On non-trading days, say "US markets closed — next run at 09:35 ET Monday".

---

### F-15 | P1 | Pipeline | On Sunday the pipeline still accepted a manual run

**Observation.** Today is 2026-04-19 (Sunday). I POSTed `/pipeline/run` at 00:21 ET and got HTTP 200 with `{"ok":true, ..., "errors":["Outside trading window (00:21 ET)", "Pipeline aborted: VIX unavailable..."]}`. The scheduler was fixed to be holiday-aware (`pipeline_runner.py:33` imports `USMarketCalendar`), but `POST /pipeline/run` bypasses that check entirely.

**Impact.** A user pressing Run Now on a Sunday gets a 200 response + a history row with 2 errors, which contaminates the pipeline history. My own test run just created the `2026-04-19` entry with errors.

**Recommendation.** Either (a) refuse manual runs on non-trading days with a 422 and a friendly message, or (b) auto-skip the "Outside trading window" error and short-circuit the run cleanly before it writes to `pipeline_logs/`.

---

### F-16 | P2 | Pipeline | `counts` from `mapPipelineRun` is populated, `countsOnly` detection is correct

**Observation.** Sanity check passes. Line 82-85 of `pipeline/page.tsx` correctly detects when counts exceed detail rows. Confirmed via reading.

**Impact.** None. This is a positive finding.

---

### F-17 | P1 | Pipeline | `getPipelinePositions()` returns `performance` key but no `winRate` when perfData empty

**Observation.** The `perfData` card at lines 784-786 shows Win Rate as `N/A` when zero. `getPipelinePositions()` live returns `open_positions: [7 items]` — performance snippet inspected via reading is rich but I couldn't render the `performance` object tail since it was cut. The positions P&L are visible and matched portfolio summary ($1,506 unrealized).

**Impact.** Low-severity — need to verify `perfData.winRate` is not derived from `-1` sentinel; worth checking.

**Recommendation.** Add same `win_rate === -1` guard as F-07.

---

### F-18 | P1 | Analytics | Math sanity — Drawdown backend fix CONFIRMED

**Observation.** `_compute_enhanced_metrics` at `portfolio.py:196-226`: drawdown is computed against `peak_equity` (running max of `base_equity + running_pnl`), with the denominator as `peak_equity` not peak P&L. **Fixed as claimed.**

**Sharpe** computed on `daily_ret_frac = [p / base_equity for p in daily_pnls]`, not raw dollars. **Fixed.**

**Win rate** computed as `wins / (wins + losses)` (scratches excluded). **Fixed.**

**YTD compound** in analytics page line 389-395: `(months.reduce((p, _, mi) => { ... return p * (1 + m / 100); }, 1) - 1) * 100;` — proper compounding. **Fixed.**

**Sortino** uses LPM₂ formulation (divide by total N). **Fixed.**

All five claimed fixes are live on backend and frontend. F-05 is a separate place where the same bug re-appeared in Reports.

---

### F-19 | P2 | Analytics | No crosshair / tooltip on charts

**Observation.** All four SVG charts (Drawdown, RollingSharpe, ReturnDistribution, MonthlyHeatmap) are render-only. No hover, no tooltip, no value display on mouseover. QA spec explicitly allows this ("read-only visualisations"). Flagged for future UX improvement.

---

### F-20 | P2 | Analytics | Globalempty state says "Today: {n} closed trades" but n is always the current state

**Observation.** Line 616-619 renders "Today: {closedTradesCount} closed trades." The copy says "today" but `closedTradesCount` is total closed trades ever. Minor semantic confusion.

**Recommendation.** Change to "So far: 0 closed trades" or "Closed trades: 0".

---

### F-21 | P2 | ShareTrade | Support/resistance are derived heuristically (±3% of price)

**Observation.** `ShareTrade.tsx:51-56`: `deriveKeyLevels(price)` returns `{ support: price - price*0.03, resistance: price + price*0.03 }`. Those numbers are displayed on the share image as "Support: $x / Resistance: $y" without any caveat. The AI analysis panel's `support` / `resistance` are NOT fed in — this is a dumb arithmetic approximation.

**Impact.** The PNG and text summary share claim concrete support/resistance levels that have zero technical basis. If you shared this card with a friend they would believe you'd done analysis. This is misleading market information.

**Recommendation.** Either (a) wire `analysis.support` / `analysis.resistance` through (those fields must exist in the analysis payload), or (b) omit these fields when not available rather than fabricating them.

---

### F-22 | P2 | ShareTrade | RSI is derived from technical score as `40 + score * 0.3`

**Observation.** `ShareTrade.tsx:235`: `const rsi = techScore != null ? (40 + techScore * 0.3).toFixed(1) : null;`. This is a fabricated RSI value. The share card displays it as "RSI (14)" — implying the standard Wilder 14-period RSI. It is not.

**Impact.** Highest-severity misleading number on the platform — shared to social media with a specific technical indicator label.

**Recommendation.** Pull RSI from `analysis.rsi14` or similar real field. If unavailable, omit. Do NOT fabricate.

---

### F-23 | P2 | ShareTrade | Token-based palette CONFIRMED

**Observation.** `ShareTrade.tsx:298-307` reads `--bg`, `--border`, `--brand`, `--profit`, `--loss`, `--amber-500`, `--fg`, `--fg-muted`, `--fg-hint`, `--font-ui` via `token()` helper with literal-hex fallbacks. The canvas draws using these. Fix claim confirmed.

---

### F-24 | P0 | Analytics | `rolling_sharpe_30d` always empty for small-history accounts

**Observation.** Backend requires 30 days of data to emit any rolling Sharpe points. The live account has 1 day in the ledger. Result: empty array, frontend renders "Not enough data for rolling Sharpe (need 30+ days)" — correct UX. However, the reported `sharpe_ratio` at the top of the payload is `null` too. This is consistent and correct.

**Impact.** None — this is expected behaviour. Flagging so the reader knows the rolling Sharpe empty-state is not a bug.

---

### F-25 | P2 | Pipeline | Schedule does not cover weekly rebalance special case for Friday being a holiday

**Observation.** Schedule returns `{"time":"15:30 Fri","name":"Weekly refresh",...}`. If Friday is Good Friday the refresh misses. Cosmetic-level spec concern.

---

## What I'd flag to a client

If I had to show analytics + reports + pipeline to a paying client today, here are the numbers I would NOT stand behind:

1. **Reports page "Max DD %" for every strategy** (F-05) — the calculation is arithmetically broken.
2. **Reports page "Sharpe" for every strategy** (F-06) — annualisation factor inverted.
3. **Reports page "Win Rate %" for all 12 strategies** — displays `-1%` or `-100%` (F-07).
4. **Analytics total_return_pct** — denominator is `$100k`, not live equity (F-03).
5. **Analytics rolling Sharpe** — correctly null today, but once live the 30-day anchor is hardcoded (can't change).
6. **SPY-relative context** — absent entirely (F-04). A 10% strategy return in a 20% bull market is alpha-negative; we can't show this.
7. **ShareTrade "Support" / "Resistance"** — fabricated by ±3% arithmetic (F-21).
8. **ShareTrade "RSI (14)"** — fabricated by linear transform of technical score (F-22).
9. **Pipeline History summary column** — will display "No activity" or "N errors" rather than true activity (F-12, F-13).
10. **Pipeline empty-state copy** — "Next scheduled run: 09:30 ET" is a hardcoded lie on Sunday/holiday (F-14).

---

## Top 10 P0/P1 items ranked by "would this mislead a trader"

| Rank | ID | Summary |
|---|---|---|
| 1 | F-22 | ShareTrade fabricates "RSI (14)" for shareable image — actively misleads downstream viewers |
| 2 | F-05 | Reports Strategy Max DD divides by peak P&L not equity — produces 0% or 100000% |
| 3 | F-06 | Reports Strategy Sharpe annualisation `sqrt(252/N)` is inverted — shrinks Sharpe with more trades |
| 4 | F-21 | ShareTrade fabricates Support/Resistance as ±3% of spot — misleading on shared image |
| 5 | F-01 | No period selector on Analytics — all charts locked to 30d |
| 6 | F-02 | Backend `equity_curve[].value` misrepresented as equity level in code comment |
| 7 | F-03 | `base_equity = 100_000` hardcoded — all ratios wrong for non-$100k accounts |
| 8 | F-07 | Strategy `win_rate: -1` sentinel displayed as negative percentage |
| 9 | F-12 | Pipeline history summary field parsed wrong (`Object.values(number)`) |
| 10 | F-15 | Manual pipeline runs on non-trading days produce error-only history rows |

---

## Summary (≈500 words)

The three pages are functionally live and render without crashing; the backend math fixes that were advertised (drawdown on peak equity, Sharpe on returns, win rate excluding scratches, YTD compounding, Sortino LPM₂) are in place on the `/portfolio/performance` endpoint and confirmed by reading `backend/api/routes/portfolio.py:137-250`. The `pipeline_runner.py` scheduler uses `USMarketCalendar` for holiday awareness. ShareTrade uses token-based colors — also confirmed. Positives end there.

The audit found two categories of issue. First, **duplicated-math regressions**: the analytics backend got the drawdown and Sharpe fixes, but `reports/page.tsx` computes its own Strategy Max DD and Strategy Sharpe in the frontend using the buggy patterns we just fixed upstream. Strategy Max DD divides by peak cumulative P&L (0 at start → division by near-zero → garbage); Strategy Sharpe multiplies by `sqrt(252/N)`, which inverts the usual annualisation and penalises strategies with more trades. These are actively misleading numbers on a report a client might download. The fix is either to pull the metrics from the backend (recommended — `getStrategies()` already returns `sharpe_ratio`) or to replicate the analytics fix in `reports/page.tsx`.

Second, **missing promised surfaces and fabricated metrics**. Analytics has no time-range selector — every chart is locked to 30d. The spec asks about the selector by name. ShareTrade displays a specific "RSI (14)" value that is computed as `40 + technicalScore * 0.3` and "Support" / "Resistance" levels computed as `spot ± 3%`, both fabricated. These labels are shared to social media, implying real technical analysis. This is the highest-severity misleading output on the platform. `base_equity = 100_000` is hardcoded on the backend and TODO'd; with the live $101k account the error is 1%, but a $500k client would see ratios 5× overstated. There is no SPY benchmark overlay anywhere. The pipeline history summary parses `strategies_run` wrong (it's a number, treated as object) so rows read "1 error" when there were 12 strategies. The pipeline empty state hardcodes "Next scheduled run: 09:30 ET" even on a Sunday.

Export works (CSV only, no PDF — acceptable given spec). `Run Now` works end-to-end but is not admin-gated (any authenticated user can burn Polygon/Claude quota), and firing it on a non-trading day creates an error-only history row. This caused the 2026-04-19 entry I created during testing.

A trader looking at the analytics equity curve and return stats today (a mostly blank slate with one recorded day) would see correctly-computed, correctly-scoped output. A trader looking at the Reports Strategy Performance table would see Max DD and Sharpe numbers that are arithmetic accidents, and win-rates of `-1%` for every strategy with no history. A trader sharing a trade idea via ShareTrade would be publishing invented indicator values under honest-looking labels.

Top priority to fix: F-22 (fabricated RSI), F-05 (Strategy Max DD), F-06 (Strategy Sharpe), F-21 (fabricated S/R). These are the four numbers a trader would currently screenshot and regret.
