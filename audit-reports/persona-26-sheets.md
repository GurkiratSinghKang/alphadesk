# Persona 26 — Google Sheets integration

**Goal:** pull AlphaDesk positions/trades into a spreadsheet via `IMPORTDATA` (or Apps Script) without writing an app.
**Tested against:** https://tradingalpha.net (prod) on 2026-04-18, admin credentials.

## Findings (10)

| # | Finding | Evidence |
|---|---|---|
| 1 | **No server-side CSV anywhere.** Every endpoint returns JSON. `text/csv` content negotiation is ignored. | `GET /api/v1/trades/history` with `Accept: text/csv` → `HTTP 200, Content-Type: application/json` (payload identical to plain JSON call). Same for `/trades/positions`, `/portfolio/summary`. |
| 2 | **All guessed CSV routes 404.** Probed `/trades/export`, `/trades.csv`, `/export/trades.csv`, `/positions.csv`, `/portfolio/positions.csv`, `/portfolio/summary.csv` → every one `404`. Matches persona-15-historical finding #5. | `/usr/bin/curl -w %{http_code}` sweep. |
| 3 | **CSV is 100% client-side.** `frontend/src/components/dashboard/ExportButton.tsx` fetches JSON via `getTradeHistory(1000)`, builds CSV in-browser with a `Blob`. Same pattern in `reports/page.tsx:41` and `settings/page.tsx:269`. The backend has zero knowledge CSV is being produced. | Read of `ExportButton.tsx` lines 14–84. |
| 4 | **`IMPORTDATA` is impossible as-is.** Google's `IMPORTDATA(url)` cannot set headers, so it cannot attach `Authorization: Bearer …`. Every AlphaDesk endpoint requires the bearer (anonymous call → `HTTP 401`). There is **no query-param token fallback** (`?token=`, `?access_token=`, `?api_key=`, `X-API-Key` header all → 401). | Tested against `/trades/history`. |
| 5 | **Tokens last 8 hours.** JWT `exp` is `login_time + 28800s`; refresh token is 30 days but still a POST-only flow. So even if IMPORTDATA could pass a header, the user would re-paste a token three times a day. | `/auth/login` response `expires_in: 28800`; decoded `exp` field. |
| 6 | **OpenAPI spec is disabled in prod.** `/api/v1/openapi.json` → `404`, so no auto-generated Sheets connector, and "Swagger → export" workflows are dead. | `curl /openapi.json → 404`. |
| 7 | **No CORS headers** on API responses (`Access-Control-Allow-Origin` absent). Sheets' `IMPORTDATA`/`IMPORTXML` don't need CORS, but anyone trying a client-side Apps Script HtmlService fetch from an `apps.google.com` origin would be blocked. Server-side `UrlFetchApp` bypasses CORS, so this only hurts browser-based add-ons. | `curl -I` header dump. |
| 8 | **The only viable "non-dev" path is Apps Script with `UrlFetchApp`.** ~40 lines: login → store token in `PropertiesService` → fetch `/trades/history` and `/trades/positions` → `JSON.parse` → `setValues()`. Set a time-driven trigger to re-login every 6 h. This is the standard pattern for any JWT-only API. | Architecture synthesis. |
| 9 | **Useful endpoints available** (all JSON, bearer-auth): `GET /api/v1/trades/positions` (open positions), `GET /api/v1/trades/history?limit=1000` (closed trades — has `symbol, side, quantity, entry_price, exit_price, pnl, pnl_pct, entry_time, exit_time, status, strategy`), `GET /api/v1/portfolio/summary`, `GET /api/v1/portfolio/performance`, `GET /api/v1/risk/dashboard`. | `backend/api/routes/*.py` router decorator scan. |
| 10 | **Recommended backend fix (tiny):** add `GET /api/v1/export/trades.csv` and `/export/positions.csv` that reuse the existing list queries with a `StreamingResponse`, plus a long-lived **personal API key** (header *or* `?key=…`) issued from the Settings page. Then a one-line `=IMPORTDATA("https://tradingalpha.net/api/v1/export/trades.csv?key=XXX")` works with zero code. ~60 lines of FastAPI, unblocks every non-dev integration (Sheets, Excel PowerQuery, Zapier, Notion). | Feature recommendation. |

## TL;DR for the non-dev user
1. **Today:** paste the Apps Script below into *Extensions → Apps Script*, replace username/password, run `refreshAlphaDesk()`. Schedule it every 6 h.
2. **IMPORTDATA does not work** and will not work until the backend ships `/export/*.csv` + an API-key mechanism (finding #10).

### Minimal Apps Script (~35 lines)
```js
const BASE = 'https://tradingalpha.net/api/v1';
const USER = 'admin', PASS = 'xxx';
function refreshAlphaDesk() {
  const login = UrlFetchApp.fetch(BASE + '/auth/login', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ username: USER, password: PASS }),
  });
  const token = JSON.parse(login.getContentText()).access_token;
  const opts = { headers: { Authorization: 'Bearer ' + token } };
  const trades = JSON.parse(UrlFetchApp.fetch(BASE + '/trades/history?limit=1000', opts).getContentText());
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Trades') ||
                SpreadsheetApp.getActiveSpreadsheet().insertSheet('Trades');
  sheet.clear();
  if (!trades.length) return;
  const cols = Object.keys(trades[0]);
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  sheet.getRange(2, 1, trades.length, cols.length).setValues(
    trades.map(t => cols.map(k => t[k] ?? ''))
  );
}
```
