import type { Metadata } from "next";

import AuthProductFrame from "@/components/auth/AuthProductFrame";
import AgentChip from "@/components/primitives/AgentChip";
import LoginForm from "./_login/LoginForm";

export const metadata: Metadata = {
  title: "AlphaDesk · AI-powered trading terminal",
  description:
    "AlphaDesk is an AI trading terminal for researching ideas, testing strategies, reviewing trades, and operating with control.",
  // Auth surfaces should never appear in search results. Without this,
  // Google will index the sign-in page, which is both an SEO leak and a
  // footprint expansion.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <AuthProductFrame
      activeLink="login"
      eyebrow="AI trading terminal"
      title={<>A calmer way to turn trade ideas into decisions.</>}
      lead="AlphaDesk gives active traders a private AI desk for the whole loop: research the idea, test the setup, ask for the hard counterargument, and move toward execution with controls already in place."
      panelTitle="Inside the workspace"
      panelSubtitle="A focused operating surface for ideas, AI review, strategy testing, order planning, and the record behind every decision."
      proofPoints={[
        {
          label: "Private desk",
          value: "private",
          detail: "Your notes, reviews, and trade context stay in one signed-in workspace.",
        },
        {
          label: "AI review",
          value: "built in",
          detail: "Challenge the idea before it turns into an order.",
        },
        {
          label: "Controls",
          value: "paper first",
          detail: "Execution workflows begin with deliberate, reviewable steps.",
        },
      ]}
    >
      <LoginForm />
      {/* v2 phase 1.13 — quiet agent strip below the login form to
       * preview the four archetypes the user will work with after
       * sign-in. Uses the v2 AgentChip primitive. */}
      <div className="mt-6 flex flex-col gap-2">
        <p className="text-eyebrow uppercase tracking-[0.12em] text-fg-muted font-semibold">
          Inside · four archetypes
        </p>
        <div className="flex flex-wrap gap-2">
          <AgentChip archetype="research" hideStatus size="sm" />
          <AgentChip archetype="signal" hideStatus size="sm" />
          <AgentChip archetype="risk" hideStatus size="sm" />
          <AgentChip archetype="exec" hideStatus size="sm" />
        </div>
      </div>
    </AuthProductFrame>
  );
}
