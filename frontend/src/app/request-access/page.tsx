import type { Metadata } from "next";

import MarketingShell from "@/components/layouts/MarketingShell";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";
import Eyebrow from "@/components/typography/Eyebrow";

export const metadata: Metadata = {
  title: "Request access — AlphaDesk",
  description:
    "Request access to the AlphaDesk trading terminal. Access is by invitation; the desk onboards one book at a time.",
  robots: { index: false, follow: false },
};

/**
 * /request-access
 * ───────────────
 * Editorial access-request page. No live onboarding API exists yet — the
 * desk evaluates requests by hand. This page tells the reader exactly what
 * will happen and gives a working email link at the bottom of the flow,
 * rather than the login form bouncing to `mailto:` from the front door.
 */
export default function RequestAccessPage() {
  return (
    <MarketingShell route="/request-access">
      <article className="mx-auto max-w-[780px] py-10 sm:py-16">
        <Eyebrow as="div">§ 01 · Access</Eyebrow>
        <Display size="lg" as="h1" className="mt-2 max-w-[16ch]">
          Request access
        </Display>
        <p className="mt-4 max-w-[620px] font-display italic text-[15px] sm:text-[16px] leading-snug text-fg-muted">
          AlphaDesk is invite-only. The desk onboards one book at a time, so
          the process is deliberately manual.
        </p>

        <div className="mt-8 sm:mt-12">
          <SectionRule tag="§ 02 · What we ask for" />
        </div>
        <ul className="mt-5 sm:mt-6 flex flex-col gap-3 font-sans text-[14px] sm:text-[14.5px] leading-[1.65] text-fg-dim">
          <li>
            Your name, firm or context, and the jurisdiction you trade from.
          </li>
          <li>
            A short note on the book you would run on AlphaDesk &mdash;
            approximate AUM, instruments, and whether you are live or paper.
          </li>
          <li>
            How you heard about the desk, if through a referral.
          </li>
        </ul>

        <div className="mt-8 sm:mt-12">
          <SectionRule tag="§ 03 · What happens next" />
        </div>
        <ul className="mt-5 sm:mt-6 flex flex-col gap-3 font-sans text-[14px] sm:text-[14.5px] leading-[1.65] text-fg-dim">
          <li>
            A human reads the request, usually within a few days.
          </li>
          <li>
            If it is a fit, the desk schedules a short call to align on risk
            policy, execution venue, and data entitlements.
          </li>
          <li>
            On approval, you receive credentials and a one-session onboarding.
            There is no queue jump.
          </li>
        </ul>

        <div className="mt-10 sm:mt-16 border-t border-border pt-6">
          <p className="font-display italic text-[15px] text-fg-muted">
            Send the request to{" "}
            <a
              href="mailto:legal@tradingalpha.net?subject=AlphaDesk%20access%20request"
              className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
            >
              legal@tradingalpha.net
            </a>
            .
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
