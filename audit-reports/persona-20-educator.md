# Persona 20 — The Finance Professor Teaching Systematic Trading

**Date:** 2026-04-18
**Environment:** tradingalpha.net (production, live APIs)
**Persona:** tenured quant-finance professor, 24-student graduate seminar, wants to replace
Bloomberg/WRDS seat with a single shared terminal for lectures, office-hours demos, and
graded case studies. Needs sandbox separation, conceptual tooltips, shareable links,
historical replays, and per-student accounts.

AlphaDesk is an exceptionally *literate* terminal for a professor — the strategy detail
pages read like Chapter 4 of a quant-finance textbook, and the prose in
`STRATEGY_CONTENT` (references, risk caveats, academic voice) puts it a tier above
retail-skinned brokerages. But the app was built for a singleton admin researcher. Every
pedagogy-specific affordance — demo reset, tooltips-as-glossary, shareable public
permalinks, cohort identity, historical "what did this look like on Monday" replay —
is missing or privately held. The professor can lecture *from* AlphaDesk fine; she
cannot teach *with* it.

---

## Top 10 findings (~350 words)

1. **No multi-user model. Period.** `backend/api/routes/auth.py:100` pins admin identity
   to `settings.ADMIN_USERNAME` — one string, one password hash
   (`backend/core/config.py:80`). `/auth/me`, `/auth/sessions`, `/user/preferences` all
   404 (persona-8 #6). A 24-student cohort would share one JWT, one
   `tradingMode`, one watchlist, one pause/resume toggle. Anybody can halt the
   live book mid-lecture.

2. **§ 04 References is excellent content but under-surfaced.** `page.tsx:60-153` ships
   5-6 canonical citations per strategy (Jegadeesh-Titman, Bernard-Thomas,
   Carr-Wu, Moskowitz-Ooi-Pedersen). Renders as plain italic lines — no DOI
   link, no "copy BibTeX", no year badge, no anchor. A student can't cite it
   into a paper without retyping.

3. **STRATEGY_CONTENT is a textbook trapped in a Zustand bundle.**
   `strategy-content.ts` is 753 lines of PhD-grade prose — thesis, edge, risk
   profile, parameters, mechanics, when-to-use, known limitations — indexed
   only by strategy slug. There is no glossary index ("where is SUE defined?"),
   no reverse lookup from term to strategy, no print view, no PDF export.

4. **Zero tooltips on metric chips.** `StrategyHero` renders OOS SHARPE / MAX DD /
   CAGR / HIT RATE without a `HelpCircle`, `Tooltip`, `title`, or
   `aria-describedby` (grep of `strategies/[id]`: 1 title, 0 HelpCircle). A
   first-year student reading "OOS SHARPE +8.34" cannot hover to learn what
   "out-of-sample" or "Sharpe" means.

5. **No sandbox. No reset. No demo mode.** `persona-8` #6 added `resetAll()` for
   *preferences* only (`preferences.ts:110`) — it does not reset watchlist,
   trading mode, strategy pause-state, or the live Alpaca book. There is no
   "Teaching Mode" that isolates a student sandbox from the production ledger.

6. **Strategy detail pages are login-walled.** `/strategies/[id]` sits inside
   `(dashboard)` which is auth-gated. A professor cannot share a permalink to
   *"read Jegadeesh-Titman momentum with real OOS equity curve"* with her
   class — they need the admin password first.

7. **No time-travel / replay.** Search for `as.of`, `snapshot`, `point.in.time`,
   `rewind`, `history` across `/frontend/src` returns only unrelated matches.
   The equity panel has range buttons (`1M / 3M / YTD / 1Y / ALL`) but no
   "view as of 2026-03-15" parameter. Teaching the flash crash requires a
   YouTube clip, not a live demo.

8. **Preset scenarios: absent.** No "Feb 2018 volmageddon", "Mar 2020 COVID",
   "Aug 2024 JPY unwind" preset that restores indicator state + positions for
   classroom use. `strategy-content.ts:125` *mentions* these events in prose
   but there is no one-click replay.

9. **Docs page is marketing copy, not pedagogy.** `/docs/_docs/content.ts` is 10
   sections (Getting Started → API Keys). Useful for onboarding, but no
   **glossary** (SUE, drift, beta-neutral, VRP, delta-adjusted, kurtosis), no
   worked-example walkthrough, no "syllabus mode". § 08 "Strategy Methodology"
   is three paragraphs where `strategy-content.ts` has 753 lines of better
   material.

10. **Pause/resume is shared and destructive.** `strategies/[id]/page.tsx:362-381`:
    clicking Pause hits `/strategies/{id}/toggle` globally. Student A
    experimenting with pausing VWAP in a graded quiz pauses it for Student B's
    exam answer and for the live book.

---

## Detailed walk-through

### A. Strategy detail — teaching readiness

`frontend/src/app/(dashboard)/strategies/[id]/page.tsx` (750 lines) is the strongest
pedagogical surface in the app:

| Section | Teaching verdict |
|---|---|
| Hero (4 metrics) | Good — honest caveat banner on suspicious Sharpe (line 595) is exactly right for a lecture. Missing: tooltips on what each metric is. |
| § 01 Signal | Excellent — thesis + edge + step-by-step mechanics from `STRATEGY_CONTENT`. Two-column prose when ≥ 2 paragraphs. Reads like a textbook chapter. |
| § 02 Performance | Good equity curve + SPY benchmark. Missing: ability to ship as static image for a slide deck; no "as-of" date picker. |
| § 03 Positions | Live positions — **dangerous in a classroom**, students see real Alpaca fills. |
| § 04 References | Good content (academic citations from spec.md) but **not hyperlinked, not copy-as-BibTeX, not versioned**. |
| § 05 Known limitations | Excellent amber-bordered list — teaches risk-aware reasoning. |
| "When to deploy" epilogue | Good. |

**Does § 04 References suffice for teaching?** Content-wise: yes, the citations are
the real canon (Jegadeesh-Titman 1993, Bernard-Thomas 1989/1990, Carr-Wu 2009,
Moskowitz-Ooi-Pedersen 2012, etc.). Presentation-wise: no —
- no links to DOI/SSRN/JSTOR
- no "Export citations" button (BibTeX / RIS / APA)
- no numbered anchor so prose can cite `[4]` back to reference 4
- 13 strategies have references; 7 strategies (claude-alpha, mean-reversion,
  dividend-capture, gap-fill, manual-discretionary, sector-rotation, vcp-breakout)
  silently skip the section per design (line 57-58), leaving no hint that the
  strategy has *any* reading list.

### B. Docs page (`/docs`)

`frontend/src/app/docs/page.tsx` renders `DOC_SECTIONS` (10 sections) with a TOC and
anchor navigation. Editorial tone is consistent but content is operational, not
pedagogical:

- No **glossary** (the single thing a professor uses most)
- No **worked example** page ("take AAPL earnings 2026-Q1 and walk through the PEAD SUE signal step-by-step")
- No **syllabus linkages** — `strategy-content.ts` is the real textbook but
  `/docs` never points there
- § 08 Strategy Methodology is a <100-word paragraph where the detail pages are
  1,000+ words per strategy — the docs should be a *table of contents* into
  `STRATEGY_CONTENT`, not a shadow copy.

### C. Sandbox / demo / reset

`frontend/src/app/(dashboard)/settings/page.tsx:548-571`:
- "Reset preferences" is the only reset. It calls
  `usePreferencesStore.resetAll()` which restores notifications, display, and
  data-refresh preferences to defaults.
- `tradingMode`, `watchlist`, and strategy pause-state **are explicitly
  excluded** (copy: "Trading mode and watchlist are not affected").
- Zero "preset scenarios". `grep -ri "demo|scenario|preset|sandbox"` returns
  only the `is_demo` boolean on market data (showing a small "DEMO" badge when
  upstream data is synthetic).
- `OnboardingTour.tsx` is a 5-step tutorial that dismisses permanently via
  `localStorage` — a professor would need a "reset tour" affordance to re-run
  it during a lecture.

### D. Share / public pages

No public route for strategy detail. The entire `(dashboard)` group is
auth-walled (`ProfileMenu.tsx` shows a session + logout). There is no
`/public/strategies/<id>`, no read-only mode, no anonymous-view rate limit.
`components/panels/ShareTrade.tsx` is the only share surface and it shares a
trade, not a strategy.

### E. Time-travel / replay

None. `EquityPanel` offers range-filtering from the start, but no "as-of"
cursor, no "advance bar" control, no pipeline run re-replay (the pipeline has
`history` — that lists *past runs*, not replays them). Teaching "what did the
dashboard look like on the day of the Aug 2024 VIX spike?" requires screenshots.

### F. Multi-student handling

`ADMIN_USERNAME` is a single string in `settings.py`. `require_admin`
(`auth.py:92-105`) compares JWT `sub` claim against that one value. Every
student would share one account. There is:
- no student role
- no course/cohort scope
- no per-student watchlist, per-student strategy toggle, per-student alert set
- no TA/grader middle tier
- no SSO (no `/oauth`, no `/saml`, no `/ldap` in routes)

---

## Recommendations (ordered by teaching payoff)

1. **Public read-only strategy pages.** Mirror `/strategies/[id]` at
   `/public/strategies/[id]` with trades/positions stripped, references
   hyperlinked, and a "Shared by AlphaDesk" footer. No auth. This is the single
   biggest unlock — a professor can link it into Canvas/Blackboard.
2. **Glossary page at `/docs/glossary`.** Index `STRATEGY_CONTENT` by term (SUE,
   VRP, drift, F-score, KAMA, ORB, regime, hit rate, Sharpe, CAGR, max DD).
   Click a term, jump to the strategy that uses it.
3. **Tooltips on hero metric chips.** Four chips, four `HelpCircle`s, four
   two-sentence definitions. Reuses `components/ui/HelpCircle.tsx` that
   already ships.
4. **Sandbox mode.** A flag on user.role = "student" (once multi-user lands)
   that forces `tradingMode = "paper"`, disables the Pause button, disables
   /pipeline/run, and routes fill toasts to a per-student stream.
5. **Preset scenarios.** Five canned "as-of" loads: Aug-2024 vol spike,
   Mar-2020 COVID, Feb-2018 volmageddon, Nov-2022 FTX, Jan-2022 growth-to-value
   rotation. Each seeds the dashboard with the strategy state on that date.
6. **Multi-user / cohort auth.** Replace `ADMIN_USERNAME` equality with a real
   `users` table + `role` column + `cohort_id`. Keep singleton-admin working as
   a degenerate case for solo researchers.

---

## Files touched during audit

- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` (750L, primary)
- `frontend/src/app/(dashboard)/strategies/page.tsx` (485L, listing)
- `frontend/src/app/(dashboard)/strategies/[id]/_strategy/{StrategyHero,SignalSection,LimitationsSection,PositionsSection,EquityPanel}.tsx`
- `frontend/src/lib/strategy-content.ts` (753L — the real textbook)
- `frontend/src/app/docs/page.tsx` + `docs/_docs/content.ts` (10 sections)
- `frontend/src/app/(dashboard)/settings/page.tsx` (651L — only `resetAll` exists)
- `frontend/src/stores/preferences.ts` (161L — reset scope confirmed)
- `frontend/src/components/ui/tooltip.tsx` + `HelpCircle.tsx` (available, unused on strategy page)
- `frontend/src/components/layout/OnboardingTour.tsx` (5-step, permanently dismissable)
- `backend/api/routes/auth.py` (singleton-admin confirmed, lines 92-105)
- `backend/core/config.py:80` (`ADMIN_USERNAME: str = "admin"`)
- `audit-reports/persona-8-settings.md` (prior findings corroborated)
- `audit-reports/persona-2-strategy-researcher.md` (strategy-page audit)
