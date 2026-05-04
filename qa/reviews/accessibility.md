# Accessibility Audit — AlphaDesk (WCAG 2.1 AA)

**Captured:** 2026-05-03 (run `2026-05-03T23-07-16Z`)
**Reference:** visual-regression measurements from `qa/visual/manifest.json` (older localhost run, but checks unchanged)
**Scope reviewed:** 22 routes × desktop-1440 DOMs + spot-checked mobile-390 DOMs/PNGs for 5 routes.

The app is in significantly better a11y shape than typical product UIs of this complexity: every form input across the eleven authenticated routes has either an explicit `<label for>` or is wrapped in an implicit `<label>`; every icon-only `<button>` (across 20+ routes) carries either `aria-label`, `title`, or visible text after the SVG; every inline SVG has `aria-label` or `aria-hidden`; live regions exist for notifications and login errors. The remaining issues are concentrated in the **public marketing/legal/auth-adjacent pages**, not the trading workspace itself.

## Severity tiers
- **P0** — Blocks users with disabilities entirely
- **P1** — Significant barrier, workaround possible
- **P2** — Polish / nice-to-have

---

## P0 issues

**1. Public/marketing pages render section headings as `<span>` instead of `<h2>` — entire docs/legal hierarchy is invisible to screen-reader heading navigation.**
- Affected routes: `/about`, `/contact`, `/docs`, `/help/earnings-data`, `/login/reset`, `/privacy`, `/risk`, `/terms` (and the not-found page's "§ · Missing page" label).
- Evidence: `qa/runs/2026-05-03T23-07-16Z/privacy/desktop-1440/initial.dom.html` — every `<section>` opens with `<span class="t-label">§ 01 · Information we collect</span>` followed by sibling `<p>` body. There are 12 such sections on `/terms`, 13 on `/risk`, 10 on `/docs`, 5 on `/about`, 5 on `/contact`, 4 on `/help/earnings-data`. None are wrapped in any heading element.
- WCAG SC violated: 1.3.1 Info and Relationships (Level A); 2.4.6 Headings and Labels (Level AA); 2.4.10 Section Headings (Level AAA but core to legal-doc usability).
- Why P0: a screen-reader user navigating the privacy policy or terms by heading (the standard pattern for long docs) gets *one* h1 and zero structural landmarks for the next ~13 sections. They must read the entire document linearly to find "§ 06 · Your rights" or "§ 03 · Data storage and security".
- Fix: render each `t-label` as `<h2 class="t-label">…</h2>`. The visual styling is already a class — just change the tag.

**2. `/login/reset` has no `<main>` landmark, no header/banner, no contentinfo, and no skip link.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/login-reset/desktop-1440/initial.dom.html` — `grep -c '<main\|role="main"\|role="banner"\|role="contentinfo"\|#main-content'` returns 0. The h1 "Password reset" exists but sits inside a generic `<div>`.
- WCAG SC violated: 1.3.1 Info and Relationships; 2.4.1 Bypass Blocks (skip link).
- Fix: wrap the page body in `<main>` and reuse the marketing layout's header/footer (or at minimum add a skip link and a `<main>` wrapper).

---

## P1 issues

**3. All 11 public/marketing routes lack a skip link.**
- Affected: `/login`, `/login/reset`, `/request-access`, `/docs`, `/privacy`, `/terms`, `/risk`, `/about`, `/contact`, `/help/earnings-data`, plus the `/not-found` and `/_design` (now 404) shells.
- Evidence: `grep -c '#main-content'` returns 0 for every public route DOM under `qa/runs/2026-05-03T23-07-16Z/<route>/desktop-1440/initial.dom.html`. The authenticated dashboard layout has the skip link wired correctly (`<a href="#main-content" class="sr-only focus:not-sr-only …">`); the public layout does not.
- WCAG SC violated: 2.4.1 Bypass Blocks (Level A).
- Fix: add the same skip-link pattern to the public layout. Confirm `<main id="main-content">` exists where the link points.

**4. Public/marketing layout has no `<header>` or `role="banner"` landmark.**
- Affected: `/about`, `/contact`, `/docs`, `/help/earnings-data`, `/privacy`, `/risk`, `/terms`, `/not-found`.
- Evidence: my survey of every public DOM shows `header=0 banner=0` across all marketing pages (the auth header that ships on `/login`, `/login/reset`, `/request-access` does include `<header>`, but those still lack `role="banner"` and the docs/legal pages have nothing).
- WCAG SC violated: 1.3.1 Info and Relationships; 4.1.2 Name/Role/Value (perceivable structure).
- Fix: in the marketing/docs layout, wrap the top "α AlphaDesk · Docs · Privacy · Terms · Risk · Sign in · Request access" bar in `<header>` (and the existing footer in `<footer>` — currently it's a `<footer>` element but pages without a header are unbalanced).

**5. Authenticated dashboard (`/`) has no `<footer>` / `role="contentinfo"` landmark.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/dashboard/desktop-1440/initial.dom.html` — `grep -c '<footer\|role="contentinfo"'` returns 0. The visible bottom strip is `<div data-slot="status-bar" aria-label="System status">`. Every other auth route (`/trade`, `/analytics`, `/pipeline`, etc.) does have `<footer>` and `role="contentinfo"` — so this is a divergent dashboard layout, not a system-wide gap.
- WCAG SC violated: 1.3.1 Info and Relationships.
- Fix: render the status strip as `<footer role="contentinfo" aria-label="System status">` on the dashboard, matching sibling routes.

**6. Heading hierarchy skips h2 → h3 on `/alerts` and `/strategies/earnings-options-play`.**
- Evidence:
  - `qa/runs/2026-05-03T23-07-16Z/alerts/desktop-1440/initial.dom.html` — h1 "Alerts & triggers", then jumps to `<h3 class="text-sm font-semibold text-foreground …">` (e.g., "Trigger preview").
  - `qa/runs/2026-05-03T23-07-16Z/strategies-earnings-options-play/desktop-1440/initial.dom.html` — h1 "This + next week's earnings · May 1 - May 15, 2026", then jumps directly to `<h3>` for each calendar day ("Thu, 05/07", "Wed, 05/13").
- WCAG SC violated: 1.3.1 Info and Relationships; 2.4.6 Headings and Labels.
- Fix: promote the h3s to h2 (or insert an intermediate h2 such as "Calendar" / "Trigger details").

**7. `/not-found` (404) page lacks any nav landmark and the `<title>` is the generic homepage title.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/not-found/desktop-1440/initial.dom.html` — `nav=0`, `<title>AlphaDesk — AI-Powered Trading Terminal</title>` (same as `/`). A screen-reader user landing on a broken link via tab-switch hears the homepage title and may not realize they hit a 404. The visible label "Not on the tape." is creative but not announced as an error.
- WCAG SC violated: 2.4.2 Page Titled (Level A); 2.4.5 Multiple Ways.
- Fix: set `<title>404 — Page not found · AlphaDesk</title>` and reuse the marketing layout (which gives nav + header + footer).

---

## P2 issues

**8. Status banner ("Backend issue grouped …") on dashboard uses `role="status"` correctly but the dismiss button could announce its action.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/dashboard/desktop-1440/initial.dom.html` — the `<button>Dismiss</button>` text is fine, but the host region uses `aria-live="polite"` on a banner that contains an actionable button. After dismiss, no announcement confirms the action. Consider adding `aria-live="polite"` to a status confirmation toast.
- WCAG SC: 4.1.3 Status Messages (Level AA).

**9. Marketing-shell branding mark "α AlphaDesk" reads "alpha AlphaDesk" twice — `α` SVG/glyph is decorative and should be aria-hidden.**
- Evidence: visible-text sample from `qa/visual/manifest.json` for the dashboard begins "Skip to content … α AlphaDesk Dashboard …". The "α" character is rendered as text (font-display italic) — screen readers may pronounce it inconsistently ("alpha", "a", or skip).
- Fix: wrap the leading α in `<span aria-hidden="true">` and rely on the visible "AlphaDesk" word for the accessible name.
- WCAG SC: 1.3.1 (informational naming).

**10. The legal-doc styled section labels use a 12 px font (`text-[12px] uppercase tracking-[0.18em]`) for "LAST UPDATED · 2026-04-12" and similar metadata.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/privacy/desktop-1440/initial.png` — the metadata band under the h1 is uppercase letter-spaced 12 px in `text-fg-hint`. Visual contrast on light background appears OK (>4.5) but the font is at the floor of the harness threshold (`minReadableFont: 12`). Bump to 13 px for safety on sub-pixel rendering.
- WCAG SC: 1.4.4 Resize Text (Level AA — adjacent concern).

**11. The Time-of-day "BMO / AMC / All hours" composite radio uses `<button role="radio" aria-checked="…">` correctly, but is not focusable as a single tab-stop group with arrow-key navigation between options unless the keyboard handler forwards arrow keys.**
- Evidence: `qa/runs/2026-05-03T23-07-16Z/strategies-earnings-options-play/desktop-1440/initial.dom.html` — the `role="radiogroup"` wraps three `<button role="radio">`. The DOM is a snapshot only; we cannot confirm arrow-key handling. Recommend a manual keyboard test.
- WCAG SC: 2.1.1 Keyboard (Level A).

**12. Strategies-list page renders **two** `<main>` landmarks.**
- Evidence: my grep of `qa/runs/2026-05-03T23-07-16Z/strategies-list/desktop-1440/initial.dom.html` returned `<main` count = 2. Only one `<main>` per page is permitted.
- WCAG SC: 1.3.1 Info and Relationships.
- Fix: convert the inner `<main>` (likely a card or sub-region) to `<section>`.

---

## Findings already captured by automated checks

The strict harness at `qa/harness/visual-regression.mjs` audits:
- Color contrast (4.5:1 body / 3:1 large text)
- Readable font size (≥12 px)
- Tap targets (≥40 px mobile / ≥24 px desktop)
- Focus visibility (≥3 of 8 sampled focusables show a visible focus indicator)
- Horizontal overflow

The latest published run (`qa/visual/manifest.json`, baseUrl `localhost:3004`, only 6 routes covered: dashboard / trade / strategies / analytics × desktop + dashboard / trade × mobile) reports `quality.status = "pass"` for every covered route — zero contrast failures, zero font failures, zero tap-target failures, focus visibility passing on at minimum 3/8 samples each. **This automated run has not been re-executed against the production sweep at `2026-05-03T23-07-16Z`** — strongly recommend running the full strict harness against the same 22-route surface so the contrast/tap-target/focus claims hold for routes like `/alerts`, `/settings`, `/strategies/earnings-options-play`, and the legal docs, where I cannot independently verify pixel-level contrast from screenshots alone.

---

## Routes that look clean

- `/` (dashboard) — modulo missing `<footer>` (P1 #5) and dual-`<main>` (P2 #12), the landmark/heading/label/skip-link/live-region structure is otherwise correct.
- `/trade` — landmark structure correct; 9 icon-only buttons all labeled; symbol input wrapped in implicit label; `role="alert"`-style confirm regions present.
- `/analytics`, `/pipeline`, `/reports`, `/settings`, `/strategies` — all have h1, ≥3 h2, single `<main>`, single nav, banner+contentinfo, skip link wired.
- `/strategies/momentum-quality`, `/strategies/trading-agents-research` — landmark structure correct; form controls wrapped in `<label>`.
- `/login` — h1 + h2 + h3 hierarchy correct, login error region uses `role="alert" aria-live="assertive"`, all 25 SVGs aria-attributed.
- `/request-access` — every text input has explicit `<label for>`; radio groups wrapped in `<label>`; honeypot input correctly `tabindex="-1"`.

The trade execution-ticket regression flagged in `LATEST.md` ("Place order" / "2-leg combo" labels missing) is a functional bug, not a a11y bug per se, but compounds the impact: a screen-reader user filling the ticket loses the announced affordance of a clearly named submit button.
