# Persona 18 — Sydney Night-Owl Trader

**Persona:** Retail swing trader in Sydney (AEST, UTC+10/+11). US cash
session opens 11:30 PM local, closes 6:00 AM. Every ET-vs-local
ambiguity is cognitive tax at 11 PM.

**Probes:** `/api/v1/market/market-status` 401 without auth; admin
password unavailable. Report is static analysis of the brief's focus
files plus grep-surfaced consumers.

## Top 10 International/Timezone Bugs (~350-word summary)

1. **`useDeskClock` labels local wall-clock as "ET".**
   `useDeskClock.ts:17-31` uses `toLocaleTimeString("en-US")` with no
   `timeZone: "America/New_York"`, then concatenates " ET". Shows
   "22:47 ET" when it's 08:47 ET. Own comment admits "full TZ
   formatter lands in F4". Highest priority.

2. **No timezone preference exists.** `stores/preferences.ts` has
   no `timezone` field. User cannot request ET+Local dual display.

3. **No time-based alert scheduling.** `alerts/page.tsx` models only
   price alerts — no "ping me at US open" primitive anywhere.

4. **`ActivityFeed` "Today" badge uses browser-local day.**
   `ActivityFeed.tsx:313-323` compares `getFullYear/Month/Date` in
   local tz. Sun-night ET events show "Apr 20", not "Today", from
   Syd Mon morning.

5. **Pipeline page `isToday` uses browser-local day.**
   `pipeline/page.tsx:125-126` builds `today` from local date parts,
   compares to `run.date`. Syd morning mislabels a live ET run.

6. **"Next scheduled run" printed via `toLocaleString()` — no tz
   label.** `pipeline/page.tsx:704`. Renders a UTC ISO in Sydney tz
   with no marker; neighbouring copy says "09:30 ET" — contradiction.

7. **"Today 09:30 ET" branch fires when Syd date ≠ ET date.**
   `nextTradingSessionLabel()` at `pipeline/page.tsx:62-82` reads
   ET weekday correctly but says "Today 09:30 ET" on Syd Sun at
   10 PM — the bell is *tonight* locally, not "today".

8. **`MorningBrief` greeting from local hour.** `MorningBrief.tsx:13-17`
   uses `getHours()`. Sydney trader at 11 PM local (ET pre-market)
   gets "Good evening" instead of "Good morning, pre-market".

9. **Dismiss key scoped to local day.** `MorningBrief.tsx:50-53` key
   is `alphadesk-brief-dismissed-YYYY-MM-DD` in local parts.
   Dismiss at 23:55 Syd, 5 min later the key changes and the brief
   re-appears mid-session prep.

10. **Trade/order/tax tables lack tz markers.**
    `trade/page.tsx:227` (`toLocaleTimeString()`),
    `reports/page.tsx:620` (`toLocaleDateString()`),
    `ActivityFeed.tsx:84-104`, `pipeline/page.tsx:558`
    (`lastRun.toLocaleString()`). All render in browser tz with no
    "ET"/"AEST" suffix — ambiguous in tax reports and order audits.

## What the codebase got right

- `lib/marketHours.ts` and `PnlCalendarMini.tsx` use the canonical
  `Intl.DateTimeFormat(..., {timeZone: "America/New_York"})` +
  `formatToParts` idiom. Adopt this everywhere.
- `backend/data/ingestion/pipeline_runner.py` is fully ET-aware
  (`ZoneInfo`, `USMarketCalendar`), honours US holidays and
  half-days (`_close_window_target`), crosses DST correctly.
  Scheduler cron semantics are sound — all remaining bugs are
  client-side presentation.
- `PnlCalendar.tsx` + `PnlCalendarMini.tsx` carry the ET-vs-local
  trap as inline comments. `TickerTape` shows no "market closed"
  string, so no wrong-tz message there.

## Remediation sequence

1. Fix `useDeskClock` — render `HH:mm:ss ET · HH:mm Local` in the
   top-bar. Most-read clock in the app.
2. Add `timezone` to `preferences.ts` ("auto" | "America/New_York")
   and route through `formatTime/formatDate/formatDateTime` in
   `lib/utils.ts`.
3. Replace the eight browser-local `new Date()` day constructions
   flagged above with the `getETDateParts()` helper already in
   `PnlCalendarMini`.
4. Add "market open/close" templates to Alerts — server already
   knows ET via the scheduler; huge UX win for non-US users.
