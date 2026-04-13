import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — AlphaDesk",
  description: "AlphaDesk privacy policy: how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: April 12, 2026
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              1. Information We Collect
            </h2>
            <p>
              AlphaDesk collects information necessary to provide our trading
              terminal service. This includes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-foreground">Account Information:</strong>{" "}
                Username, email address, and hashed password credentials.
              </li>
              <li>
                <strong className="text-foreground">API Credentials:</strong>{" "}
                Brokerage API keys (e.g., Alpaca) that you provide for trade
                execution. These are stored encrypted at rest.
              </li>
              <li>
                <strong className="text-foreground">Usage Data:</strong> Trading
                activity, strategy configurations, and platform interaction logs.
              </li>
              <li>
                <strong className="text-foreground">Technical Data:</strong> IP
                address, browser type, and device information collected
                automatically via server logs.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              2. How We Use Your Information
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>To authenticate and authorize access to the platform.</li>
              <li>
                To execute trades and manage positions on your behalf through
                connected brokerage accounts.
              </li>
              <li>
                To provide AI-powered analysis using Anthropic&apos;s Claude API.
                Market data and strategy parameters may be sent to Anthropic for
                analysis. No personally identifiable information is included in
                these requests.
              </li>
              <li>To improve platform performance and reliability.</li>
              <li>To communicate important service updates.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              3. Data Storage and Security
            </h2>
            <p>
              Your data is stored on secure servers. We use industry-standard
              encryption for data in transit (TLS) and at rest. API keys are
              encrypted using AES-256 before storage. Access to production
              systems is restricted and audited.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              4. Cookies
            </h2>
            <p>
              AlphaDesk uses essential cookies for authentication (session
              tokens). We do not use third-party tracking cookies or advertising
              cookies. Authentication cookies are HttpOnly and Secure.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              5. Third-Party Services
            </h2>
            <p>We integrate with the following third-party services:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-foreground">Alpaca Markets:</strong>{" "}
                Brokerage services for trade execution. Subject to{" "}
                <a
                  href="https://alpaca.markets/disclosures"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Alpaca&apos;s privacy policy
                </a>
                .
              </li>
              <li>
                <strong className="text-foreground">Anthropic (Claude):</strong>{" "}
                AI analysis services. Market data sent for analysis is subject to{" "}
                <a
                  href="https://www.anthropic.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Anthropic&apos;s privacy policy
                </a>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              6. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Request access to the personal data we hold about you.</li>
              <li>Request correction or deletion of your personal data.</li>
              <li>
                Revoke API key access at any time through your brokerage
                provider.
              </li>
              <li>Request export of your trading data.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              7. Data Retention
            </h2>
            <p>
              We retain account data for as long as your account is active.
              Trading history and analytics data are retained for regulatory
              compliance purposes. Upon account deletion, personal data is
              removed within 30 days, except where retention is required by law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              8. Contact
            </h2>
            <p>
              For privacy-related inquiries, contact us at{" "}
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
            <Link href="/terms" className="hover:text-foreground">
              Terms of Service
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
