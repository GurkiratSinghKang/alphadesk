import type { Metadata } from "next";

import AuthProductFrame from "@/components/auth/AuthProductFrame";
import RequestAccessForm from "./_request/RequestAccessForm";

export const metadata: Metadata = {
  title: "Request access — AlphaDesk",
  description:
    "Request access to AlphaDesk, an AI trading terminal for research, review, and controlled execution workflows.",
  robots: { index: false, follow: false },
};

export default function RequestAccessPage() {
  return (
    <AuthProductFrame
      activeLink="request"
      eyebrow="Private access"
      title={<>Show us the book you want AlphaDesk to help you run.</>}
      lead="Tell us how you trade, what you want to research, and where an AI review layer would make the biggest difference. We shape access around real operator workflows, not a generic signup funnel."
      panelTitle="Onboarding path"
      panelSubtitle="Access starts with a reviewed request, a paper-first workspace, and a clear path into the product."
      proofPoints={[
        {
          label: "Fit",
          value: "human",
          detail: "We look for the market coverage, workflow, and context AlphaDesk can actually help with.",
        },
        {
          label: "Start",
          value: "paper first",
          detail: "New workspaces begin in a controlled mode before any production routing is considered.",
        },
        {
          label: "Setup",
          value: "guided",
          detail: "Approved users get credentials after account, risk, and data requirements are clear.",
        },
      ]}
    >
      <RequestAccessForm />
    </AuthProductFrame>
  );
}
