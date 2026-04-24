# Persona 4 — Compliance Officer

**Profile:** Owns the trail, the disclaimers, and the "did we tell the user this is paper" question.

## Bugs found

### P0-COMP-1: Three different "current" prices for AVGO across three pages of the same session
- Desk panel: AVGO P&L `+$275` / `+$273` (implies current ≈ $399.38)
- Pipeline table: AVGO `ENTRY $381.05 → CURRENT $406.06`, P&L `+$375.15`
- Reports table: AVGO `AVG COST $381.05 → PRICE $400.00`, P&L `+$284.25`
- Same for BA: Desk −$113, Reports −$101.25.
- EQUITY: Desk `$100,347.87`/`$100,347.31`, Reports `$100,368.54`.
- Three pages, three truths. For compliance this is disqualifying.

### P0-COMP-2: No disclaimers on the Tax Report
- `Tax Report (Simplified)` offers `Download Tax Report (CSV)` with no "not tax advice · for informational purposes only · consult a tax professional" statement anywhere on the page. Even "Simplified" in the title does not substitute.
- Required: prominent disclaimer above the download button.

### P1-COMP-3: "LIVE" dot next to "Alpaca (Paper) · PAPER" badge
- Trader cannot tell at a glance whether the session is live or paper. For an audit trail, whoever reviews screenshots of the app will see "LIVE" first. Rename `LIVE` → `STREAMING` or `CONNECTED`.

### P1-COMP-4: Strategy status mismatch between Strategies page and Reports page
- Strategies page lists `1 paused` (Earnings Vol Premium).
- Reports strategy table lists `2 paused` (Earnings Vol Premium + Gap Fill).
- A compliance report cannot contradict the live UI.

### P1-COMP-5: "Opening Range Breakout" rendered as `active` in Reports but `NOT READY FOR LIVE` on Strategies
- Same rows, different statuses on two pages.

### P1-COMP-6: Audit timestamps for every open position are identical
- `Apr 18, 2026, 01:42 AM` for all 7 positions. Entry timestamps identical to the second means there is no entry-time trail at all (or it's seeded). Audit needs real times.

### P2-COMP-7: "Switch to live trading" command exists in the palette but is not gated in any obvious way
- Command appears when the palette opens cold with no query. Typing the keyword `live` no longer shows it (palette prefers fuzzy symbol match). There is no "2FA / confirm / test order first" flow associated with this command's safety — at least none that's visible from the palette.
- Compliance wants a documented live-switch safety checklist and a confirmation modal with explicit risk copy.

### P2-COMP-8: Footer version stamp inconsistent across pages
- `/alerts`, `/pipeline`, `/reports` show `AlphaDesk v1.0 — Powered by Claude AI — © 2026` footer.
- `/`, `/strategies`, `/analytics` have no footer at all.
- A compliance officer expects the version stamp on every page so support can correlate bug reports.

### P2-COMP-9: Tax year dropdown only shows `2026`
- For a platform running in 2026, historical tax years should be selectable (2025, 2024). Users cannot export prior-year reports even if trades exist.
