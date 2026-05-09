"""B.17 — Billing services package.

Stripe-hosted Checkout + Customer Portal + signature-verified
webhook receiver. PCI scope avoidance: we never accept card
numbers in our forms.

Modules:
  - stripe_webhook : signature verification + idempotent event ingest
"""
