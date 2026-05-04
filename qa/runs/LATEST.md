# Latest visual QA run

> **Pointer file for downstream analysis agents.** Update the run ID below when you produce a newer canonical sweep.

**Latest canonical run:** `2026-05-04T02-58-02Z`
**Base URL captured:** `https://tradingalpha.net` (post PR #1, #2, #3 deploys)
**Manifest:** `qa/runs/2026-05-04T02-58-02Z/manifest.json`
**Coverage:** 378 steps · 372 pass · 0 fail · 6 skip · 144 PNG snapshots across desktop-1440 + mobile-390
**Audit reports built on this run:**
- `qa/reviews/pillars/01-copywriting.md` (Score 2/4)
- `qa/reviews/pillars/02-visuals.md` (Score 2/4)
- `qa/reviews/pillars/03-color.md` (Score 1/4 — POOR)
- `qa/reviews/pillars/04-typography.md` (Score 2/4)
- `qa/reviews/pillars/05-spacing.md` (Score 2/4)
- `qa/reviews/pillars/06-experience.md` (Score 2/4)
- `qa/reviews/UI-REVIEW.md` — synthesized ranked bug list

Previous prod run before PR #4 (FMP `both`-window fix): `qa/runs/2026-05-03T23-07-16Z/manifest.json`

## Why this exists

The harness at `qa/harness/` produces a fresh per-run directory under `qa/runs/<ISO-stamp>/`. Downstream agents (UX critique, accessibility audit, regression review, copy review, etc.) need a stable pointer to *which* run is the current canonical artifact set so they don't have to guess. Update this file when you produce a new sweep.

## Layout under each run directory

```
qa/runs/<run-id>/
  manifest.json                       # canonical machine-readable index (read this first)
  <spec-name>/<viewport>/
    <label>.png                       # full-page PNG screenshot
    <label>.dom.html                  # DOM snapshot at the moment of capture
    console.jsonl                     # all browser console events for this spec+viewport
    network.jsonl                     # all browser network events (request, response, requestfailed)
```

Spec names map 1:1 to files at `qa/harness/tests/<spec-name>.mjs`. Each spec defines an ordered series of `steps` (navigate, click, type, hover, snapshot, scroll, wait, eval). Each step that produces a PNG/DOM gets a `label` — that label becomes the filename.

## How to read `manifest.json`

```jsonc
{
  "runId": "2026-05-03T23-07-16Z",
  "baseUrl": "https://tradingalpha.net",
  "startedAt": "...",
  "completedAt": "...",
  "specs":   [ { "name", "route", "viewports": [...] }, ... ],
  "results": [
    {
      "name":     "trade",
      "route":    "/trade",
      "viewport": "desktop-1440",
      "steps":    [
        {
          "kind": "navigate" | "snapshot" | "click" | "type" | "hover" | "scroll" | "wait" | "eval" | "press" | "click-if-present" | "hover-first-if-present",
          "label":     "<step-label>",
          "status":    "pass" | "fail" | "skipped",
          "ms":        <duration>,
          "error":     "<message — only on fail>",
          "skipReason":"<message — only on skipped>",
          "artifacts": { "png": "<file>.png", "dom": "<file>.dom.html", "console": "console.jsonl", "network": "network.jsonl" }
        }
      ]
    }
  ]
}
```

To find every screenshot for a route:

```bash
jq -r '.results[]
  | select(.name == "trade")
  | "qa/runs/2026-05-03T23-07-16Z/\(.name)/\(.viewport)/" + (.steps[]
      | select(.artifacts.png != null)
      | .artifacts.png)' qa/runs/2026-05-03T23-07-16Z/manifest.json
```

## Coverage matrix (this run)

**Public** (no auth):
- `login`, `login-reset`, `request-access`, `request-access-submit` (form fill + POST)
- `docs`, `privacy`, `terms`, `risk`
- `about`, `contact`, `help-earnings-data`
- `_design` (must 404 in prod)
- `not-found` (random unknown URL)

**Authenticated** (logged in as `admin`):
- `dashboard` (`/`), `trade`, `analytics`, `pipeline`, `reports`, `settings`, `alerts`
- `strategies-list`, `strategy-momentum-quality`
- `strategies-earnings-options-play`, `strategies-trading-agents-research`

Most specs run two viewports: `desktop-1440` (1440×960) and `mobile-390` (390×844). `_design` and `request-access-submit` are desktop-only by design.

## Known signals to investigate (real failures, not harness flakes)

- **`trade @ desktop-1440` + `trade @ mobile-390`** — `validate-single-leg-prefill` and `validate-multi-leg-prefill` both fail. The `<button type=submit>` text on the execution ticket no longer matches the expected labels (`"Place order"` for single-leg, `"... 2-leg combo ..."` for multi-leg combo). This is a real production regression in the trade ticket — surface to the trade-team. Captured screenshots will show what label is actually being rendered.

## Known cosmetic skips (not bugs)

- **`alerts`** skips `hover first alert` — empty state, no alerts to hover.
- **`dashboard`** skips `strategy-rail-click` and `command-palette-visible` — strategy rail empty in desktop, command-palette open detection unreliable under headless Chromium (manually verified to work in real browser).
- **`strategy-momentum-quality`** skips `range-1M` — empty equity chart (no historical ledger data).

## Special artifact: `request-access-submit`

This spec actually fills and POSTs the request-access form as a `claude-test+<timestamp>@example.com` account. The latest run produced a `202 Accepted` response — meaning a real entry now exists in the access-requests queue under that email. Safe to delete via admin console.

Captures available:
- `initial`, `filled-identity`, `trading-mode-paper`, `instrument-selected`, `filled-complete`, `after-submit`, `after-submit-bottom`

## Re-running

Public-only (no creds needed):
```bash
node qa/harness/run-all.mjs --base=https://tradingalpha.net \
  --filter=login,login-reset,request-access,docs,privacy,terms,risk,not-found,about,contact,help-earnings-data,_design,request-access-submit
```

Full sweep (auth required):
```bash
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<password> \
  node qa/harness/run-all.mjs --base=https://tradingalpha.net
```

After producing a newer run, update the **Latest canonical run** field at the top of this file.
