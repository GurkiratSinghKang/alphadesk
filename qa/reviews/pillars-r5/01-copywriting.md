# Pillar 1 — Copywriting (R5 adversarial fresh hunt)

**Score: 2/4**  (R4: 4/4 → now: 2/4)
**Run:** qa/runs/2026-05-04T20-31-40Z

## Methodology

Read 28 DOM snapshots fresh across desktop-1440 and mobile-390 — both the surfaces R4
verified clean (settings, login, marketing) and the high-copy-density product surfaces
that R4 sampled lightly or skipped: pipeline, analytics, reports, /docs, /help/earnings-data,
strategies-list (full readiness workbench), strategy-momentum-quality detail page,
strategies-earnings-options-play (initial + row-selected + status-hover + bottom),
strategies-trading-agents-research (which carries large LLM-rendered content), and
trade ticket states (initial-prefill, multi-leg-prefill, ticket-filled). Verified findings
against the React source (`grep -rn …`) so each call-out is real shipped copy, not a
text-extraction artifact. Read 4 PNGs (mobile dashboard, mobile pipeline, mobile trade,
mobile earnings) for visible-only issues. The "PR #32 sector_rotation just landed" prompt
is a red herring — there is no `frontend/src/app/(dashboard)/strategies/sector-rotation`
folder; Sector Rotation appears only as an `IN DEVELOPMENT Blocked` row in the catalogue.

## NEW findings (severity-tagged)

### BLOCKERS

- **`Heartbeat Invalid Date ET` rendered as user-facing text on /pipeline.**
  Visible on both `pipeline/desktop-1440/initial.dom.html` and `pipeline/mobile-390/initial.png`
  (the mobile PNG shows it in 14pt mono next to a `4 missed` amber badge). Source:
  `frontend/src/app/(dashboard)/pipeline/page.tsx:889-897` calls
  `new Date(scheduler.last_heartbeat).toLocaleString(...)` without guarding against an
  unparseable string. JS hands back the literal string `"Invalid Date"` and the page
  appends ` ET` to it. The `else` branch falls back to `"Never"` only when
  `scheduler.last_heartbeat` is **falsy** — a malformed-but-truthy value (which the
  backend is currently shipping) defeats the guard. This is the single highest-severity
  copy bug in the sweep: an operator on the live pipeline page sees raw JavaScript
  failure text where the heartbeat clock should be.
- **`Got it — don't show again` survives in the earnings-options-play educational
  banner.** R4's "Got it → Understood" sweep covered the two Live-mode dialogs in
  `ProfileMenu.tsx` and `settings/page.tsx`, but missed
  `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:569`. Visible
  in 12 of the 12 earnings-options-play DOM snapshots
  (initial / row-selected / status-hover / bottom / scrolled-mid × desktop+mobile).
  This means R4's claim that the "Got it" CTA is gone product-wide is incorrect — it is
  literally the first dismiss button a new user encounters on the most-promoted research
  surface.
- **`est. move: +800.0% / -700.0%` rendered as Claude's structured forecast.** Visible
  in `strategies-earnings-options-play/desktop-1440/initial.dom.html` and `…/row-selected`
  inside the `◇ CLAUDE · STRUCTURED claude-opus-4-7 NEUTRAL-BULL conf 60%` chip strip.
  PLTR was selected by default and ships a +800% / −700% expected-move forecast directly
  in the operator's read path. Either (a) the backend is returning a corrupted payload
  that the frontend should sanity-cap-and-suppress, or (b) the frontend is mis-rendering
  a fraction-of-1 number as a percent. Either way the user sees an obviously absurd
  forecast on the demo case the rest of the sweep landed on, which destroys
  declarative-not-hype voice the moment a serious operator looks at it.
- **Title Case violations across analytics + reports + pipeline + settings stat
  tables.** R4 closed the seven Settings toggle labels but never audited the rest of
  the product. Source confirms ≥ 14 hardcoded Title Case labels:
  - `frontend/src/app/(dashboard)/analytics/page.tsx:761-768`:
    `"Total Trades"`, `"Win Rate"`, `"Profit Factor"`, `"Avg Win"`, `"Avg Loss"`,
    `"Largest Win"`, `"Largest Loss"`, `"Avg Hold Time"`, `"Max Hold Time"`,
    `"Max Consec. Wins"`, `"Max Consec. Losses"`. All visible in
    `analytics/desktop-1440/initial.dom.html`.
  - `frontend/src/app/(dashboard)/reports/page.tsx:830, 860`: header tokens
    `"Win Rate"`, `"Max Drawdown %"`, `"Return %"`, `"Avg Cost"`, `"Mkt Value"`,
    `"Buying Power"`, `"Unrealized P&L"`, `"Realized P&L"`, `"Total P&L"`,
    `"Current Positions"`, `"Closed Trades"`, `"Tax report (simplified)"`. Visible in
    `reports/desktop-1440/initial.dom.html`.
  - `frontend/src/app/(dashboard)/pipeline/page.tsx:680, 234-239`:
    button label `"Run Now"` and badge `"Risk Monitor: ON"` / `"Risk Monitor: OFF"` /
    `"Risk Monitor: unavailable"`.
  - `frontend/src/app/(dashboard)/settings/page.tsx:1113…`: admin Performance
    Monitor block emits `"Performance Monitor"`, `"Recent API Response Times"`,
    `"Last 10 Requests"`, `"Endpoint"`/`"Status"`/`"Duration"` headers, all Title Case.
  This is the same class of defect R4 declared closed at the Settings toggle layer
  — it is wider than R4 reported and ships site-wide on three of the seven dashboard
  routes.

### MAJOR

- **Product-name inconsistency between marketing and dashboard.** `<title>` tags split:
  marketing/auth surfaces ship `"AlphaDesk — AI Trading Terminal"` (login, request-access,
  request-access-submit), while dashboard surfaces ship `"AlphaDesk — AI-Powered Trading
  Terminal"` (dashboard, strategies, settings, alerts, pipeline, reports, analytics,
  trade, /docs, /not-found, /design, /help/earnings-data). Two competing canonical
  taglines for the same product on the same domain — a serious operator will notice
  on the browser tab and the OS Recents.
- **Corrupted price-map labels in TradingAgents Research panel.** The `Price map` rail
  on `strategies-trading-agents-research/desktop-1440/initial.dom.html` ships labels
  like `"$277.97 d levels near the upper Bollinger Band ()."`, `"$248–255 ), with a
  higher-conviction add zone at (200-day SMA, ~). $254.55 ion add zone at (200-day
  SMA, ~)."`. These are clearly substring extracts from an LLM-generated body that
  retained leading parens, dangling `~` tokens, and word-boundary cuts (`d levels`,
  `ion add zone`). It looks like the page is regex-slicing structured fields out of the
  Portfolio Manager memo and rendering the slice with surrounding punctuation glued on.
  The source memo itself is fine; the rail glue is not.
- **`front-month 110.9%to back-month 110.9%` typo in IV-term-skew sr-only caption.**
  `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew.tsx:120-121`
  splits the sentence across two JSX text nodes:
    ```
    front-month {fmtPct(...)}
    to back-month {fmtPct(...)}.
    ```
  No leading space on the second line collapses to `110.9%to back-month`. Visible in
  every earnings-options-play DOM. Screen-reader-visible since the caption is `sr-only`.
- **`Naked short calls have unlimited risk ;` — extra space before semicolon.**
  Educational explainer at top of `/strategies/earnings-options-play`. Punctuation
  voice contract calls for tight, sentence-form prose; this is the only pre-semicolon
  space in the deployed product.
- **`TradingAgents Research Multi-agent thesis desk - read-only research`** uses an
  ASCII hyphen surrounded by spaces where every other AlphaDesk subtitle uses an
  em-dash. Visible in `/strategies` catalogue rail (initial / card-hover / filtered /
  scrolled-mid / bottom × desktop + mobile). Same surface ships
  `"AAPL / 2026-05-01 HOLD - May 1, 7:58 PM"` in `/strategies/trading-agents-research`
  run history — also bare hyphen.
- **`Day P&L` vs `Day P/L` inconsistency on dashboard.** Same surface, two glyphs:
  the hero strip emits `Day P&L −$429.37` (proper ampersand), while the action-stack
  card emits `Day P/L -$429.4` (slash + ASCII minus). Visible side-by-side in
  `dashboard/desktop-1440/initial.dom.html` and `dashboard/mobile-390/initial.dom.html`.
- **`docs` page Contents list and § headings are Title Case.** `docs/desktop-1440/initial.dom.html`:
  `01 Getting Started`, `02 Dashboard`, `03 Trading`, `04 Strategies`, `05 Pipeline`,
  `06 Keyboard Shortcuts`, `07 How Claude Analysis Works`, `08 Strategy Methodology`,
  `09 FAQ / Troubleshooting`, `10 API Keys (Alpaca Setup)`. Then the section headers
  match: `§ 01 · Getting Started`, `§ 06 · Keyboard Shortcuts`, `§ 07 · How Claude
  Analysis Works`, `§ 10 · API Keys (Alpaca Setup)`. Sentence-case voice contract
  is violated on every documentation heading. R4 declared `/docs` clean post-rewrite.
- **`/help/earnings-data` heading style flips between Title Case top and sentence-case
  sub.** Top headers `Inputs`, `Derived Fields`, `AI Research`, `Trading Limits` are
  Title Case; the immediate subheaders below them (`What feeds the earnings options
  play`, `How the dashboard calculates context`) are sentence case. The page
  contradicts itself within 30vh of scroll.
- **Strategy-count drift between docs and product.** `/docs` § 04 says "AlphaDesk
  runs **twelve** parallel strategies." `/strategies` header says
  `12 active · 1 paused · 6 in development · 19 total`. The docs page gives the wrong
  number (12 active is correct only if you exclude paper-only and paused) and uses
  an English numeral while the catalogue uses arabic — inconsistency is twofold.
- **Empty-state `Last trade —` ships a bare em-dash on `/strategies/<id>`.** Visible
  in `strategy-momentum-quality/desktop-1440/initial.dom.html` (also pause-click and
  metric-hover and mobile). Should resolve to `"Last trade: never"` or hide the row.
  The active-strategy header reads `ACTIVE Last trade — Pause View trades` and the
  bare em-dash looks like a stripped data-pipeline failure exactly the way the
  R3 EarningsCalendarSidebar `"No earnings match —"` did before R4 fixed it.
- **`Reconnecting to live data…` flashes during nominal page load.** Captured at the
  top of `strategies-list/mobile-390/initial.dom.html` — the WS recon banner is
  appearing on a page that just rendered, suggesting either the harness is unlucky
  or the banner ships on every cold load. Either way the copy is fine but the
  *trigger* says the page is in error during a happy path.

### MINORS / NITs

- `▸ Open Strategies` and `▸ Run full research` use a leftover `▸` triangle glyph
  as a button-prefix decoration. Inconsistent with the rest of the product, which
  uses no glyph or `→`. Sources: `pipeline/desktop-1440/initial.dom.html` and
  `strategies-earnings-options-play/desktop-1440/initial.dom.html`.
- Marketing eyebrow `Trust Private desk private` (login.dom) and `Trust Fit human`
  (request-access.dom) read as eyebrow + label pairs but the labels themselves are
  ungrammatical. Should be `Private desk` and `Human review` (or similar) without
  the redundancy.
- Marketing summary token `1.43 example OOS Sharpe, caveated paper first default
  operating mode` reads like two phrases concatenated without a separator. Visible
  on every marketing-shelled DOM. Probably a JSX text-node concat bug.
- Earnings panel "Hover for P/L At expiration" — sentence fragment that would read
  as "Hover for P/L. At expiration." with a period; currently runs together.
- Earnings news strip uses `— earnings event already passed, event-entry trade
  links disabled.` as caveat text without a leading label or period before the
  next item. Reads as if it were a news headline.
- Pipeline calendar caption `click a day to expand · hover for details` is sentence-
  case fragment without terminal period. Same surface uses `Pipeline has not run
  today — awaiting next scheduled run` also without period.
- TradingAgents Research run-history token `5 sections / 131 lines / 16,013 chars`
  uses the abbreviation `chars`. Either spell out `characters` or drop the field;
  `chars` reads as developer log not operator copy.
- Trade ticket pre-submit chip `Position context Pass Flat -> +1` uses ASCII `->`
  arrow instead of `→`. Visible in `trade/desktop-1440/initial-prefill.dom.html` and
  `…/ticket-filled.dom.html`.
- Mobile dashboard risk-gate card clips copy: visible in
  `dashboard/mobile-390/initial.png` the body text reads `Working orders need r…`
  with the rest truncated. This is layout/clipping rather than copy per se but
  the recovery is to shorten the line, not widen the box. Also the top hero strip
  `POSITIONS · OPEN OR` is cut mid-word.
- The kill-switch panel on every strategy detail page ships `Emergency disable`
  twice (label + button) and `Reason (required)` between them. Reads as if the
  button repeats the field label. Visible in `strategy-momentum-quality/*/pause-click.dom.html`.
- The "Setup comparison" table on earnings-options-play ships rows like
  `long put best 38% +13,282.4% 213.52` without a unit cap. A 13,282% AVG R is a
  sample-size-of-3-put-expiring-near-zero artifact; the operator expects a footnote
  or a hard cap, not the raw number. Also `iron condor avoid 0% -71.7% 0.00` ships
  a literal `0.00` profit-factor next to `∞` for `long straddle suggested` —
  inconsistent representation of the divide-by-zero edges.
- Settings page admin block leaks dev language: `Performance Monitor / Real-time
  app performance metrics (admin/debug)`. The `(admin/debug)` parenthetical is
  developer voice, not operator voice. Either move the panel behind a flag or
  rewrite the eyebrow.
- 404 page still ships `Back to AlphaDesk` and `Read the docs` (R1 NIT, R3+R4
  carry-over, still unresolved).
- Login eyebrow `Welcome back / Open your workspace` redundancy still ships
  (R1+R3+R4 carry-over).
- Request-access success page still ships bare `Ref AR-0J5QM1OSDVBP` without a
  label (R3+R4 NIT carry-over). The reference code changed from R4 to R5 because
  it is generated per request — the bare-format defect persists.

## Sites verified clean

R4 closures still hold on the surfaces I rechecked:
- Backend login error string `Those credentials didn't match. Try again or request
  access.` — confirmed in `login/desktop-1440/after-submit-invalid.dom.html`.
- Marketing footer `α · Operator-grade execution` — confirmed in 14 marketing-shell DOMs.
- Dashboard footer `AlphaDesk dev — Built on Claude — © 2026` — confirmed in 30+
  dashboard DOMs.
- Settings toggle labels `Order fills / Alerts triggered / Pipeline completed /
  Compact strategy view` — confirmed sentence-case.
- Live-mode dialog `Live trading requires admin enablement` + `Understood` CTA
  pair — confirmed where dialogs were captured (the dialog is closed in the swept
  states but source verified at `ProfileMenu.tsx:213,221` and `settings/page.tsx:1152`).
- `EarningsCalendarSidebar` empty-state period punctuation — confirmed `.` not `—`
  on every earnings DOM.
- `/risk` page — clean editorial, sentence-case headings, periods everywhere,
  appropriate operator-grade jargon (PFOF, PDT, FINRA/SIPC, SEC Rule 606).
- `/about`, `/contact`, `/terms`, `/privacy` — clean editorial throughout.

## Score justification

The R4 4/4 ranking was earned for the surfaces R4 audited, but R4 sampled narrowly
(settings, marketing footer, login, two strategy panels) and declared product-wide
victory on the strength of those wins. R5 is a fresh adversarial sweep of the
high-copy-density surfaces R4 skipped, and it surfaces four blockers (`Invalid Date`
on /pipeline, surviving `Got it` on the most-promoted research surface, the
`+800% / −700%` corrupted Claude forecast on the demo case, and Title Case stat
labels everywhere on /analytics, /reports, /pipeline, /settings) plus eleven majors
that R4 either did not check or did not flag.

Score is **2/4 (BELOW BAR)** rather than 1/4 because the foundational voice
(declarative, operator-grade, no exclamations, sensible jargon, decent error recovery)
is intact and the R4 fixes really are clean — it's the next layer down (stat-table
labels, edge-case data rendering, and one banner CTA the sweep missed) that has
shipped with multiple regressions plus one true rendering blocker. To get back to
4/4 the team should: (1) fix the `Invalid Date` parse bug in `pipeline/page.tsx:889`
and `app/lib/api.ts` date normalisation, (2) replace `Got it` in `earnings-options-play/page.tsx:569`,
(3) cap or filter the structured-Claude expected-move when it exceeds a sanity
threshold (e.g. ±50%), (4) sentence-case the analytics/reports/pipeline stat labels
and the docs/help-earnings § headings, (5) reconcile `AI Trading Terminal` vs
`AI-Powered Trading Terminal` to a single canonical product name, (6) fix the
`110.9%to` JSX text-node space bug, and (7) fix the TradingAgents price-map
substring extraction so the rail stops shipping `"d levels"` and `"ion add zone"`.
