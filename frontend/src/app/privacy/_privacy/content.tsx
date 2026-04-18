import type { StaticClause } from "@/components/layouts/StaticArticle";
import {
  EditorialBullet,
  EditorialP,
  ExternalA,
  MailA,
} from "@/components/layouts/editorial";

export const PRIVACY_CLAUSES: StaticClause[] = [
  {
    index: "01",
    title: "Information we collect",
    body: (
      <>
        <EditorialP>
          AlphaDesk collects information necessary to provide our trading
          terminal service. This includes:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            <strong className="text-fg">Account information.</strong> Username,
            email address, and hashed password credentials.
          </EditorialBullet>
          <EditorialBullet>
            <strong className="text-fg">API credentials.</strong> Brokerage API
            keys (e.g., Alpaca) that you provide for trade execution. These are
            stored encrypted at rest.
          </EditorialBullet>
          <EditorialBullet>
            <strong className="text-fg">Usage data.</strong> Trading activity,
            strategy configurations, and platform interaction logs.
          </EditorialBullet>
          <EditorialBullet>
            <strong className="text-fg">Technical data.</strong> IP address,
            browser type, and device information collected automatically via
            server logs.
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "02",
    title: "How we use your information",
    body: (
      <ul className="space-y-3">
        <EditorialBullet>
          To authenticate and authorize access to the platform.
        </EditorialBullet>
        <EditorialBullet>
          To execute trades and manage positions on your behalf through
          connected brokerage accounts.
        </EditorialBullet>
        <EditorialBullet>
          To provide AI-powered analysis using Anthropic&rsquo;s Claude API.
          Market data and strategy parameters may be sent to Anthropic for
          analysis. No personally identifiable information is included in these
          requests.
        </EditorialBullet>
        <EditorialBullet>
          To improve platform performance and reliability.
        </EditorialBullet>
        <EditorialBullet>To communicate important service updates.</EditorialBullet>
      </ul>
    ),
  },
  {
    index: "03",
    title: "Data storage and security",
    body: (
      <EditorialP>
        Your data is stored on secure servers. We use industry-standard
        encryption for data in transit (TLS) and at rest. API keys are
        encrypted using AES-256 before storage. Access to production systems is
        restricted and audited.
      </EditorialP>
    ),
  },
  {
    index: "04",
    title: "Cookies",
    body: (
      <EditorialP>
        AlphaDesk uses essential cookies for authentication (session tokens).
        We do not use third-party tracking cookies or advertising cookies.
        Authentication cookies are HttpOnly and Secure.
      </EditorialP>
    ),
  },
  {
    index: "05",
    title: "Third-party services",
    body: (
      <>
        <EditorialP>
          We integrate with the following third-party services:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            <strong className="text-fg">Alpaca Markets.</strong> Brokerage
            services for trade execution. Subject to{" "}
            <ExternalA href="https://alpaca.markets/disclosures">
              Alpaca&rsquo;s privacy policy
            </ExternalA>
            .
          </EditorialBullet>
          <EditorialBullet>
            <strong className="text-fg">Anthropic (Claude).</strong> AI analysis
            services. Market data sent for analysis is subject to{" "}
            <ExternalA href="https://www.anthropic.com/privacy">
              Anthropic&rsquo;s privacy policy
            </ExternalA>
            .
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "06",
    title: "Your rights",
    body: (
      <>
        <EditorialP>You have the right to:</EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            Request access to the personal data we hold about you.
          </EditorialBullet>
          <EditorialBullet>
            Request correction or deletion of your personal data.
          </EditorialBullet>
          <EditorialBullet>
            Revoke API key access at any time through your brokerage provider.
          </EditorialBullet>
          <EditorialBullet>Request export of your trading data.</EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "07",
    title: "Data retention",
    body: (
      <EditorialP>
        We retain account data for as long as your account is active. Trading
        history and analytics data are retained for regulatory compliance
        purposes. Upon account deletion, personal data is removed within 30
        days, except where retention is required by law.
      </EditorialP>
    ),
  },
  {
    index: "08",
    title: "Children's privacy",
    body: (
      <EditorialP>
        AlphaDesk is not intended for users under 18. We do not knowingly
        collect data from minors.
      </EditorialP>
    ),
  },
  {
    index: "09",
    title: "GDPR compliance",
    body: (
      <EditorialP>
        If you are in the EU/EEA, you have rights under GDPR including access,
        rectification, erasure, and portability. Contact{" "}
        <MailA address="legal@tradingalpha.net" /> to exercise these rights.
      </EditorialP>
    ),
  },
  {
    index: "10",
    title: "CCPA compliance",
    body: (
      <EditorialP>
        California residents have additional rights under CCPA. Contact us for
        data access or deletion requests.
      </EditorialP>
    ),
  },
  {
    index: "11",
    title: "Data breach notification",
    body: (
      <EditorialP>
        In the event of a data breach, we will notify affected users within 72
        hours as required by applicable law.
      </EditorialP>
    ),
  },
  {
    index: "12",
    title: "International data transfers",
    body: (
      <EditorialP>
        Data may be processed in the United States. By using AlphaDesk, you
        consent to data transfer to the US.
      </EditorialP>
    ),
  },
  {
    index: "13",
    title: "Contact",
    body: (
      <EditorialP>
        For privacy-related inquiries, contact us at{" "}
        <MailA address="legal@tradingalpha.net" />.
      </EditorialP>
    ),
  },
];
