import type { Metadata } from "next";
import Link from "next/link";

import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import SectionRule from "@/components/typography/SectionRule";

export const metadata: Metadata = {
  title: "Password reset — AlphaDesk",
  description:
    "Request a manual password reset for your AlphaDesk account. Automated reset is not wired yet; the desk will rotate your password on request.",
  robots: { index: false, follow: false },
};

/**
 * /login/reset
 * ─────────────
 * Honest interim reset surface. A token-signed email flow is not wired yet,
 * so we tell the user exactly what to do instead of hiding the limitation
 * behind a `mailto:` link from the login form. Wrapped in the same full-bleed
 * layout as /login (no MarketingShell), so it reads as a subpage of sign-in.
 */
export default function LoginResetPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-10 px-6 py-16">
      <nav
        className="flex items-center gap-2 font-sans text-[11.5px] text-fg-muted"
        aria-label="Breadcrumb"
      >
        <Link href="/login" className="transition-colors hover:text-fg">
          Sign in
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg">Password reset</span>
      </nav>

      <header className="flex flex-col gap-4">
        <Eyebrow as="div">§ 01 · Access</Eyebrow>
        <Display size="lg" as="h1" className="max-w-[14ch]">
          Password reset
        </Display>
        <p className="max-w-[560px] font-display italic text-[16px] leading-snug text-fg-muted">
          Self-serve reset is not yet wired. Until it is, the desk rotates
          passwords by hand on request.
        </p>
      </header>

      <SectionRule tag="§ 02 · How to reset" />

      <section className="flex flex-col gap-4 font-sans text-[14.5px] leading-[1.65] text-fg-dim">
        <p>
          Email{" "}
          <a
            href="mailto:support@tradingalpha.net?subject=Password%20reset"
            className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
          >
            support@tradingalpha.net
          </a>{" "}
          from the address tied to your account. Include your AlphaDesk
          username and a short statement that you are requesting a reset.
        </p>
        <p>
          The desk verifies ownership out-of-band (usually via a prior message
          thread or a video call) and then issues a one-time password you use
          to sign in, after which the app prompts you to set a new one.
        </p>
        <p>
          Typical turnaround is within the same trading session. If the
          request is urgent, mention your timezone.
        </p>
      </section>

      <div className="pt-6">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-elev-1 px-4 py-2 font-sans text-[12px] font-semibold text-fg transition-colors hover:bg-bg-elev-2"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
