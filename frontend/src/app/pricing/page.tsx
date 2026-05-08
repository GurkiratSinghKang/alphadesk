import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Pricing — AlphaDesk",
  description:
    "AlphaDesk plan tiers — Free / Starter / Pro / Operator. Multi-tenant access starting in v2.",
};

export default function PricingShell() {
  return (
    <main className="min-h-dvh bg-bg px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <Section
          eyebrow="PRICING"
          title="Plans for every kind of trader"
          description="Free for paper · Starter for solo · Pro for serious · Operator for the desk. Phase 1.12 / B.17."
          level={1}
        >
          <EmptyState
            eyebrow="COMING SOON"
            title="Pricing page ships with billing in Phase 1.12 / B.17."
            description="Free (paper-only) · Starter ($49/mo, single broker) · Pro ($199/mo, multi-broker, all agents) · Operator (you). Stripe-hosted Checkout. Customer Portal. Webhook reconciliation."
            action={{
              label: "Apply for access",
              onClick: () => {
                window.location.href = "/request-access";
              },
            }}
          />
        </Section>
      </div>
    </main>
  );
}
