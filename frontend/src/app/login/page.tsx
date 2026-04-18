import type { Metadata } from "next";

import EditorialNameplate from "@/components/composites/EditorialNameplate";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";
import LoginForm from "./_login/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — AlphaDesk",
  description:
    "Sign in to AlphaDesk — a systematic trading terminal for equity strategies with Claude as a pre-trade second opinion.",
  // Auth surfaces should never appear in search results. Without this,
  // Google will index the sign-in page, which is both an SEO leak and a
  // footprint expansion.
  robots: { index: false, follow: false },
};

/**
 * /login — editorial auth surface.
 * ───────────────────────────────
 * Left panel is the brand voice (nameplate + italic-serif hero pull).
 * Right panel is the form (see `_login/LoginForm.tsx`). Auth logic is
 * unchanged; this is a visual reskin.
 */
export default function LoginPage() {
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 gap-8 sm:gap-12 lg:gap-16 px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
      <section className="flex flex-col gap-6 sm:gap-8 lg:gap-10">
        <EditorialNameplate
          volume="01"
          issue="01"
          title="Sign in"
          date={todayIso}
        />

        <div className="flex flex-col gap-8">
          <span
            className="font-sans text-[11px] font-semibold uppercase text-brand"
            style={{ letterSpacing: "0.2em" }}
          >
            A systematic trading terminal
          </span>

          <Display
            size="lg"
            as="h1"
            className="max-w-[10ch]"
          >
            Trade with{" "}
            <span className="not-italic text-fg-dim">the</span> patience{" "}
            <span className="not-italic text-fg-dim">of</span> capital.
          </Display>

          <p className="max-w-[480px] font-sans text-[16px] leading-[1.55] text-fg-dim">
            AlphaDesk is a single workstation for designing, back-testing, and
            executing systematic equity strategies &mdash; with Claude as a
            pre-trade second opinion, not a co-pilot on the wheel.
          </p>
        </div>

        <SectionRule tag="§ 01 · Access" />

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <li className="flex flex-col gap-1.5">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Invite-only
            </span>
            <p className="font-display italic text-[15px] text-fg">
              Book access is granted by the desk, not by form.
            </p>
          </li>
          <li className="flex flex-col gap-1.5">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Twelve strategies, one execution layer
            </span>
            <p className="font-display italic text-[15px] text-fg">
              Same risk policy, same audit trail, different alphas.
            </p>
          </li>
        </ul>
      </section>

      <section className="flex w-full justify-center lg:justify-end">
        <div className="w-full max-w-[380px] rounded-md border border-border bg-bg-elev-1 p-5 sm:p-8">
          <div className="mb-6 flex items-baseline justify-between">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Desk &middot; live
            </span>
            <span
              className="font-mono text-[10.5px] text-fg-hint"
              style={{ letterSpacing: "0.05em" }}
            >
              tradingalpha.net
            </span>
          </div>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
