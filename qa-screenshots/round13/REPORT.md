Round 13 QA Audit — AlphaDesk (tradingalpha.net)
Date: 2026-04-12

Total checks: 28
Passed: 27
Failed: 1

FAILURES:

#6 (partial) Sector Treemap — hover tooltip not using role="tooltip"
  The treemap tiles ARE different sizes (confirmed: widths range 61-123px, heights 36-158px).
  Color gradient IS present (oklab colors from green to red).
  Daily/YTD toggle IS present and works.
  Height IS ~160px (confirmed exactly 160px).
  Leader stocks ARE shown on tiles (NVDA, JPM, COST, etc.).
  HOWEVER: hovering shows an inline detail panel (125x83px with full data) instead of a standard
  HTML tooltip element. No role="tooltip" attribute found. The hover detail panel does show:
  - Full sector name ("Technology")
  - Daily change (+2.13%)
  - YTD change (+0.90%)
  - Leader stock ("Leader: NVDA +2.1%")
  VERDICT: Functionally works but uses inline panel not standard tooltip. PARTIAL PASS.
