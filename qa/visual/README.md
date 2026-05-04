# Visual Regression Baselines

Pre-/post-PR pixel-diff snapshots for every shipped route. Catches the kind of silent visual regression that PR-4's "I split the section-cap token!" introduced (h2 silently shrunk from 22px → 13px on Settings + Pipeline page-headers; only the post-sprint Pillar 4 re-audit caught it).

## Layout

```
qa/visual/
  README.md           # this file
  baseline/           # canonical pre-change PNGs (23 routes, ~3.5MB) — committed
  current/            # latest run output (gitignored)
  diff/               # pixel-diff overlays (gitignored)
  manifest.json       # latest run metadata (gitignored)
```

## Running

```bash
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<pass> \
  node qa/harness/visual-regression.mjs --base=https://tradingalpha.net
```

Exits non-zero if any route's pixel-diff exceeds the configured `--max-changed-ratio` (default `0.0001` = 0.01%) or fails any of the strict quality checks (color contrast, tap targets, focus visibility, font readability).

## Updating baselines after an intentional UI change

```bash
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<pass> \
  node qa/harness/visual-regression.mjs --base=https://tradingalpha.net --update-baseline
```

Then `git add qa/visual/baseline/ && git commit -m "qa(visual): refresh baselines after <change>"`.

**When to refresh:**
- After a deliberate visual change has been reviewed + approved
- After a token-system change (e.g. `--fs-section-display` rename) that you've VERIFIED visually matches design intent

**When NOT to refresh:**
- To make a failing diff "go away" without reading the diff first
- During an unrelated PR where the diff is collateral damage

## Coverage (23 cases)

**Authenticated app (11):** dashboard, trade, strategies (list), strategies-detail, strategies-earnings, strategies-tar, analytics, alerts, pipeline, reports, settings

**Public / auth-adjacent (10):** login, login-reset, request-access, about, contact, docs, help-earnings, privacy, terms, risk

**Mobile (2):** dashboard-mobile, trade-mobile

Cases without an explicit `FIRST_VIEWPORT_EXPECTATIONS` entry skip the route-integrity / visible-text grouping checks but still run all quality checks.

## Workflow integration

The deploy workflow at `.github/workflows/deploy.yml` does not currently run visual regression. To add it as a non-blocking check:

```yaml
visual-regression:
  runs-on: ubuntu-latest
  needs: build-and-deploy
  continue-on-error: true   # non-blocking until baselines stabilize
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
    - run: cd frontend && npm ci
    - run: npx playwright install chromium
    - env:
        ALPHADESK_TEST_USER: ${{ secrets.QA_TEST_USER }}
        ALPHADESK_TEST_PASS: ${{ secrets.QA_TEST_PASS }}
      run: node qa/harness/visual-regression.mjs --base=https://tradingalpha.net
    - if: always()
      uses: actions/upload-artifact@v4
      with:
        name: visual-diff
        path: qa/visual/diff/
```

Once baselines have proven stable for a few deploys, drop `continue-on-error: true` to make visual regression a hard gate.
