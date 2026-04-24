# Persona 8 — Security Researcher

**Profile:** Authenticated app testing. Looking for AuthZ bypass, CSRF, XSS, header weakness, info leak.

## Good news (positive findings)

- **TLS:** HSTS `max-age=31536000; includeSubDomains; preload` ✓
- **CSP:** Present, default-src 'self', frame-ancestors 'none' ✓ (caveat below)
- **X-Frame-Options:** DENY ✓
- **X-Content-Type-Options:** nosniff ✓
- **Permissions-Policy:** camera, mic, geolocation all denied ✓
- **Referrer-Policy:** strict-origin-when-cross-origin ✓
- **Auth cookies:** `HttpOnly; Secure; SameSite=strict` on access + refresh ✓
- **Refresh cookie scoped to `/api/v1/auth`** — narrows blast radius ✓
- **All API routes return 401 unauthenticated** (positions, summary, strategies, market quotes) ✓
- **JWT alg:none rejected** — no JWT-confusion bug ✓
- **Login rate-limit kicks in at 6th attempt** (429) ✓
- **CORS preflight from `https://evil.com` rejected** — no `Access-Control-Allow-Origin` echoed back ✓
- **Path traversal (`/api/v1/market/quotes/../../../etc/passwd`)** → 404 ✓
- **Symbol field XSS payload** sanitized → 422 reject ✓

## Bugs found

### P1-SEC-1: CSP allows `'unsafe-inline'` for both `script-src` and `style-src`
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' …`
- `'unsafe-inline'` for scripts disables the strongest XSS mitigation CSP provides. If an XSS gets in (e.g., via a future user-content field), CSP won't block the inline payload.
- **Fix:** Move to nonce-based CSP (Next.js supports this) or hash-based CSP for the inline scripts that ship with Next.

### P2-SEC-2: Login response body includes `access_token` and `refresh_token` as JSON in addition to setting HttpOnly cookies
- For the browser flow this is redundant and risky — if frontend ever stores the JSON token in `localStorage` (an XSS exfil target), the HttpOnly attribute on the cookie no longer matters.
- **Fix:** For browser sessions, only set the cookie. Reserve the JSON body tokens for non-browser clients via a separate endpoint (e.g., `/api/v1/auth/cli-login`) or content-negotiate by `Accept` / a header flag.

### P2-SEC-3: `X-XSS-Protection: 1; mode=block` is set
- This header is deprecated and on Edge/Chrome was a known XSS-amplifier vector (browser-side filter could be tricked into blocking benign content or leaking content). Modern guidance: `X-XSS-Protection: 0` or omit entirely.

### P2-SEC-4: No `/.well-known/security.txt`
- Researchers can't find a contact channel to report finds. Add `/.well-known/security.txt` with `Contact: mailto:security@tradingalpha.net`.

### P2-SEC-5: `robots.txt` says `Disallow: /api/` — fine — but no rate-limit clearly visible on data routes
- After login, polling `/api/v1/market/quotes/SPY` repeatedly never throttled in my session. If quote fetches are unmetered authenticated, an account compromise → API-key-style abuse is possible.
- **Suggest:** Per-user rate-limit on quote endpoints (e.g., 30/sec).

### P2-SEC-6: Order POST endpoint reveals the schema in 422 errors
- POST `/api/v1/trades/orders` with `{symbol, qty, side, type}` returns `{"detail":[{"type":"missing","loc":["body","legs"],"msg":"Field required","input":{…}}]}` — disclosing that the real shape uses `legs` (multi-leg orders, options-style).
- Acceptable for an API where the frontend is the canonical client; just be aware that anyone reading 422s can derive the schema.

### P2-SEC-7: Sitemap exposes only `/` and `/login` but the app has a much larger surface
- Not a vulnerability per se, but the sitemap is misleading and unhelpful.

### P3-SEC-8: `via: 1.1 Caddy` header leaks the reverse proxy
- Minor info leak. Suppress or rename.
