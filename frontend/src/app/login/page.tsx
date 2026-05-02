import type { Metadata } from "next";

import AuthProductFrame from "@/components/auth/AuthProductFrame";
import LoginForm from "./_login/LoginForm";

export const metadata: Metadata = {
  title: "AlphaDesk — AI Trading Terminal",
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
    </AuthProductFrame>
  );
}
