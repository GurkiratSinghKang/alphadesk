import type { Metadata } from "next";

import { AuthShell, ApplyBrandCard } from "@/components/auth/AuthShell";
import RequestAccessForm from "./_request/RequestAccessForm";

export const metadata: Metadata = {
  title: "Apply for access — AlphaDesk",
  description:
    "Apply for access to AlphaDesk. Tell us how you trade, what you want to research, and where an AI review layer would help.",
  robots: { index: false, follow: false },
};

// AuthShell consumes runtime context (date/time, theme tokens) so we keep
// this off the static prerender pass.
export const dynamic = "force-dynamic";

export default function RequestAccessPage() {
  return (
    <AuthShell
      brand={{
        eyebrow: "APPLY FOR ACCESS · NEXT COHORT MAY 22",
        title: (
          <>
            Tell us who <span style={{ color: "var(--brand)" }}>you</span> are.
          </>
        ),
        body:
          "Access starts with a reviewed application. We shape access around real operator workflows, not a generic signup funnel — every application is read by a human.",
        card: <ApplyBrandCard />,
      }}
      topRight={{ label: "Sign in →", href: "/login" }}
      footerLeft="AlphaDesk · apply"
      footerRight="Applications are reviewed within 5 business days."
    >
      <RequestAccessForm />
    </AuthShell>
  );
}
