# Visual regression — v2 design port

The baselines under `baseline/desktop-dark/` are exports from the Claude Design
bundle at `alphadesk-v2/project/uploads/desktop-dark/`. They describe the
target look. The Playwright snapshot tests under `pages.spec.ts` capture the
live app at the same viewport (1440×900, dark) and the `diff.spec.ts` helper
writes a 2-up `<page>.compare.png` so a human can eyeball "looks similar".

| Route                       | Baseline                                  | Spec status |
| --------------------------- | ----------------------------------------- | ----------- |
| `/`                         | `home.png`                                | live        |
| `/welcome`                  | (n/a — marketing site already pixel-met)  | skipped     |
| `/trade`                    | `trade.png`                               | live        |
| `/symbols/AAPL`             | `symbols-AAPL.png`                        | live        |
| `/strategies`               | `strategies.png`                          | live        |
| `/reports`                  | `reports.png`                             | live        |
| `/settings`                 | `settings.png`                            | live        |
| `/risk-dashboard`           | `risk.png`                                | live        |
| `/admin/control-center`     | `admin-control-center.png`                | live        |
| `/pipeline`                 | `pipeline.png`                            | live        |
| `/analytics`                | `analytics.png`                           | live        |
| `/alerts`                   | `alerts.png`                              | live        |

To run:

```
npm run test:visual            # check current state vs snapshots
npm run test:visual:update     # re-baseline after intentional changes
npm run test:visual:report     # open the HTML report
```
