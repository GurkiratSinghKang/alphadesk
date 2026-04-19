# Persona 52 — User in India wants to view positions in INR

**Browser locale:** `en-IN` / `hi-IN` · **Expected:** Positions, P&L, equity in INR (rupees, Indian digit grouping `1,00,000`), or at minimum an FX conversion layer and user setting.
**Verdict:** App is **hardcoded to USD end-to-end**. There is **zero FX conversion**, **zero currency preference**, and the display locale is pinned to `en-US`. Grepping `INR|rupee|forex|exchange.?rate|convert.*currency|fx_rate` across `backend/` and `frontend/src/` returns **no hits** relevant to currency handling.

## Top 10 findings

1. **No FX / forex code path anywhere.** `grep -ri "INR\|rupee\|forex\|exchange.?rate\|fx_rate\|convert.*currency"` across `backend/` returns zero substantive hits (only an unrelated "JPY-carry" strategy doc string in `backend/strategies/vrp_harvest/spec.md:32`, and "Euronet Worldwide" ticker name in `backend/api/routes/symbols.py:1406`). There is no rates table, no FX provider, no conversion helper.

2. **Currency formatter hardcoded to `en-US` / `USD`.** `frontend/src/lib/utils.ts:10-22` — two `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ... })` instances (`currencyFmt`, `currencyCompactFmt`) power every money render. An Indian user sees `$1,234.56` for every position, equity, P&L, cash balance.

3. **`formatCurrency` used from 50+ files (265+ sites).** Grep finds `formatCurrency` across positions list, status strip, profile menu, market context, dashboards, strategy cards, analytics, and reports. No call site accepts a currency code parameter — the function signature is `formatCurrency(value: number, compact?: boolean)`.

4. **Placeholder component duplicates USD pin.** `frontend/src/components/ui/placeholder.tsx:12-15` hardcodes a second `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` with placeholder `"$--.--"`. Two independent pins means even a config fix misses skeleton states.

5. **Raw `$` string concatenation bypasses `Intl`.** `frontend/src/components/layout/AICopilot.tsx:112` builds `` `Portfolio: $${summary.equity.toLocaleString()} equity, …` ``. The `$` is literal; `toLocaleString()` uses the browser locale for digits but the symbol is forced-USD. Same pattern documented in `persona-31-i18n.md` findings 5 for `ActivityFeed.tsx:183,195,205`, `PnLNumber.tsx:45`, `_desk/selectors.ts:446`.

6. **No user-level currency setting.** `backend/api/routes/auth.py` login/user model (`LoginRequest:283`, login route :300) carries no `currency`, `locale`, `country`, or `timezone` field. No DB column, no settings endpoint, no `PATCH /user/settings`. `ProfileMenu.tsx:117` renders equity via `formatCurrency(summary.equity)` with no preference lookup.

7. **Backend returns no currency code with money.** Market/trade/strategy/position payloads ship raw numbers (`price`, `equity`, `pnl`, `close`) with no `currency` field. Frontend has no way to know what unit the server sent — USD is implicit.

8. **Quote source is US equities only.** `backend/api/routes/symbols.py` exchange field only emits `"NASDAQ"` / `"NYSE"` (lines 279, 541, 1150, 1153, 1406, etc.); no `NSE` / `BSE` (Indian exchanges). Even if FX existed, there are no INR-denominated instruments to price.

9. **Market-hours clock locked to `America/New_York`.** `frontend/src/lib/marketHours.ts:22-26` — `timeZone: "America/New_York"`. Status strip / session labels show NYSE hours to an IST user with no toggle. Related: `_desk/useDeskClock.ts` uses `toLocaleTimeString("en-US", …)`.

10. **No i18n framework to build on.** `persona-31-i18n.md` confirms `package.json` has no `i18next`, `next-intl`, `react-intl`, `@formatjs/*`. Adding INR is not a one-line `currency: "INR"` swap — Indian digit grouping (lakhs/crores, `1,00,000` not `100,000`) requires `en-IN` locale and touching every `Intl.NumberFormat("en-US", …)` call site.

## 250-word summary

AlphaDesk is **single-currency, USD-only, with no FX layer**. A user logging in from India sees every dollar value as `$1,234.56`, rendered through `Intl.NumberFormat("en-US", { currency: "USD" })` pinned in `frontend/src/lib/utils.ts:10-22` and duplicated in `frontend/src/components/ui/placeholder.tsx:12-15`. There are no conversion tables, no forex API calls, no `fx_rate` field, no `currency` column on positions or users — grepping `INR|rupee|forex|exchange.?rate|fx_rate|convert.*currency` across 400+ backend/frontend files returns zero substantive hits.

The backend offers no user preference for currency or locale. `backend/api/routes/auth.py` carries an admin-only `LoginRequest` and issues tokens with no associated settings payload. API responses ship raw numeric `price`, `equity`, `pnl` with no currency code, so even a future client-side conversion would have to assume USD. The universe itself is US-only: `backend/api/routes/symbols.py` emits only `NASDAQ`/`NYSE`, never `NSE`/`BSE`, and the market-hours helper (`frontend/src/lib/marketHours.ts:22-26`) is hardcoded to `America/New_York`.

Even attempting a quick INR swap would fail across ~50 files and 265 call sites. Beyond the two `Intl.NumberFormat` pins, raw `$`-concat strings in `AICopilot.tsx:112`, `PnLNumber.tsx:45`, and `_desk/selectors.ts:446` glue on the dollar symbol literally — no formatter can override them. Indian digit grouping (`1,00,000` lakh/crore) needs the `en-IN` locale, absent from every call site. No `i18next`/`next-intl` is installed (`persona-31-i18n.md`). Recommendation: add a user `base_currency` field, tag all money payloads with a currency code, introduce an FX cache keyed by symbol listing exchange, centralize formatting in one `formatMoney(value, currency, locale)` helper, and purge every `$`+`toFixed` string.
