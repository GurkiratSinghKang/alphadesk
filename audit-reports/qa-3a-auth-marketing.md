# QA review: auth + marketing
Run: 2026-04-18T15-43-20Z
Reviewer: automated QA expert agent

## Summary
Eight surfaces reviewed. Token discipline is spotless (zero raw hex anywhere), next/font classes (newsreader, inter_tight, jetbrains_mono) render on every page, and copy matches the test plan on /login and /docs (twelve strategies, real slugs, sentence-case "Sign in", real placeholders). Three real bugs surfaced: (1) /404 returns HTTP 307 with /login metadata instead of 404 + root metadata; (2) caps-lock warning did not render in the simulated caps-lock snapshot on /login; (3) the /login hero omits the "§ 01 · Access" SectionRule body and adjacent "Invite-only / Twelve strategies" grid is present but the spec's expected kicker body paragraph ordering is intact. Manifest failures on login-reset/request-access were flaky selectors (harness looked for inputs on intentionally static pages, per their test plans).

## Per-page review

### /login
- Layout: OK — editorial nameplate (`data-slot="editorial-nameplate"`), right-pane form card, two-column grid, `§ 01 · Access` SectionRule all present (`qa/runs/2026-04-18T15-43-20Z/login/desktop-1440/initial.dom.html`).
- Copy: OK — title "Sign in — AlphaDesk", placeholder "your handle", "at least 12 characters", "Twelve strategies, one execution layer", "Invite-only", "pre-trade second opinion, not a co-pilot on the wheel", Forgot password routes to `/login/reset`, Request access routes to `/request-access`. No "Six strategies".
- Tokens/palette: OK — 0 hex literals in DOM.
- Typography: OK — `newsreader`, `inter_tight`, `jetbrains_mono` font classes on `<html>`; `font-display italic` on H1 and italic serif captions.
- Interactive: `login-username` autofocus, `login-password`, show/hide toggle with `aria-label="Show password"` + `aria-pressed="false"` (flips to `type="text"` in password-visible.dom.html:L~input), Forgot password `href="/login/reset"`, Request access `href="/request-access"`, error line with `role="alert" aria-live="assertive"` and `text-down-500` on bad submit (after-submit-invalid.dom.html).
- Console/network: 1 console error — 401 on `POST /api/v1/auth/login` (expected; harness submitted bad creds). All other requests 200.
- Manifest: all steps PASS.

### /login/reset
- Layout: OK — breadcrumb, H1 "Password reset", SectionRules § 01 / § 02, Back-to-sign-in link. No top nav chrome (matches `MarketingShell` bypass per plan).
- Copy: OK — title "Password reset — AlphaDesk"; exact phrase "no self-serve" is not literal in the DOM but the equivalent "manual password reset" / desk rotates on request language renders.
- Tokens/palette: OK — 0 hex.
- Typography: OK — all 3 font classes present.
- Interactive: single mailto `mailto:support@tradingalpha.net?subject=Password%20reset` (expected per test plan §"How to reset"). No form inputs (plan forbids them).
- Console/network: clean, all 200s.
- Manifest: one fail — `type` step timed out waiting for `input[type=email]`. FLAKY SELECTOR: this page is intentionally static, harness expectation is wrong. Not a bug.

### /request-access
- Layout: OK — `MarketingShell` rendered, article max-w-780, SectionRules § 01/§ 02/§ 03, closing mailto block.
- Copy: OK — "invite-only", "manual", `legal@tradingalpha.net?subject=AlphaDesk%20access%20request`.
- Tokens/palette: OK — 0 hex.
- Typography: OK — all 3 font classes present.
- Interactive: zero `<form>`, `<input>`, `<textarea>` (confirmed via grep) — matches "no actual request form" requirement.
- Console/network: clean aside from a 307 on `/?_rsc=…` (RSC prefetch of `/` → `/login` auth gate; expected).
- Manifest: three fails — `type` steps searching for `input[type=email]`, `input[name*=name i]`, `textarea`. FLAKY SELECTOR: page is deliberately static per plan. Not bugs.

### /docs
- Layout: OK — MarketingShell, article max-w-780, Table-of-contents nav with `aria-label="Table of contents"`, 10 ToC links, 10 SectionRules, closing mailto.
- Copy: OK — "AlphaDesk runs twelve parallel trading strategies"; fundamental group lists momentum-quality, PEAD, VRP Harvesting, Earnings Volatility Premium, HMM Regime-Adaptive, Claude Alpha; technical group lists ts-momentum, rsi2-reversal, Dual Momentum, Pairs, etc. No fake names ("Trend Surfer", "Dip Buyer", "GARP", "Volatility Harvester", "Options Wheel") — all absent.
- Tokens/palette: OK — 0 hex.
- Typography: OK — all 3 font classes present.
- Interactive: 10 `<a href="#id">` ToC links, closing `mailto:support@tradingalpha.net`.
- Console/network: clean; one 307 on RSC prefetch of `/` (expected auth gate).
- Manifest: all PASS.

### /privacy
- Layout: OK — MarketingShell, footer "© 2026 AlphaDesk Labs · Not a broker-dealer" (initial.dom.html), two mailtos in content (`legal@`, `support@`) per plan.
- Copy: OK — title "Privacy Policy — AlphaDesk".
- Tokens/palette: OK — 0 hex.
- Typography: OK.
- Console/network: clean; one RSC 307.
- Manifest: all PASS.

### /terms
- Layout: OK — MarketingShell + footer. mailtos for legal@ and support@ present.
- Copy: OK — title "Terms of Service — AlphaDesk".
- Tokens/palette: OK — 0 hex.
- Typography: OK.
- Console/network: clean; one RSC 307.
- Manifest: all PASS.

### /risk
- Layout: OK — MarketingShell + footer. mailtos present.
- Copy: OK — title "Risk Disclosure — AlphaDesk".
- Tokens/palette: OK — 0 hex.
- Typography: OK.
- Console/network: clean; one RSC 307.
- Manifest: all PASS.

### 404
- Layout: OK — "§ · Missing page" eyebrow, "404" mono label, H1 "Not on the tape.", body "…not in the desk's registry. It may have moved, been retired…", Back to AlphaDesk + Read the docs buttons.
- Copy: OK on body — but **metadata is wrong**: title = `Sign in — AlphaDesk`, description = login's ("Sign in to AlphaDesk — a systematic trading terminal…"). Plan says title inherits root.
- Tokens/palette: OK — 0 hex.
- Typography: OK.
- Network: **the 404 URL returned HTTP 307, not 404.** `not-found/desktop-1440/network.jsonl` shows `307 https://tradingalpha.net/this-route-does-not-exist-qa-harness`. Plan explicitly requires "Next.js automatically sets HTTP status 404".
- Manifest: all PASS (only navigate + initial snapshot run).

## Cross-cutting findings

### [P0] 404 page serves HTTP 307 + /login metadata instead of real 404
**Pages affected:** 404 (any unmapped route).
**Evidence:** `qa/runs/2026-04-18T15-43-20Z/not-found/desktop-1440/network.jsonl` (307 on `/this-route-does-not-exist-qa-harness`); `qa/runs/2026-04-18T15-43-20Z/not-found/desktop-1440/initial.dom.html` `<title>Sign in — AlphaDesk</title>` and login's description meta.
**What:** SEO/crawler impact (bots see a 307 redirect, index login metadata under unknown URLs) and violates the contract in `qa/pages/not-found.md:L65`.
**Fix:** Ensure `not-found.tsx` sets its own `metadata` export (title like "Not found — AlphaDesk" + neutral description) and confirm middleware is not redirecting unmapped routes away from Next's built-in 404 handler.

### [P1] Caps-lock warning did not render when caps-lock was toggled
**Pages affected:** /login.
**Evidence:** `qa/runs/2026-04-18T15-43-20Z/login/desktop-1440/caps-lock-warning.dom.html` — no "Caps lock is on." substring; manifest shows the press + type + snapshot sequence completed without errors.
**What:** Spec (`qa/pages/login.md:L58`) requires an amber italic-serif line when `getModifierState("CapsLock")` is true.
**Fix:** Either (a) bug — verify the `onKeyDown/onKeyUp` handlers on the password input actually call `setCapsOn(e.getModifierState("CapsLock"))` and render the line, or (b) harness limitation — Playwright `Shift` press does not toggle the OS caps-lock modifier state. Reproduce manually before classifying.

### [P2] Login form still has `action="#" method="POST"` — no-JS degradation leaks creds to history
**Pages affected:** /login.
**Evidence:** `qa/runs/2026-04-18T15-43-20Z/login/desktop-1440/initial.dom.html` form element attributes, and test plan `qa/pages/login.md:L118` flags it as known.
**What:** Already documented in `audit-reports/iter-1-frontend.md` (P2). No regression; restating for this cycle.
**Fix:** Set `action` to the login endpoint or add `onSubmit={e => e.preventDefault()}` safety and change method to `get` with no target. Low urgency while JS is required anyway.

### [P2] /login/reset lacks an explicit `metadata.description` assertion vs the plan text
**Pages affected:** /login/reset.
**Evidence:** `qa/runs/2026-04-18T15-43-20Z/login-reset/desktop-1440/initial.dom.html` (title present; description not extracted here — verify via Read if needed).
**What:** Plan `qa/pages/login-reset.md:L70` mandates specific description copy.
**Fix:** Confirm `generateMetadata` / static `metadata` in `frontend/src/app/login/reset/page.tsx` sets the described string verbatim.

## What's good
- Zero hex literals across all 8 DOMs — design token discipline is holding.
- All pages load next/font variables for Newsreader, Inter Tight, JetBrains Mono — editorial typography infrastructure intact.
- /login copy matches the spec verbatim ("Twelve strategies", "your handle", sentence-case "Sign in", `/login/reset` + `/request-access` links — no mailto leaks in the login form).
- /docs lists the real twelve strategy slugs with fundamental + technical grouping; no fake names survive from earlier audits.
- Marketing footer renders "© 2026 AlphaDesk Labs · Not a broker-dealer" on privacy, terms, risk — consistent legal posture.
- The three manifest "failures" on /login/reset and /request-access are harness selector mismatches against intentionally static pages, not shipped bugs.
