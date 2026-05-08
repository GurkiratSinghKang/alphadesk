import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Onboarding — AlphaDesk",
  description:
    "Post-approval guided onboarding: connect broker, pick strategies, set risk limits, BYO Anthropic key.",
};

/**
 * Phase 0 route shell. Sits OUTSIDE the (dashboard) route group
 * because pre-approval users land here and the chrome is bespoke.
 * Phase 1.11 implements the 6-step flow (welcome / broker /
 * strategies / risk / AI / ready).
 */
export default function OnboardingShell() {
  return (
    <main className="min-h-dvh bg-bg flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <Section
          eyebrow="ONBOARDING · POST-APPROVAL"
          title="Welcome to AlphaDesk"
          description="A six-step guided setup ships here in Phase 1.11."
          level={1}
        >
          <EmptyState
            eyebrow="COMING SOON"
            title="Six-step onboarding flow lands in Phase 1.11."
            description="Welcome → Connect broker → Pick strategies → Set risk limits → AI access (BYO Anthropic key) → Ready."
            action={{
              label: "Open dashboard",
              onClick: () => {
                window.location.href = "/";
              },
            }}
          />
        </Section>
      </div>
    </main>
  );
}
