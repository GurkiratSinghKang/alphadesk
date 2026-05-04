# Copy & Microcopy Review — AlphaDesk

**Captured:** 2026-05-03 (run 2026-05-03T23-07-16Z)
**Audience:** sophisticated traders / PMs (per brand brief)
**Voice target:** declarative, serious, no-hype, slightly clinical

Public surface has a strong, distinctive editorial voice. Dashboard mostly carries it; a meaningful share of strings drops into a generic-product register. Biggest single problem: `/docs`, which reads like vendor documentation by a different writer.

## Top 5 things to rewrite

1. **`frontend/src/app/docs/page.tsx` — entire page.** Last surviving piece of marketing-speak. Examples: `"AlphaDesk leverages Anthropic's Claude AI to analyze market opportunities across all 12 strategies"`, `"AlphaDesk strategies are grounded in academic research and well-established market phenomena."` Compare with `/help/earnings-data` (`"BMO and AMC timing depends on provider calendar metadata and can change. Confirm the company's investor-relations release time before placing a live earnings trade."`). Same product, two writers. Rewrite `/docs` in the earnings-data voice. Drop "leverages", "powerful", "sophisticated".
2. **Login error — `LoginForm.tsx:164`: `"Invalid username or password"`.** Generic. Recommend: `"Those credentials didn't match. Reset the password if you've lost it."` Same fix for `:207` `"Failed to connect to server"` → `"Couldn't reach AlphaDesk. Check your connection and try again."`
3. **Request-access success H2 — `RequestAccessForm.tsx:154`: `"The desk has your details"`.** Cute, but "the desk" as a personified subject is uncommitted across the site (used on `/login/reset` but nowhere else in this flow). Replace with `"Request received."` and let the existing reference-id paragraph carry the detail.
4. **Request-access placeholders — `RequestAccessForm.tsx:224,237,252`: `"Mira Patel" / "mira@fund.example" / "Independent PM"`.** Fake-name placeholders fight the "small, invite-only, serious" positioning. Either delete (labels are clear) or use neutral pattern hints (`"Full name"`).
5. **Lockout `"Reset lockout"` button — `LoginForm.tsx:374`.** Sits directly under `"Too many attempts. Try again in 9m 12s."` and contradicts it. Either rename to `"Clear local timer"` with helper `"The server limit may still apply"`, or hide behind a "Why is this happening?" disclosure.

## Per-page notes

### /login
- Eyebrow `"Welcome back"` over H2 `"Open your workspace"` is redundant. Drop eyebrow.
- Password placeholder `"your password"` duplicates the label. Replace with `"at least 12 characters"` per `qa/pages/login.md:54`, or remove.
- TOTP prompt (`LoginForm.tsx:161`) sets `error` state and renders in red box. TOTP-required is a normal flow — neutral info box.
- TOTP placeholder `"6-digit code"` but input accepts up to 8 (`.slice(0, 8)`). Match or constrain.
- Footer `"No account? Request access"` — slightly informal; consider `"Need an invite?"`.

### /login/reset
- Exemplary. `"Self-serve reset is not yet wired. Until it is, the desk rotates passwords by hand on request."` is the platonic AlphaDesk sentence.
- Nit: `"out-of-band"` → `"out of band (a prior message thread or video call)"`.

### /request-access
- Lead's second sentence (`"…not a generic signup funnel."`) is defensive. Cut.
- H2 `"Start your workspace request"` — tighter as `"Workspace request"`.
- Label `"Firm or context"` is odd phrasing. Try `"Firm"` + helper `"Or independent — say so."`, or `"Affiliation"`.
- Trading-mode chips: re-order so `"Paper to live"` is last (it's a transition, not a default category).
- Success body's literal `"queued"` fallback when `requestId` is empty: render `"Reference pending"` or omit line.

### /docs
- See Top 5 #1.
- Second sentence in conviction-score paragraph restates the first. Cut.
- Inconsistent within page: `"twelve parallel trading strategies"` vs `"all 12 strategies"`. Pick spelled-out.
- `"Login problems: Ensure you are using the correct credentials."` — borderline condescending. Try: `"If sign-in fails: confirm the username (case-insensitive) and password, or request a reset at support@tradingalpha.net."`
- `"contact support@tradingalpha.net to request access"` contradicts `/request-access`. Point to the form.

### /contact
- The kill-switch paragraph is exactly the voice you want everywhere.
- Support promises `"two business days"`; press just says `"slower"`. Quantify both or neither.

### /help/earnings-data
- Best-written page in the product. Use as model for `/docs`.
- Title `"Earnings Data Guide"` is Title Case; recommend sentence case to match login/about/request-access.

### /not-found
- Headline `"Not on the tape."` and body are excellent.
- CTA `"Back to AlphaDesk"` assumes brand familiarity for misclicked unauthenticated users. Recommend `"Back to sign in"`.

### Dashboard (sampled from source)
- Best examples: `(dashboard)/page.tsx:1488` `"No interventions pending"`; `_desk/StrategyPanel.tsx:43` `"No strategy exceptions. Active systems are quiet."`; `_desk/selectors.ts:526` `"No memo yet — add one or wait for the AI to summarize."`.
- `trading-agents-research/page.tsx:1167` `"No report selected"` — bare. Add: `"Pick a run from the history."`
- `pipeline/page.tsx` has two near-duplicate emptys (`"No active positions — pipeline will open trades…"` vs `"No open positions — the pipeline opens trades…"`). Pick one phrasing.
- Toasts mix registers: `"Cancel requested. Pipeline will stop at next safe checkpoint."` (perfect) vs `"Pause-all already in progress…"` (ellipsis as if system is thinking).
- Settings has `"Activate Template"` (Title Case) — should be `"Activate template"`.

## Cross-cutting voice / consistency themes

- **"The desk" as a personified subject is half-committed.** Used naturally on `/login/reset`; appears in request-access success without precedent in the same flow. Either codify across support/settings/ops copy, or drop.
- **Sentence case vs Title Case for H1s is mixed.** Login/about/request-access use sentence case; docs/privacy/terms use Title Case. Standardize on sentence case.
- **Trailing ellipses are inconsistent.** Reserve ellipses for indeterminate progress only; periods for everything else. Use single-character ellipsis (…) not three dots.
- **"AI" capitalization is inconsistent.** Visible UI uses lowercase descriptors (`"AI review"`); titles/docs use Title Case (`"AI Analysis"`). Standardize lowercase descriptor.
- **"Claude" vs "AI" naming.** `/docs` names Claude; dashboard abstracts to "AI". For an audience that cares about provenance, surface "Claude" in dashboard tooltips.
- **Currency / percent / ticker formatting is consistent.** `$250k`, `+2.4%`, uppercase tickers. Keep.
- **Contractions are inconsistent.** Acceptable split: no contractions on public/setup surfaces; OK on transient toasts.

## Empty state inventory

Recommendations add a next action where copy only states absence.

| Source | Current | Recommended |
| --- | --- | --- |
| `strategies/page.tsx:925` | `No strategies currently active.` | Add: `Promote a planned strategy to start trading.` |
| `strategies/page.tsx:972` | `No planned strategies.` | Add: `Add one from the catalogue.` |
| `trading-agents-research/page.tsx:1167` | `No report selected` | `No report selected. Pick a run from the history.` |
| `EarningsCalendarSidebar.tsx:353` | `No earnings match —` | Trailing dash reads as a bug. `No earnings match the current filters.` |
| `pipeline/page.tsx:911` | `No active positions — pipeline will open trades during market hours` | Pick one phrasing site-wide. |
| `reports/page.tsx:382` | `Nothing to export yet` | `Trade history will populate after the first closed position.` |
| `settings/page.tsx:788` | `No saved brokerage connection.` | `Add Alpaca keys above to enable live or paper routing.` |
| `alerts/page.tsx` | `No active alerts` | `Create one to get notified on price or volume moves.` |
| Strong as-is | `No interventions pending`, `No strategy exceptions. Active systems are quiet.`, `No memo yet — add one or wait for the AI to summarize.`, `No curated matches — loosen filters.` | Keep. |

## Error message inventory

Pattern: state the error, then say what to do.

| Trigger | Current | Recommended |
| --- | --- | --- |
| Login: bad creds (`LoginForm.tsx:164`) | `Invalid username or password` | `Those credentials didn't match. Reset the password if you've lost it.` |
| Login: network (`:207`) | `Failed to connect to server` | `Couldn't reach AlphaDesk. Check your connection and try again.` |
| Login: TOTP required (`:161`) | (in red error box) | Keep copy; render in neutral info box, not red. |
| Request access: API fail (`:132`) | `The request could not be sent. Please try again.` | `Couldn't submit the request. Try again, or email support@tradingalpha.net.` |
| Trade: no quote (`trade/page.tsx:740`) | `No executable quote is available for that preset` | Add period: `…that preset. Pick another expiry or strike.` |
| Pipeline: forbidden (`pipeline/page.tsx:540`) | `You don't have permission to run the pipeline.` | `Your account doesn't have run-pipeline permission. Contact your operator.` |
| TradingAgents: load fail (`:375`) | `Failed to load TradingAgents runs` | `Couldn't load TradingAgents runs. Refresh or check runtime status.` |
| Alerts: bulk delete fail (`alerts/page.tsx:787`) | `Failed to delete N alert(s)` | `Couldn't delete N alerts.` (pluralize properly). |
| Generic alert delete fail (`:764`) | `Failed to delete alert` | `Couldn't delete the alert. Try again or refresh the list.` |
| Settings: live blocked (`settings/page.tsx:1151`) | `Live mode is not enabled on this account. Contact support to unlock live trading.` | Keep; link `support` to mailto. |

## Closing

Voice exists and is genuinely good — strongest aspect of the public surface. Fix list is mostly: (a) bring `/docs` into line, (b) tighten error/empty-state copy to include a next action, (c) resolve consistency forks. No page needs full rewrite.
