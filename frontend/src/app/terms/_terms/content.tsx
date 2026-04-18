import Link from "next/link";

import type { StaticClause } from "@/components/layouts/StaticArticle";
import {
  EditorialBullet,
  EditorialP,
  MailA,
} from "@/components/layouts/editorial";

export const TERMS_CLAUSES: StaticClause[] = [
  {
    index: "01",
    title: "Service description",
    body: (
      <>
        <EditorialP>
          AlphaDesk is an AI-powered trading terminal that provides market
          analysis, strategy management, and trade execution capabilities. The
          platform integrates with third-party brokerage services (currently
          Alpaca Markets) and AI services (Anthropic Claude) to deliver its
          functionality.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            AlphaDesk is an invite-only platform. Access is granted at our sole
            discretion.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "02",
    title: "User responsibilities",
    body: (
      <ul className="space-y-3">
        <EditorialBullet>
          You are responsible for maintaining the confidentiality of your
          account credentials.
        </EditorialBullet>
        <EditorialBullet>
          You are solely responsible for all trading decisions and activity
          conducted through your account.
        </EditorialBullet>
        <EditorialBullet>
          You must ensure that your use of connected brokerage accounts
          complies with the brokerage&rsquo;s terms of service.
        </EditorialBullet>
        <EditorialBullet>
          You must not attempt to reverse-engineer, exploit, or interfere with
          the platform&rsquo;s operation.
        </EditorialBullet>
        <EditorialBullet>
          You are responsible for any tax obligations arising from your trading
          activity.
        </EditorialBullet>
      </ul>
    ),
  },
  {
    index: "03",
    title: "Trading risks",
    body: (
      <>
        <EditorialP>
          Trading securities involves substantial risk of loss. You acknowledge
          that:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            Past performance of any strategy does not guarantee future results.
          </EditorialBullet>
          <EditorialBullet>
            You may lose some or all of your invested capital.
          </EditorialBullet>
          <EditorialBullet>
            AI-generated analysis and recommendations are not investment advice
            and may be inaccurate.
          </EditorialBullet>
          <EditorialBullet>
            Market conditions can change rapidly, and automated systems may not
            respond appropriately to all scenarios.
          </EditorialBullet>
        </ul>
        <div className="mt-4">
          <EditorialP>
            See our{" "}
            <Link
              href="/risk"
              className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
            >
              Risk Disclosure
            </Link>{" "}
            for additional details.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "04",
    title: "API key handling",
    body: (
      <>
        <EditorialP>
          When you provide brokerage API keys to AlphaDesk:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            Keys are encrypted at rest using AES-256 encryption.
          </EditorialBullet>
          <EditorialBullet>
            Keys are used exclusively for executing trades and retrieving
            account data on your behalf.
          </EditorialBullet>
          <EditorialBullet>
            You may revoke API key access at any time through your brokerage
            provider&rsquo;s dashboard.
          </EditorialBullet>
          <EditorialBullet>
            We recommend using API keys with the minimum required permissions.
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "05",
    title: "Account security",
    body: (
      <>
        <EditorialP>
          You are responsible for maintaining the security of your account.
          This includes:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>Using a strong, unique password.</EditorialBullet>
          <EditorialBullet>
            Not sharing your account credentials with others.
          </EditorialBullet>
          <EditorialBullet>
            Notifying us immediately if you suspect unauthorized access to your
            account.
          </EditorialBullet>
          <EditorialBullet>
            Keeping your brokerage API keys confidential and not exposing them
            in client-side code or public repositories.
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "06",
    title: "Disclaimer of warranties",
    body: (
      <EditorialP>
        AlphaDesk is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
        without warranties of any kind, whether express or implied. We do not
        warrant that the service will be uninterrupted, error-free, or free of
        harmful components. We make no representations about the accuracy or
        reliability of AI-generated analysis.
      </EditorialP>
    ),
  },
  {
    index: "07",
    title: "Limitation of liability",
    body: (
      <>
        <EditorialP>
          To the maximum extent permitted by law, AlphaDesk and its operators
          shall not be liable for any indirect, incidental, special,
          consequential, or punitive damages, including but not limited to loss
          of profits, data, or trading losses, arising out of or related to
          your use of the platform.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            AlphaDesk is not a registered broker-dealer, investment adviser, or
            financial institution. The platform is a software tool and does not
            provide investment advice.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "08",
    title: "Modifications",
    body: (
      <EditorialP>
        We reserve the right to modify these terms at any time. Continued use
        of the platform after changes constitutes acceptance of the updated
        terms.
      </EditorialP>
    ),
  },
  {
    index: "09",
    title: "Dispute resolution",
    body: (
      <EditorialP>
        Any disputes arising from these terms or your use of AlphaDesk shall be
        resolved through binding arbitration under the rules of the American
        Arbitration Association.
      </EditorialP>
    ),
  },
  {
    index: "10",
    title: "Governing law",
    body: (
      <EditorialP>
        These terms are governed by the laws of the State of Delaware, United
        States.
      </EditorialP>
    ),
  },
  {
    index: "11",
    title: "Refund policy",
    body: (
      <EditorialP>
        AlphaDesk is currently offered as an invite-only platform at no cost.
        No refunds or credits apply.
      </EditorialP>
    ),
  },
  {
    index: "12",
    title: "Contact",
    body: (
      <EditorialP>
        For questions about these terms, contact us at{" "}
        <MailA address="legal@tradingalpha.net" />.
      </EditorialP>
    ),
  },
];
