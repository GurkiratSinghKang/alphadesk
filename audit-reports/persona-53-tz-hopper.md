# Persona 53 — The TZ Hopper (SFO → NYC → LHR)

Scope: how the app behaves for a user whose browser timezone flips weekly across PST (-08/-07), EST (-05/-04), and GMT/BST (+00/+01). Baseline: Wave 13 already migrated `PnlCalendar`/`PnlCalendarMini` to ET via `Intl.DateTimeFormat("en-US", {timeZone: "America/New_York"})`. Market-hours helper (`marketHours.ts`) and the desk clock label also pin to ET. Everything below is the remaining surface where local-tz assumptions leak through.

---

## Findings (severity · area · location)

### 1. [HIGH] Backend P&L calendar buckets by server-local `date.today()` — not ET
`backend/api/routes/portfolio.py:828,855` (`get_pnl_calendar`) calls `date.today()` to compute the "today" injected for open-position unrealized P&L, and `day_str = exit_time[:10]` to bucket closed trades. `exit_time` is stored as `TIMESTAMPTZ` by `trade_ledger.py:470,609` (`datetime.now(timezone.utc).isoformat()`), so `exit_time[:10]` is a **UTC** calendar day, not ET. A trade exited at 21:30 ET (02:30 UTC next day) lands on tomorrow's bucket. The frontend Wave-13 ET highlight will look correct, but the data it highlights is UTC-bucketed. This is independent of the traveling user and affects every user.

### 2. [HIGH] `TradingChart` renders candles in UTC, not ET
`frontend/src/components/charts/TradingChart.tsx` (lines 1–630, searched — no `timezone`/`localization` configuration). Lightweight-charts defaults to UTC when no `timeScale.timeVisible`/`localization.timeFormatter` is set. The x-axis 09:30 mark lands at 14:30 for a SFO user and 14:30 for a LHR user alike, but LHR sees a 4h-offset label mismatch against the "Pre/Open/Post" pills that speak ET. No automatic shift as the user flies.

### 3. [HIGH] `MorningBrief.getGreeting()` uses `getHours()` (local browser tz)
`frontend/src/components/dashboard/MorningBrief.tsx:13-17`. When the SFO user opens the app at 06:00 PT (09:00 ET, market about to open) they get "Good morning". After they fly to LHR and open at 07:00 BST (02:00 ET, pre-market) they *also* get "Good morning" — but the market pill says "Closed". Minor UX mismatch; not a trading bug.

### 4. [HIGH] `MorningBrief.getDismissKey()` is local-day, not ET-day
`MorningBrief.tsx:50-53` builds `alphadesk-brief-dismissed-YYYY-MM-DD` from `getFullYear()/getMonth()/getDate()`. A user who dismisses the brief at 23:30 PT Sunday (02:30 ET Monday — Monday's trading day) and boards a flight will find the brief reappear on the plane when the browser tz flips to EST, because the local-date key regenerates for a "new day". The cleanup loop (MorningBrief.tsx:70-83) further removes the stale Sunday key the moment local date changes mid-session, so reload on the plane shows the brief again.

### 5. [HIGH] `ActivityFeed` "Today" badge & `formatTime` bucketing use local date
`frontend/src/components/dashboard/ActivityFeed.tsx:86-103,314-324`. `formatTime` picks between a time-only label ("09:31 AM") and a date-stamped label based on `getFullYear/Month/Date` comparison against `new Date()` — all local. Mid-flight over the Atlantic, items accumulated during the last SFO session (timestamp persisted with `new Date(order.timestamp)`) suddenly render their dates instead of times (or vice versa) because "today" shifted under them. Badge flips between "Today" and "Apr 17" on the same dataset depending on where you landed.

### 6. [HIGH] Report range cutoffs drift by up to 24h
`frontend/src/app/(dashboard)/reports/page.tsx:25-36` (`rangeCutoff`) and `frontend/src/components/dashboard/PortfolioHero.tsx:22-45` and `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:155-177` all build cutoffs with `new Date(now.getFullYear(), 0, 1)` / `setDate(now.getDate() - N)`. In LHR the "YTD" cutoff is `2026-01-01T00:00:00+01:00` — which rules in/out any trade whose UTC exit straddles that boundary. "1W" cuts off exactly 7×24h before local midnight, shifting ±3–8h vs. a US user's expectation. The mini-calendar is ET-correct, the report table is local-tz.

### 7. [MEDIUM] CSV export filenames use `toISOString().slice(0,10)` (UTC day)
`reports/page.tsx:162,402`, `TradePanel.tsx:1200`, `settings/page.tsx:204,240,274,300`, `ExportButton.tsx:47,80`. Downloading at 22:00 ET (03:00 UTC) produces a file named for tomorrow; a user downloading in LHR at 08:00 BST and again at 23:00 PT sees two files with the same UTC date and the later one silently overwrites the earlier. Also `ExportButton.tsx:47` emits `entry_time` ISO-sliced to UTC day in the CSV column itself — downstream accountants reading the CSV in a different tz can't reconcile it to a broker statement bucketed by ET.

### 8. [MEDIUM] `PnlCalendarMini.firstDay` / `daysInMonth` built with local-tz `Date` constructor
`frontend/src/components/dashboard/PnlCalendarMini.tsx:68-69`. `new Date(year, month-1, 1).getDay()` builds a *local-tz* midnight then reads its weekday. For 1 April 2026 this is always Wednesday regardless of tz, so the specific bug rarely fires, but a user in UTC+13 (not a tz hop on the travel itinerary but relevant for the helper's correctness) around month boundaries can see the grid start on the wrong weekday relative to the ET-resolved month label rendered on line 71.

### 9. [MEDIUM] `generateExpirations()` computes weekend/market-close in local tz
`frontend/src/components/panels/OptionsPanel.tsx:43-70`. `d.setHours(16,0,0,0)` treats "market close" as 16:00 *local*, not ET. For the LHR user at 15:30 BST (10:30 ET, market not yet open), the helper already considers today past close and drops this Friday from the chain. Worse: `d.getDay()` is local — Friday in Tokyo (UTC+9) at 03:00 is still Thursday in New York, so the next-Friday walk misaligns with the exchange calendar for any user east of UTC for a few hours after midnight local.

### 10. [LOW] Trade-journal `startOfWeek`/`startOfMonth` use local midnight
`frontend/src/components/panels/TradePanel.tsx:995-1039` (`JournalStats`). `startOfWeek.setDate(now.getDate() - now.getDay()); setHours(0,0,0,0)` anchors at local Sunday 00:00, and `startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)`. On a Monday 09:00 ET = Sunday 05:00 PT flight, a note timestamped 07:00 ET Monday (03:00 PT, still "Sunday" in PT local) falls *outside* "this week" for the SFO-tz user. Day-of-week buckets on lines 1027-1039 suffer the same drift. Also `reports/page.tsx:472` classifies `exit_time` year via `new Date(t.exit_time).getFullYear()` — a December-31 23:30 ET exit shows up in next year's tax report when the user opens it from LHR in January.

---

## Summary (≤250 words)

Wave 13 fixed the two most visible symptoms — `PnlCalendar` and `PnlCalendarMini` now resolve "today" and the visible month through `Intl.DateTimeFormat("en-US", {timeZone: "America/New_York"})`, and `marketHours.ts` + `useDeskClock` pin labels to ET. The core gap is that the fix stopped at the calendar component. Every other surface that turns a point-in-time into a calendar bucket still asks the browser for local date parts.

Concretely for a user flying SFO → NYC → LHR each week: (a) the **backend** calendar endpoint buckets by server `date.today()` and a `TIMESTAMPTZ` ISO prefix that is UTC, so the data behind the ET-correct highlight is itself mis-bucketed for any trade executed 20:00–23:59 ET — independent of the traveler and affects everyone; (b) the **TradingChart** has no timezone configuration, so lightweight-charts renders in UTC and every traveler reads a different offset against the ET "Open/Closed" pills; (c) `MorningBrief` greeting and dismiss key, `ActivityFeed` "Today" badge, `Reports` period cutoffs (`PortfolioHero` and strategy detail too), CSV export filenames, options-expiration Friday walk, and trade-journal week/month buckets all key off `getHours/getDay/getDate`. The practical fault is state that flips mid-session as the browser tz changes — dismissed briefs resurrect, "Today" labels move on unchanged data, YTD windows shift, and tax-year classification of the Dec-31 late-exit flips to the next year when the user opens the report from London in January.

Recommended direction: introduce a single `etDateParts(now)` helper in `lib/` and route every "today/this-week/this-month" comparison through it; add `localization.timeFormatter` to `TradingChart`; switch the backend calendar to `ZoneInfo("America/New_York")` before `isoformat`-slicing `exit_time`.
