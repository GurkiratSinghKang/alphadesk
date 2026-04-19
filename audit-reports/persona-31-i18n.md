# Persona 31 — Spanish-speaking user (es-MX)

**Browser locale:** `es-MX` · **Expected:** `1.234,56`, `d/m/aaaa`, Spanish copy, possibly RTL for other locales.
**Verdict:** App is **hardcoded to en-US end-to-end**. No i18n library is installed. Zero locale negotiation.

## Top 10 findings

1. **No i18n framework installed.** `frontend/package.json` has no `i18next`, `next-intl`, `react-i18next`, `react-intl`, `@formatjs/*`, `date-fns-tz`, or `dayjs/locale`. There is no translation infrastructure at all — every visible string is an English literal in JSX.

2. **Root `<html lang="en">` is hardcoded** in `frontend/src/app/layout.tsx:60` (and `global-error.tsx:41`). Screen readers will announce content as English even if it contained Spanish. `dir` is never set, so any future RTL locale (ar/he) would ship left-to-right. `suppressHydrationWarning` (line 62) would hide any locale mismatch errors.

3. **Currency formatter pinned to en-US/USD** in `frontend/src/lib/utils.ts:10-22`. `formatCurrency(1234.56)` emits `$1,234.56` globally — a Spanish user reading `$1,234.56` parses it as one million two hundred thirty-four. This is the single highest-blast-radius bug: used across 50 files (265 call sites).

4. **Percent formatter pinned to en-US** in `utils.ts:24-29` with `signDisplay: "always"` — emits `+1.23%` instead of `+1,23 %` (note: Spanish also uses a space before `%`).

5. **Custom `$` concatenation bypasses `Intl` entirely.** `components/dashboard/ActivityFeed.tsx:183,195,205` builds strings like `` `@ $${price.toFixed(2)}` ``. Even fixing the formatter won't help: the `$` is glued on and `toFixed(2)` always emits a period. Same pattern in `PnLNumber.tsx:45`, `strategies/[id]/page.tsx:546,555`, `_desk/selectors.ts:446`.

6. **Desk clock is en-US.** `app/(dashboard)/_desk/useDeskClock.ts:20,26` uses `toLocaleTimeString("en-US", …)` and `toLocaleDateString("en-US", {weekday:"short", month:"short", …})` — the always-visible top-bar clock shows `Sat, Apr 18` instead of `sáb, 18 abr`.

7. **10 `Intl.DateTimeFormat("en-US", …)` call sites** across `PnlCalendar.tsx:25`, `PnlCalendarMini.tsx:15,71`, `MorningBrief.tsx:37`, `marketHours.ts:25`, `pipeline/page.tsx:63` (weekday name used in user-facing copy like "Today 09:30 ET" / next-session label). Month and weekday names are English.

8. **265 `toFixed()` / `toLocaleString()` / `toLocaleDateString()` occurrences across 50 files** (raw grep count). Each is a latent locale bug: `toFixed` always uses `.` as decimal separator and returns a string that mixes with `Intl`-formatted numbers, giving inconsistent output even within a single row.

9. **Plurals are hand-rolled English-only.** `ActivityFeed.tsx:339` builds `` `${n} event${n !== 1 ? "s" : ""}` ``; same pattern in lines 144, 169, 194. Spanish plurals work (`evento`/`eventos`) but the "s" suffix is hardcoded English. `Intl.PluralRules` is not used anywhere. Spanish has no `zero` form distinct from `other`, so once i18n lands, categories need `one`/`other` only — but today the app can't express either without code change.

10. **No RTL support.** `dir` attribute is absent from `<html>`. Tailwind CSS v4 is in use but there are no `rtl:` utilities anywhere. `ar-*`, `he-*`, `fa-*` users would see a ltr layout with English copy — not an es-MX issue but a systemic i18n blocker, confirming the app has never been localized.

## 250-word summary

AlphaDesk has **no i18n at all**. The frontend ships zero translation infrastructure — no `i18next`, `next-intl`, `react-intl`, or FormatJS in `package.json`. Every user-facing string is an English literal inline in JSX, and the root `<html lang="en">` (`app/layout.tsx:60`) is hardcoded. A Spanish-speaking user with `es-MX` in their browser gets an entirely English UI regardless of their Accept-Language header.

Number and currency formatting is uniformly broken for non-US locales. `lib/utils.ts:10-36` defines four `Intl.NumberFormat("en-US", …)` instances with hardcoded locale and `"USD"` currency. The helpers `formatCurrency`, `formatPercent`, and `formatNumber` are called from 50 files (265 sites) across charts, panels, dashboards, and tables. A Spanish reader sees `$1,234.56` and parses the comma as a thousands separator that in their convention means a period — in other words, a number off by roughly 10³ at a glance. Percent sign spacing (`1.23%` vs `1,23 %`) and negative-sign placement are also wrong.

Dates fare no better: ten `Intl.DateTimeFormat("en-US", …)` sites render month and weekday names in English (`PnlCalendar`, `PnlCalendarMini`, `MorningBrief`, `marketHours`, `pipeline/page`, the always-visible `useDeskClock`). Plurals are hand-rolled with `"s"` suffix concatenation (`ActivityFeed.tsx:339`); `Intl.PluralRules` isn't used. Custom `$`+`toFixed(2)` string-building (`ActivityFeed.tsx:183,195,205`, `PnLNumber.tsx:45`) bypasses `Intl` entirely and can't be fixed without refactor. No `dir` attribute, so RTL locales (ar/he/fa) would render ltr. Recommendation: adopt `next-intl` with `next.config` locale routing, replace hardcoded locales with a single `getLocale()` helper, and remove all `toFixed` / `$`-concat from user-visible strings.
