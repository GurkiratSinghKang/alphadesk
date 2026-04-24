# Persona 5 — New Retail Investor

**Profile:** First time opening a systematic platform. Wants a gentle landing, honest copy, and no confusing double-paths.

## Bugs found

### P1-NR-1: Two different onboarding contact emails
- `/docs` "Getting Started": *contact **support@tradingalpha.net** to request access.*
- `/request-access`: *Send the request to **legal@tradingalpha.net***
- New user sees both. Which is authoritative?

### P1-NR-2: `/request-access` has no form — just instructions to send an email
- For an invite-only product this may be deliberate, but the CTA on the login page says "Request access" which a new user reads as "fill out a form now". Expectation vs reality mismatch.
- **Fix:** Either add a short form (name / email / context), or reword the login CTA to "Contact the desk" so the mailto: expectation is set.

### P1-NR-3: Docs reference navigation items that don't exist in every layout
- Docs: *"Use the top navigation bar to switch between **Dashboard**, **Trade**, and Pipeline views."*
- Desk (`/`) nav: `Desk · Strategies · Analytics · Pipeline · Alerts` — no "Dashboard", no "Trade".
- Analytics-shell (`/analytics`, `/trade`, `/strategies`, `/alerts`, `/pipeline`, `/reports`) nav: has both.
- A new user following docs from the Desk page cannot find "Trade" at all until they accidentally leave the desk.

### P1-NR-4: Order-ticket defaults are different between `/` (Desk) and `/trade`
- Desk order ticket: `QTY 1 · TYPE Market`.
- Trade page order ticket: `QTY 100 · TYPE Limit`.
- A new user who clicks "Place order" on the Desk with default settings buys 1 share at market; on Trade it's 100 shares at limit. The form looks identical in both places — same label, same layout — so the divergence is invisible.
- **Fix:** Pick one set of defaults and use it in both places.

### P1-NR-5: "Recent orders" table has Time but no Date column
- `2:20:06 PM · QQQ · SELL · 1 · stop · cancelled` — yesterday? today? last week? The list is ordered but a new user cannot correlate it with their own recall.

### P2-NR-6: Footer brand copy — "Powered by Claude AI — © 2026"
- Fine as marketing, but for a new investor reading it as "AI is placing my trades" is scary. The existing desk copy (*"Claude as a pre-trade second opinion, not a co-pilot on the wheel"*) is good positioning that should be carried to footer/tooltips so the footer doesn't silently imply autonomy.

### P2-NR-7: Login page hero date in header is **one day ahead** of the desk top bar
- Login: `2026-04-20`. Desk after sign-in: `Sun, Apr 19`. A new user signing in on Sunday evening ET sees "this thing thinks it's tomorrow" before they even log in.

### P2-NR-8: Empty states vary in tone and capitalization
- Analytics: *"Not enough data for rolling Sharpe (need 30+ days)"* (sentence case, helpful).
- Analytics: *"No return data"* (fragment, not helpful).
- Alerts: *"No active alerts · Create one above to get started."* (friendly).
- Reports: *"No realized trades found for 2026."* (vs other pages saying "No closed trades in this period.").
- Pick one voice and stick with it.
