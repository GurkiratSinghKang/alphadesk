"""B.13 — Tax services package.

Implements the equity-only / cash-account / exact-symbol-match
substantially-identical scope locked in the v2 redesign plan
(decision D9-A). NOT TAX ADVICE — disclaimer surfaces in every
report; bring-your-own CPA flow is required pre-launch.

Modules:
  - lots         : lot accumulator + holding-period classification
  - wash_sale    : IRS Pub 550 30-day window engine
  - form_8949    : CSV export (TurboTax-TXF and Form 8949 PDF live
                    in Phase 1.x follow-up)
"""
