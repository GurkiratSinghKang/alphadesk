import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — AlphaDesk",
  description: "AlphaDesk terms of service: usage terms, responsibilities, and disclaimers.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <nav className="mb-8">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to AlphaDesk
          </Link>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: April 12, 2026
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              1. Service Description
            </h2>
            <p>
              AlphaDesk is an AI-powered trading terminal that provides market
              analysis, strategy management, and trade execution capabilities.
              The platform integrates with third-party brokerage services
              (currently Alpaca Markets) and AI services (Anthropic Claude) to
              deliver its functionality.
            </p>
            <p className="mt-2">
              AlphaDesk is an invite-only platform. Access is granted at our
              sole discretion.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              2. User Responsibilities
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                You are responsible for maintaining the confidentiality of your
                account credentials.
              </li>
              <li>
                You are solely responsible for all trading decisions and
                activity conducted through your account.
              </li>
              <li>
                You must ensure that your use of connected brokerage accounts
                complies with the brokerage&apos;s terms of service.
              </li>
              <li>
                You must not attempt to reverse-engineer, exploit, or interfere
                with the platform&apos;s operation.
              </li>
              <li>
                You are responsible for any tax obligations arising from your
                trading activity.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              3. Trading Risks
            </h2>
            <p>
              Trading securities involves substantial risk of loss. You
              acknowledge that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Past performance of any strategy does not guarantee future
                results.
              </li>
              <li>
                You may lose some or all of your invested capital.
              </li>
              <li>
                AI-generated analysis and recommendations are not investment
                advice and may be inaccurate.
              </li>
              <li>
                Market conditions can change rapidly, and automated systems may
                not respond appropriately to all scenarios.
              </li>
            </ul>
            <p className="mt-2">
              See our{" "}
              <Link href="/risk" className="text-primary hover:underline">
                Risk Disclosure
              </Link>{" "}
              for additional details.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              4. API Key Handling
            </h2>
            <p>
              When you provide brokerage API keys to AlphaDesk:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Keys are encrypted at rest using AES-256 encryption.
              </li>
              <li>
                Keys are used exclusively for executing trades and retrieving
                account data on your behalf.
              </li>
              <li>
                You may revoke API key access at any time through your
                brokerage provider&apos;s dashboard.
              </li>
              <li>
                We recommend using API keys with the minimum required
                permissions.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              5. Account Security
            </h2>
            <p>
              You are responsible for maintaining the security of your account.
              This includes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Using a strong, unique password.</li>
              <li>
                Not sharing your account credentials with others.
              </li>
              <li>
                Notifying us immediately if you suspect unauthorized access to
                your account.
              </li>
              <li>
                Keeping your brokerage API keys confidential and not exposing
                them in client-side code or public repositories.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              6. Disclaimer of Warranties
            </h2>
            <p>
              AlphaDesk is provided &quot;as is&quot; and &quot;as
              available&quot; without warranties of any kind, whether express or
              implied. We do not warrant that the service will be uninterrupted,
              error-free, or free of harmful components. We make no
              representations about the accuracy or reliability of AI-generated
              analysis.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              7. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, AlphaDesk and its
              operators shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not
              limited to loss of profits, data, or trading losses, arising out
              of or related to your use of the platform.
            </p>
            <p className="mt-2">
              AlphaDesk is not a registered broker-dealer, investment adviser,
              or financial institution. The platform is a software tool and does
              not provide investment advice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              8. Modifications
            </h2>
            <p>
              We reserve the right to modify these terms at any time. Continued
              use of the platform after changes constitutes acceptance of the
              updated terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              9. Contact
            </h2>
            <p>
              For questions about these terms, contact us at{" "}
              <a
                href="mailto:legal@tradingalpha.net"
                className="text-primary hover:underline"
              >
                legal@tradingalpha.net
              </a>
              .
            </p>
          </section>
        </div>

        <footer className="mt-16 border-t border-border/30 pt-6">
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/risk" className="hover:text-foreground">
              Risk Disclosure
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
