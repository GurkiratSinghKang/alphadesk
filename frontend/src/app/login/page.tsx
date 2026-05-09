import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import LoginForm from "./_login/LoginForm";

export const metadata: Metadata = {
  title: "AlphaDesk · AI-powered trading terminal",
  description:
    "AlphaDesk is an AI trading terminal for researching ideas, testing strategies, reviewing trades, and operating with control.",
  // Auth surfaces should never appear in search results.
  robots: { index: false, follow: false },
};

// AuthShell consumes runtime context (date/time, theme tokens) so we keep
// this off the static prerender pass — same pattern used by the (dashboard)
// route shells.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
