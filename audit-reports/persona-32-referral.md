# Persona 32 — Referral / Trial / Self-Serve Onboarding

**Scenario.** A friend sent a "Try AlphaDesk" link. Fresh browser, no account,
no session cookie. Tested: https://tradingalpha.net/, /login, /request-access,
/docs, and the Next.js `proxy.ts` auth gate on `feature/deployment`
(commit `5f57ada`).

**Verdict: the app has no self-serve path.** There is no referral flow, no
trial, no signup, no invite-code redemption, and no conversion funnel from a
"Try AlphaDesk" link. A referred visitor lands on `/login`, cannot create an
account, and is directed to email `legal@tradingalpha.net` for manual review.
The single product surface the visitor can see before credentials is marketing
copy — not the product. For an invite-only desk onboarding "one book at a
time" this is intentional; for a link titled "Try AlphaDesk" it is a dead end.

---

## Findings (max 10)

### 1. "Try AlphaDesk" root URL silently redirects to `/login` — no landing page, no product preview
`curl -I https://tradingalpha.net/` returns `HTTP/2 307 Location: /login`.
`frontend/src/proxy.ts:79-83` treats `/` as a protected dashboard route and
bounces every unauthenticated visitor to `/login` while also clearing the
`access_token` cookie. The referred visitor never sees a home page, a hero, a
screenshot, a pitch, or even the name of the product before being asked for
credentials. There is no `/welcome`, `/tour`, or marketing-style `/` surface
in the app directory (`frontend/src/app/` has no root `page.tsx` outside
`(dashboard)`). **Severity: high (for the referral persona).** Referred traffic
bounces immediately because the URL looks broken — they hit a sign-in wall
for a product they have never seen.

### 2. No signup endpoint exists — the backend has no register route
`backend/api/routes/auth.py` only defines `POST /login`, `POST /refresh`,
`POST /logout` (lines 299, 351, 404). There is no `/register`, `/signup`,
`/accounts`, `/invite/redeem`, or `/trial/start`. The comment at
`auth.py:58` says "Minimum password length when accepting new credentials
(signup, password change, password reset)" but no such endpoint is wired —
the reference is aspirational. The Hetzner/Caddy deployment would 404 any
attempt to POST credentials as a new user. **Severity: informational; the
invite-only model is intentional, but there is no API surface a referral link
could ever hit.**

### 3. No `?ref=`, `?invite=`, or UTM handling anywhere in the codebase
Searched the entire `frontend/src` tree for `\?ref=`, `utm_`, `referral=`,
`invite.code`, `invite.link` — zero matches outside
`request-access/page.tsx:48` ("How you heard about the desk, if through a
referral") which is prose inside a mailto-able form. The only `invite`
string in the codebase is the marketing label "Invite-only" on the login
page (`frontend/src/app/login/page.tsx:70`). A friend sharing
`tradingalpha.net?ref=abc` is indistinguishable from organic traffic — no
attribution, no preserved-through-login parameter, no landing banner.
**Severity: medium.** If referrals are ever a growth lever, the plumbing
does not exist.

### 4. `/request-access` is not a form — it is an email instruction page
`frontend/src/app/request-access/page.tsx:72` wires the only CTA to
`mailto:legal@tradingalpha.net?subject=AlphaDesk%20access%20request`. There
are no input fields, no captcha, no rate limit, no backend receiver. A
referred visitor must leave the site, open their mail client, compose a
note including "name, firm or context, jurisdiction… AUM, instruments…
live or paper", and wait "a few days" (the page's own copy at lines
56-66). The page explicitly warns "There is no queue jump" even for
referrals. **Severity: high (for the referral persona).** The "friend sent
me" signal carries zero weight in the intake — the process is identical to
a cold email. A referral code would at least tell the desk who vouched; the
flow throws that information away.

### 5. There is an in-app onboarding tour, but only post-authentication
`frontend/src/components/layout/OnboardingTour.tsx` mounts a 5-step spotlight
tour (Welcome → Strategies → Chart → Order Bar → Command Palette) on first
visit, keyed by `localStorage["alphadesk-tour-complete"]` /
`"alphadesk.onboarding_dismissed"`. It runs inside `DashboardLayout` at
`frontend/src/app/(dashboard)/layout.tsx:10`, which sits behind the auth
gate. A referred visitor without credentials will never see it. The tour is
also under 90 words of body copy — it describes UI chrome, not value
proposition. **Severity: medium.** A well-built onboarding exists but is
walled off behind the login that the user cannot pass.

### 6. Login page is the closest thing to a product pitch — and it fights the visitor
`frontend/src/app/login/page.tsx:51-59` and `64-87` do carry product copy:
"A systematic trading terminal", "Trade with the patience of capital",
"Twelve strategies, one execution layer", "Invite-only — Book access is
granted by the desk, not by form." This is the only pitch any pre-auth
visitor sees. It is dense, editorial, and deliberately exclusionary — the
opposite of a "try it now" affordance. There is no screenshot, no video, no
sample data, no guest mode, no demo button. **Severity: medium.** The copy
is strong for a high-intent visitor but offers nothing to a casual one
arriving from a friend's text.

### 7. Login form has client-side lockout (5 failures in 10 min) that a curious referral can trigger in seconds
`frontend/src/app/login/_login/LoginForm.tsx:29-31` and `121-178`: five
failed `POST /api/v1/auth/login` attempts inside a 10-minute window disable
the submit button with a `localStorage`-persisted countdown. The backend
also rate-limits by IP at 5/5-min (`auth.py:112-113`). A referred visitor
guessing "try it" / "demo" / a few passwords to feel out the product gets
locked out in under a minute and sees the editorial dead-end
`/login/reset` page, which itself only offers another `mailto:` to
`support@tradingalpha.net`. **Severity: low-medium** (security-correct,
but amplifies the dead-end feel for an exploratory visitor).

### 8. `/login/reset` admits self-serve reset is not built: "Self-serve reset is not yet wired"
`frontend/src/app/login/reset/page.tsx:42-45` literally says "Self-serve
reset is not yet wired. Until it is, the desk rotates passwords by hand on
request." The only action is `mailto:support@tradingalpha.net`. Combined
with finding 4 (request-access is a mailto), finding 7 (easy lockout), and
finding 2 (no signup endpoint), *every* auth recovery path terminates in a
human-email handoff. **Severity: medium.** For a 2026 web app this reads
as unfinished rather than exclusive — the word "yet" concedes the roadmap.

### 9. No trial, no demo, no guest, no sample workspace
Grep across `frontend/src` and `backend` for `trial`, `demo`, `guest`,
`sample`, `sandbox` returns no matches that refer to a user-facing entry
path (only `5-trial Optuna tuning` in strategy parameter docs and the word
`sample` in data-provider code). There is no read-only public demo of the
dashboard, no screenshot gallery on `/docs`, no "preview the terminal" CTA,
no time-boxed trial account. A curious visitor has precisely two options:
(a) leave, (b) email the desk and wait days. **Severity: high** (for a
referral flow — "Try AlphaDesk" implies a try, which the product does not
offer).

### 10. `/docs` is public and explains itself fast — the only pre-auth surface that actually does
`frontend/src/app/docs/_docs/content.ts` has 8 sections (Getting Started,
Dashboard, Trading, Strategies, Pipeline, Keyboard Shortcuts, How Claude
Works, …) and the proxy allows `/docs` unauthenticated (`proxy.ts:38-44`).
Copy is crisp — "AlphaDesk runs twelve parallel trading strategies…" at
content.ts:49 — and covers Cmd+K, the strategy registry, the pipeline
model. **BUT** nothing on /request-access, /login, or the 72px nav
*points* a curious visitor to /docs as "read this first". The footer lists
Docs under "Product" but the login page does not link it inline, and the
request-access page does not reference it at all. **Severity: low-medium.**
The one surface that could orient a referred visitor in 60 seconds is
present but not surfaced in the paths they actually take.

---

## 250-word summary

A friend's "Try AlphaDesk" link is a dead end. The root URL redirects
unauthenticated visitors straight to `/login` (no landing page, no hero, no
demo); the backend has no signup endpoint, no invite-code redemption, no
trial path. There is no `?ref=` / `?invite=` handling anywhere in the
codebase — referral attribution literally cannot survive the redirect. The
`/request-access` page is a mailto to `legal@tradingalpha.net` with a
queue-jump disclaimer and a warning that responses take "a few days". The
`/login/reset` page admits password reset is "not yet wired" and offers
another mailto. Five failed login guesses lock the visitor out for 10
minutes via `LoginForm.tsx` plus a matching server-side IP rate limit.

A real 5-step onboarding tour exists (`OnboardingTour.tsx`) and a real docs
site exists (`/docs`, 8 sections, public), but the tour lives *behind* the
auth gate and the docs are never linked from the flows a referred visitor
actually hits. Only the login page itself carries product copy ("Twelve
strategies, one execution layer", "patience of capital") — dense editorial
marketing that deliberately gates rather than invites.

This is internally consistent with an invite-only desk onboarding "one book
at a time". It is also, for a link titled "Try AlphaDesk", a wasted
referral: the friend's endorsement converts to an inbox-wait with no
attribution, no preview, and no signal that the visitor was vouched for.
The product's positioning and the user's expectation diverge at the very
first click.
