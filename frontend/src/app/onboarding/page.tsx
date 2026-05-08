import type { Metadata } from "next";

import OnboardingClient from "./OnboardingClient";

export const metadata: Metadata = {
  title: "Onboarding — AlphaDesk",
  description:
    "Post-approval guided onboarding: connect broker, pick strategies, set risk limits, BYO Anthropic key.",
};

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <OnboardingClient />;
}
