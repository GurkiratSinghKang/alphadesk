# Persona 34 — Financial Journalist

**Audit date:** 2026-04-18
**Persona:** Financial journalist writing a story on AlphaDesk. Looking for publicly verifiable data: strategy performance, methodology, terms of service, people/company, pricing.
**Tested URLs:** `/` (→ redirects to `/login`), `/docs`, `/privacy`, `/terms`, `/risk`, `/request-access`, plus `/robots.txt`, `/sitemap.xml`, and spec-checks on `/pricing`, `/about`, `/blog`, `/team`.
**Test method:** Unauthenticated `curl` requests from a clean session; rendered HTML parsed for user-visible copy.

---

## Headline: Is the public marketing surface enough to form a story?

**Short answer: barely — you can write a "what it is" piece but not a "does it work" piece.** The legal/policy surface is complete and professionally drafted. The performance/proof surface is absent. There is no public AUM, no published track record, no named founder, no firm location, no pricing, no press kit.

---

## Findings (10)

### 1. Homepage is a login wall, not a marketing page
`https://tradingalpha.net/` 302-redirects to `/login`. The "homepage" a casual reader lands on is a sign-in form with a short editorial blurb — *"Trade with the patience of capital"* — and two bullet cards: **Invite-only** and **Twelve strategies, one execution layer**. The meta description is *"Sign in to AlphaDesk — a systematic trading terminal..."*. No hero video, no customer logos, no screenshots, no explainer. `robots: noindex, nofollow` is set on the login page. For a journalist, there is essentially no top-of-funnel marketing surface to quote from.

### 2. Sitemap exposes only two URLs
`/sitemap.xml` lists exactly `https://tradingalpha.net/` and `https://tradingalpha.net/login`. `/robots.txt` allows all, disallows `/api/`. This means the public legal pages (`/docs`, `/privacy`, `/terms`, `/risk`, `/request-access`) are reachable but intentionally undiscoverable via search — unusual for a product trying to attract coverage.

### 3. Product positioning is consistent but thin
Across pages the product is described uniformly: *"a systematic trading terminal for designing, back-testing, and executing systematic equity strategies — with Claude as a pre-trade second opinion, not a co-pilot on the wheel."* OpenGraph title is *"AlphaDesk — AI-Powered Trading Terminal."* The positioning is crisp (Claude is a reviewer, not an autopilot) but there are no case studies, testimonials, or user quotes anywhere public.

### 4. Strategy roster is public, performance is not
`/docs §04` names all twelve strategies by label: **Cross-Sectional Momentum + Quality, PEAD, Systematic VRP Harvesting, Earnings Volatility Premium, HMM Regime-Adaptive Allocation, Claude Alpha** (fundamental/regime) and **TS-Momentum, RSI-2 Reversal, Dual Momentum, Stat-Arb Pairs, KAMA+ATR Breakout, Opening Range Breakout, VWAP Bounce/Breakout** (technical). That is 13 names in the prose for a "twelve strategy" product — a copy inconsistency worth flagging. No return figures, Sharpe ratios, drawdowns, inception dates, or AUM are published for any strategy.

### 5. Methodology section cites academic grounding but no firm specifics
`/docs §08` Strategy Methodology cites **Jegadeesh & Titman (1993)** for momentum, generic academic framing for PEAD and VRP, and says *"each strategy detail page includes full methodology notes and academic citations"* — but those detail pages sit behind the login. Public readers get one paragraph of academic name-drop and a promise that the evidence is inside. A journalist cannot verify the methodology claims from the public surface.

### 6. Legal stack is complete and well-scoped
`/privacy`, `/terms`, `/risk` are all dated **Last updated 2026-04-12** and professionally written. Notable disclosures a journalist can quote verbatim:
  - *"AlphaDesk is not a registered broker-dealer, investment adviser, or financial institution. The platform is a software tool."* (Terms §07, Risk §07)
  - Execution is via **Alpaca Securities LLC (FINRA/SIPC member)**; SIPC protection up to $500k (Risk §09).
  - Arbitration under AAA rules, governed by **Delaware law** (Terms §09–§10).
  - Data processing in the US; GDPR and CCPA rights acknowledged (Privacy §09–§12).
  - **72-hour breach notification** commitment (Privacy §11).
  - API keys stored **AES-256 encrypted at rest** (Privacy §03, Terms §04).
  - AI requests to Anthropic disclosed; the Privacy Policy claims *"No personally identifiable information is included in these requests"* (Privacy §02) — a journalist would want to probe this claim against the product's architecture.

### 7. Risk disclosures are unusually direct for a crypto-era product
`/risk` is blunt: *"Past performance ... is not indicative of future results. Historical backtests and paper trading results do not account for all real-world factors."* It calls out **PDT rule** (§08), **paper-vs-live divergence** (§04), **options premium loss / unlimited loss for naked calls** (§02), and **AI-generated trades carry additional risk of unintended executions** (§06). This is the kind of risk page a compliance-sensitive reporter can quote approvingly — but it also means the product is explicitly *not* claiming any edge in public.

### 8. No pricing, no team, no press kit, no company details
`/pricing`, `/about`, `/blog`, `/team` all return HTTP 200 but render the SPA 404 (*"Not on the tape. The page you requested is not in the desk's registry."*) — these routes simply do not exist. Terms §11 says *"AlphaDesk is currently offered as an invite-only platform at no cost. No refunds or credits apply."* Footer lists the operator as **"AlphaDesk Labs"** (no LLC/Inc. suffix, no state of incorporation, no address). No founder name, no team bios, no LinkedIn link, no GitHub org, no press contact — only `legal@tradingalpha.net` and `support@tradingalpha.net`.

### 9. Access gate is intentional and human-in-the-loop
`/request-access` is deliberately anti-form. It asks for *"name, firm or context, jurisdiction, approximate AUM, instruments, live or paper, and how you heard about the desk"* — and says *"a human reads the request, usually within a few days ... On approval, you receive credentials."* **There is no signup form on the page.** Requests are sent to `legal@tradingalpha.net` via email. This is a strong editorial narrative for a "anti-Robinhood, concierge trading stack" story — but it also means there is no way for a journalist to sign up and test-drive the product.

### 10. Copy leans heavily on "Vol. 01 · Issue 01" editorial framing
Every page is dressed as a financial newspaper: nameplate, ruled sections (*"§ 01 · Access"*), the live-dateline in the header (*"2026-04-19"*), a footer motto (*"α · made with discipline"*), and an italic display face. The voice is consistent and quotable (*"Book access is granted by the desk, not by form"*, *"Same risk policy, same audit trail, different alphas"*, *"There is no queue jump"*). For a features-section write-up this is usable material; for a numbers-driven business story, the absence of AUM, user count, funding disclosure, or performance data is a hard wall.

---

## Story viability verdict

A journalist can write one of two angles from the public surface alone:

- **Angle A — "The anti-Robinhood": viable.** Deliberate invite-only gate, strong risk and legal disclosures, Claude-as-second-opinion framing, and refusal to publish backtested returns is itself the story. All quotes can be sourced from `/docs`, `/terms`, `/risk`, `/request-access`.
- **Angle B — "Does it work?": not viable.** Zero public performance data, no AUM, no audited figures, no named operator, no clients cited. Any claim about strategy efficacy or firm traction requires either the approval email loop or an off-the-record source.

A follow-up email to `legal@tradingalpha.net` asking for founder name, state of incorporation, AUM, and a performance tear-sheet is the minimum required second step before publishing.

---

## Summary (250 words)

AlphaDesk's public marketing surface is deliberately minimal and uniformly editorial. The root URL redirects to a login wall; the sitemap exposes only `/` and `/login`; and `/pricing`, `/about`, `/team`, and `/blog` do not exist (they render the 404 "Not on the tape" page). Reachable public pages — `/docs`, `/privacy`, `/terms`, `/risk`, `/request-access` — are professionally drafted and dated 2026-04-12, with a consistent voice styling the site as a financial newspaper (Vol. 01 · Issue 01, § section marks, italic display type).

From these pages a journalist can reliably extract: product positioning (systematic equity terminal with Claude as a pre-trade reviewer, not an autopilot), the full roster of twelve strategies by name, an academic-research methodology gloss citing Jegadeesh & Titman and the volatility risk premium literature, execution via Alpaca Securities LLC under FINRA/SIPC, Delaware governing law with AAA arbitration, AES-256 API key encryption, GDPR/CCPA acknowledgment, and a 72-hour breach notification commitment. The Risk page is unusually direct — it refuses to claim backtest results predict live performance and flags AI-generated trade risk explicitly.

What is missing blocks a numbers-driven story: no published returns, Sharpe, drawdowns, or AUM; no founder, team, or firm address; no pricing (the platform is free and invite-only per Terms §11); no press kit. The operator is named only as "AlphaDesk Labs · Not a broker-dealer" in the footer, with `legal@tradingalpha.net` as the sole contact. The marketing surface supports a "deliberate, disclosure-first anti-Robinhood" feature, but any claim about performance or traction requires a direct email to the desk.

---

**Files referenced (absolute paths):**
- `/Users/GK/Downloads/alphadesk/audit-reports/persona-34-journalist.md` (this report)
- Fetched HTML cached at `/tmp/alphadesk_{home,docs,privacy,terms,risk,request}.html`

**Public URLs audited:**
- https://tradingalpha.net/ (→ /login, HTTP 200)
- https://tradingalpha.net/docs (HTTP 200)
- https://tradingalpha.net/privacy (HTTP 200)
- https://tradingalpha.net/terms (HTTP 200)
- https://tradingalpha.net/risk (HTTP 200)
- https://tradingalpha.net/request-access (HTTP 200, `noindex, nofollow`)
- https://tradingalpha.net/robots.txt (HTTP 200)
- https://tradingalpha.net/sitemap.xml (HTTP 200; only 2 entries)
- https://tradingalpha.net/{pricing,about,team,blog} (all HTTP 200 → SPA 404)
