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
    <>
      {/* QA r1 B2: skip link + landmark structure (matches dashboard layout
          pattern). Previously this page had no <main>, no skip-link, no
          banner — fails WCAG 2.4.1 (Bypass Blocks) and 1.3.1 (Info and
          Relationships). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:w-auto focus:h-auto focus:min-h-[44px] focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
      >
        Skip to content
      </a>
      <main
        id="main-content"
        role="main"
        tabIndex={-1}
        className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-10 px-6 py-16"
      >
      <nav
        className="flex items-center gap-2 font-sans text-label text-fg-muted"
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
        <p className="max-w-[560px] font-display italic text-numeric-md leading-snug text-fg-muted">
          Self-serve reset is not yet wired. Until it is, the desk rotates
          passwords by hand on request.
        </p>
      </header>

      <SectionRule tag="§ 02 · How to reset" />

      <section className="flex flex-col gap-4 font-sans text-body leading-[1.65] text-fg-dim">
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
          className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-elev-1 px-4 py-2 font-sans text-label font-semibold text-fg transition-colors hover:bg-bg-elev-2"
        >
          Back to sign in
        </Link>
      </div>
      </main>
    </>
  );
}
