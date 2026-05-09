"""B.12 — Reports services package.

Renders the v2 report deliverables:
  - Daily EOD       (positions + day P&L + open orders summary)
  - Weekly review   (per-strategy attribution + drawdown)
  - Monthly         (full P&L statement + tax-lot rollforward)
  - Tax (8949)      (delegated to services.tax.form_8949)

Phase 1 ships an HTML renderer (deterministic, dependency-free,
embeds inline CSS) so every report is round-trippable +
diff-able. PDF rendering routes through WeasyPrint when the
runtime has it installed; otherwise the HTML is served as the
canonical artifact and the consumer can print-to-PDF.

The report writer + cron scheduler ship in Phase 1.x follow-up
(scripts/reports_scheduler.py).
"""
