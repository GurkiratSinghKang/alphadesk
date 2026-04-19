# Persona 2 — Retail Quant Evaluating the 12 Strategies

Auditor: skeptical retail quant. Journey walked `/strategies/{id}` for all 20 rail
entries, cross-ref'd `backend/strategies/*/spec.md`, `backend/data/oos/*.json`,
`frontend/src/lib/strategies.ts`, and
`frontend/src/app/(dashboard)/strategies/[id]/page.tsx`.

Login confirmed (admin, 6c9d…). Toggle endpoint confirmed working (flipped
`momentum-quality` active→paused→active→paused→active in the admin session;
HTTP 200 every hit, payloads symmetric).

API registered 20 strategies. `STRATEGY_META` lists 20 (exact match). Backend
Python packages exist for only 12 (`dual_momentum`, `earnings_vol`,
`kama_breakout`, `momentum_quality`, `orb`, `pairs_trading`, `pead`,
`regime_adaptive`, `rsi2_reversal`, `ts_momentum`, `vrp_harvest`, `vwap`). The
other 8 are registry-only placeholders (claude-alpha, dividend-capture,
gap-fill, manual-discretionary, mean-reversion, pairs-stat-arb, sector-rotation,
vcp-breakout) — no `spec.md`, no `strategy.py`.

---

## [P0] Hero metric plate silently shows wrong numbers on every strategy

**What I observed:** `/api/v1/strategies/momentum-quality/performance` returns
```
sharpe_ratio: 2.2087   max_drawdown: 0.0801   annualized_return_pct: 0.0
cagr: 0.362            hit_rate: 0.7754       total_return_pct: 0.0
```
The hero plate in `page.tsx:340–367` reads `perf.annualized_return_pct` for
the CAGR cell and `perf.max_drawdown` with the `negPct` formatter. Two separate
bugs fall out:

1. **CAGR card is always wrong.** It reads the live-since-inception
   `annualized_return_pct` (always `0.0` because no live trades on any back-
   tested strategy) instead of `cagr`, which is the real OOS CAGR the researcher
   came to see. Momentum-quality's 36.2% OOS CAGR renders as `+0.00%`.
2. **MaxDD card is off by 100×.** Backend returns a decimal (`0.0801` ≙
   8.01%). `negPct(0.0801)` produces `"-0.1%"`. Every MaxDD on every strategy
   is divided by 100. ORB's `-0.0045` renders as `-0.0%` instead of `-0.45%`.

**What design doc expects:** `qa/pages/strategies-detail.md` §"Structure" item 2
— *"OOS SHARPE (mono display, neutral tone), MAX DD (negative percent, loss
tone), CAGR (signed percent, profit or loss tone based on sign), HIT RATE"*.
The CAGR cell is explicitly meant to surface the OOS number, not live P&L.

**Fix suggestion:** In `page.tsx:352–360`:
- Change CAGR source from `perf?.annualized_return_pct` to `perf?.cagr`, multiply
  by 100 before formatting (backend returns decimal), or add a one-line
  defensive accessor.
- Change MaxDD source from `perf?.max_drawdown` to `perf?.max_drawdown != null
  ? perf.max_drawdown * 100 : null`, and simplify `negPct` to assume the value
  is already a percent number.

This is P0: a researcher whose 36.2% CAGR looks like 0% will close the tab.

---

## [P0] Hit Rate hero cell is always em-dash even though backend publishes it

**What I observed:** `deriveHitRate(trades)` (page.tsx:199–206) computes wins /
closed from `getStrategyTrades`. That hits
`/api/v1/trades/history?strategy={id}` which works but mostly returns `[]`
because nothing has traded live. Meanwhile the `/performance` payload exposes
`hit_rate: 0.7754` for momentum-quality (the OOS hit rate). The UI ignores it.

**What design doc expects:** `qa/pages/strategies-detail.md` `### Structure` item
2 — *"HIT RATE (computed from trades: wins / closed, 0 dp percent)"*. Design
doc assumes live trades exist. In reality every strategy that's OOS-backtested
but not live is stuck on em-dash.

**Fix suggestion:** Fall back to `perf.hit_rate * 100` when `deriveHitRate`
returns null. This is a one-line change next to the CAGR card fix.

---

## [P0] No `/strategies` listing page — linking is impossible

**What I observed:** `curl /strategies` → HTTP 404 (the AlphaDesk generic 404
page is served). The rail in the dashboard is the only entry point. There is
no overview/comparison page to browse all 20 strategies. The `/strategies/`
directory only contains `[id]/`.

**What design doc expects:** Task #9 of the audit brief asks this explicitly.
Design doc itself doesn't cover a list page, but a researcher naturally
searches for one (`tradingalpha.net/strategies`). Hitting 404 at the predictable
root URL is a red flag.

**Fix suggestion:** Add `frontend/src/app/(dashboard)/strategies/page.tsx` that
renders `STRATEGY_META` grouped by `group` (fundamental / technical / other)
with hero cells pulled from a bulk `/api/v1/strategies/` call. The data is
already there.

---

## [P0] Every "No OOS data" strategy is marketed as ACTIVE but does nothing

**What I observed:** 8 strategies (claude-alpha, dividend-capture, gap-fill,
manual-discretionary, mean-reversion, pairs-stat-arb, sector-rotation,
vcp-breakout) have no backend Python package, no OOS run, no `spec.md`.
`/performance` returns `sharpe_ratio: null, max_drawdown: null, cagr: null,
hit_rate: null` yet `status: "active"`. The rail therefore shows 17 active
strategies when in reality only 11 are backed by real code.

**What design doc expects:** `strategies-detail.md` §"Expected states" — *"No
STRATEGY_CONTENT for id: § 01 Signal and § 05 Limitations omitted"*, *"No
academic sources: § 04 References omitted"*. The doc assumes stubs collapse
gracefully; it does NOT address a strategy being registered as `active` with no
implementation.

**Fix suggestion:** (a) Add a `status: "stub"` or `"coming_soon"` and a `SectionRule`
"Not yet deployed" banner on stub-id pages. (b) Surface this in the rail badge
so a skeptical user doesn't see 17/20 "ACTIVE" when the real ratio is 11/20.
(c) Move the stubs to `status: "backtest"` until they have a Python module.

---

## [P0] ORB OOS Sharpe is 8.34 and nothing flags it as implausible

**What I observed:** `/api/v1/strategies/orb/performance` → `sharpe_ratio:
8.3369, cagr: 0.5979, max_drawdown: -0.0045, profit_factor: 22.25`. This
matches `backend/data/oos/phase1-orb-oos.json` exactly — the number is real.
But `backend/strategies/orb/spec.md` line 6 says *"Target Sharpe (OOS
2023-2024): 0.70"*. The achieved number is 12× the stated target. Profit factor
of 22 and a 0.45% MaxDD over a 2-year backtest on leveraged ETFs is the
textbook "overfitted to the test set, no chance this repeats" result.

**What design doc expects:** `strategies-detail.md` §"What must NOT happen" —
*"No fabricated Sharpe / CAGR"*. The spec doesn't prohibit real-but-overfit
numbers, but a serious quant product needs a caveat.

**Fix suggestion:** On any strategy where the OOS Sharpe is > 2× the documented
target, render an orange banner in the hero: *"OOS Sharpe 8.34 is ~12× the
0.70 design target. Likely tuned-to-sample; expect material mean-reversion in
live."* Alternatively surface the tuner's fold variance — most OOS files do
not include per-fold metrics, which itself is a credibility issue.

---

## [P1] § 01 Signal missing on ORB and RSI-2 Reversal

**What I observed:** `STRATEGY_CONTENT` keys against the API id set:
missing entries for `orb` and `rsi2-reversal`. `page.tsx:484` silently omits
§ 01 Signal when `content` is null. On `/strategies/orb` the thesis /
edge / mechanics section never appears, even though the researcher is on the
highest-Sharpe-claimed strategy in the book.

**What design doc expects:** `strategies-detail.md` §"Expected states" — *"No
STRATEGY_CONTENT for id: § 01 Signal and § 05 Limitations omitted"* — this is
technically compliant, but for two flagship strategies the omission is the
difference between "looks unfinished" and "looks credible".

**Fix suggestion:** Populate `STRATEGY_CONTENT["orb"]` and
`STRATEGY_CONTENT["rsi2-reversal"]` from the existing `spec.md` files (both
are fully documented in the backend). Short 3-paragraph thesis + 5-step
mechanics is enough.

---

## [P1] Breadcrumb falls back to raw slug on unknown ids

**What I observed:** `curl -o /dev/null -w "%{http_code}" /strategies/bogus-slug-fake-id`
→ 200 (frontend happily renders). `page.tsx:269–272` falls back to `{name:
strategyId, shortName: strategyId, group: "other"}`, so the breadcrumb reads
"Dashboard / bogus-slug-fake-id". The API returns 404 on the performance call,
so the hero collapses into the `allEmpty` italic-serif fallback.

**What design doc expects:** §"Edge cases" — *"Unknown slug: STRATEGY_META[id]
falls back … page renders with the slug as the name. No 404. Known:
inconsistent with routing intuition."* — admitted but unmitigated.

**Fix suggestion:** If `STRATEGY_META[strategyId]` is undefined AND
`getStrategyPerformance` throws 404, render a proper "Strategy not found" page
instead of the fallback. Minimum effort: one conditional in `page.tsx`.

---

## [P1] Pause/Resume is admin-only but the endpoint response doesn't tell you

**What I observed:** `POST /api/v1/strategies/momentum-quality/toggle` works
when logged in as admin (three consecutive flips observed, each returned
`previous_status` + `new_status` correctly). The handler in page.tsx:320–323
has an empty catch — on 403 (non-admin) the button will silently re-enable
and appear to do nothing. The admin role check on `risk-monitor` is wired
(`/admin/risk-monitor` returns `enabled: true` for admin, presumably 403 for
non-admin — untested here for lack of a non-admin session).

**What design doc expects:** §"Pause/Resume error handling" — *"On failure, the
catch block is empty (swallowed). Verify no stale UI (button should re-enable
via finally)."* — the finally works; the user feedback does not.

**Fix suggestion:** Catch the error, surface a toast ("Permission denied" or
"Toggle failed"). Don't swallow. Minimal UI work.

---

## [P1] Manual-discretionary reports `total_return_pct = annualized_return_pct`

**What I observed:** `/api/v1/strategies/manual-discretionary/performance`:
`total_return_pct: 2.6, annualized_return_pct: 2.6`. Those are identical.
The strategy has 65 days of equity curve — annualized return should be
roughly `(1.026)^(365/65)-1 ≈ 15%`, not 2.6%. Looks like the backend is
mis-computing annualized for the manual book, or (more likely) just echoing
total return under both keys.

**What design doc expects:** `strategies-detail.md` §"Structure" item 5 calls
the summary row `TOTAL RETURN / CURRENT VALUE / INVESTED / ACTIVE POSITIONS` —
so the CAGR hero cell should not show the un-annualized number even if the
backend is lazy. (Compounded with the earlier bug, today CAGR shows `+2.60%`
instead of `+0.00%` for this one strategy, but for the wrong reason.)

**Fix suggestion:** Either compute CAGR server-side from the equity curve, or
label it `TOTAL RETURN` in the hero and stop calling it CAGR on a 65-day
sample.

---

## [P2] `pairs-stat-arb` vs `pairs-trading` — two slugs, one strategy, one backend

**What I observed:** Both slugs exist in `STRATEGY_META`, both have separate
`STRATEGY_CONTENT` entries, both have separate `ACADEMIC_SOURCES` (overlapping
citations). But only one backend package exists (`pairs_trading`). The API
returns `pairs-trading` with real OOS numbers (sharpe 1.23) and
`pairs-stat-arb` with all-null OOS numbers. Rail shows both, hero plate on
`pairs-stat-arb` is all em-dashes, on `pairs-trading` it's (incorrectly) all
em-dashes + `0.00%` for the bug reasons above.

**What design doc expects:** No guidance; this is a bookkeeping duplication.

**Fix suggestion:** Delete one of them — probably `pairs-stat-arb` since
`pairs-trading` is the one with backend data. One less line of noise on
the rail.

---

## [P2] `earnings-vol-premium` is labeled PAUSED but exposes full OOS metrics

**What I observed:** API returns `status: "paused"` yet `sharpe_ratio: 1.4336,
max_drawdown: 0.019, hit_rate: 0.55`. The RegimePill in the hero correctly
shows "PAUSED" (neutral/elevated). The user sees real numbers and "paused" —
not explained.

**What design doc expects:** Paused = RegimePill neutral/elevated + "PAUSED"
label. Correct.

**Fix suggestion:** Add a one-line italic-serif sub-text in the paused state:
*"Paused pending Q2 2026 review"* (pull reason from backend when available).
`gap-fill` has the same issue but its STRATEGY_CONTENT thesis already explains
*"The strategy is currently paused as it requires a more sophisticated
catalyst-screening layer"*. Good model — copy this pattern to others.

---

## [P2] `/api/v1/strategies/{id}/trades` returns 404 (route doesn't exist)

**What I observed:** Direct probe of `/strategies/{id}/trades` returns 404 on
every id. The frontend routes through `/api/v1/trades/history?strategy=${id}`
(in `api.ts:190`). The design doc says the API should live under `/strategies/{id}/trades`.

**What design doc expects:** Not explicitly prescribed, but the endpoint
structure `/strategies/{id}/performance` + `/strategies/{id}/positions` +
`/strategies/{id}/trades` is intuitive and was the audit brief's assumption.

**Fix suggestion:** Either add the `/strategies/{id}/trades` route as an
alias, or document the existing `/trades/history?strategy=` path. Not a user
bug — the UI works via the query-param route — but an inconsistency for
anyone reading the API.

---

## [P2] Academic citations — spot-check real, but one redundancy

**What I observed:** Spot-checked 5 citations against public sources:
- Jegadeesh & Titman 1993 — real, JoF 48(1). ✓
- Piotroski 2000 — real, JAR 38. ✓
- Moskowitz, Ooi & Pedersen 2012 — real, JFE 104(2). ✓
- Zarattini & Aziz 2023 (arXiv:2302.13811) — real paper. ✓
- Asness, Frazzini & Pedersen 2019 "Quality Minus Junk" — real, RAS 24. ✓
- Connors & Alvarez 2009 — real trade book. ✓ (it is a trading-books
  publisher, not peer-reviewed, which is the nature of Connors RSI)
- Gatev, Goetzmann & Rouwenhorst 2006 — real, RFS 19(3). ✓

No fabricated or misattributed citations found in the spot check. The
`pairs-trading` and `pairs-stat-arb` reference lists overlap by 4/4
citations — redundant (see P2 above).

**What design doc expects:** §"What must NOT happen" — *"Academic references
must be real citations; no Lorem Ipsum"*. Compliant.

**Fix suggestion:** None required for the citations themselves; fix the
duplicate slug issue and the redundancy disappears.

---

## [P2] Equity curve: PEAD and manual-discretionary look plausible; everything else is empty

**What I observed:** Only `pead` (65 days) and `manual-discretionary` (65
days) return non-empty `equity_curve`. PEAD ranges 4452–4902 across 65 days on
a starting invested of 4895.12 — plausible, with realistic zigzag (64 unique
daily deltas, not a stair-step or linear fake). Manual-discretionary ranges
57114–62551 — again plausible for a ~$57k portfolio. Every other strategy
returns `equity_curve: []` and the § 02 Performance panel falls back to the
italic-serif empty-state block. That's the design, so compliant. But 18 of 20
strategies with no equity curve means the page is 80% empty after the hero.

**What design doc expects:** §"Expected states" — *"Performance returns empty
equity_curve: EquityPanel shows empty state"* — matches.

**Fix suggestion:** For the 12 strategies with OOS JSONs, render the OOS
equity curve from `backend/data/oos/*.json` on the § 02 panel with a caption
"OOS backtest 2023–2024". This converts an empty product into a convincing
one in a single afternoon.

---

# Persona summary — 500 words

The AlphaDesk strategy-detail page is close to shippable but fails at the
single moment that matters: the hero metric plate. A researcher opens
`/strategies/momentum-quality` expecting the OOS Sharpe 2.21, CAGR 36%, MaxDD
8%, Hit Rate 77.5% that the backend OOS JSON and `/performance` endpoint
correctly publish. What they see is **Sharpe 2.21 (correct)**, **CAGR +0.00%**
(the UI reads the live `annualized_return_pct` field, which is 0 everywhere
because nothing has traded live yet), **MaxDD -0.1%** (the formatter treats
the backend's decimal `0.0801` as an integer percent, so `negPct` produces
`-0.1%` instead of `-8.0%`), and **Hit Rate —** (the computation reads the
empty live trades list instead of falling back to `perf.hit_rate`). Three of
four hero cells are wrong. A skeptical retail quant closes the tab.

The ORB page independently undermines the app. The tuner produced a 2023–24
OOS Sharpe of 8.34 against a stated target of 0.70 (`orb/spec.md`), a CAGR of
60% on leveraged ETFs, and a 0.45% max drawdown. These numbers are real in
the sense that the OOS JSON genuinely contains them — but they are the
textbook overfit-to-test-set result. Nothing on the page warns the user.
This is the **single biggest trust-killer** in the entire strategies
experience: a too-good-to-be-true number rendered without a caveat reads like
a retail SaaS trading-bot scam. `orb` also has no `STRATEGY_CONTENT` entry,
so § 01 Signal silently omits and the page reads as a bare hero over an
empty equity panel.

Eight of the 20 rail strategies (`claude-alpha`, `dividend-capture`,
`gap-fill`, `manual-discretionary` is real trades, `mean-reversion`,
`pairs-stat-arb`, `sector-rotation`, `vcp-breakout`) have no backend
implementation at all — no Python package, no `spec.md`, no OOS data — but
are registered as `status: "active"` with non-null sparkline ranges of zero.
A serious user reading the rail counts 17 of 20 ACTIVE; reality is 11. The
design treats missing `STRATEGY_CONTENT` as a graceful omission but has no
treatment for a registered-but-unimplemented strategy. Add a "Not yet
deployed" state.

The `/strategies` root URL returns the generic 404 page — there is no
overview / comparison screen. Unknown slugs fall back to the raw string
("Dashboard / bogus-slug-fake-id") because the page renders with the fallback
meta. The Pause/Resume toggle works (three flips confirmed, 200 each) but
the empty catch block swallows any failure, so a non-admin user clicking it
would see the button re-enable with no state change. `pairs-trading` and
`pairs-stat-arb` are two slugs for one strategy.

Four things that would save the page: (1) fix the two number-formatting bugs
in `page.tsx` — one-hour work, raises every hero plate from 25% accurate to
100%; (2) add a "OOS Sharpe vs target" caveat banner for ORB and any other
tuned-to-sample strategy; (3) populate `STRATEGY_CONTENT` for `orb` and
`rsi2-reversal` from their existing `spec.md`; (4) render the OOS equity
curve for all 12 strategies with JSONs, labeled "OOS backtest 2023-2024",
on the § 02 panel. The content is there — the wiring is not.
