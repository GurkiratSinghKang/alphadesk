import type { StaticClause } from "@/components/layouts/StaticArticle";
import { EditorialP, MailA } from "@/components/layouts/editorial";

/**
 * /contact — content clauses
 * ──────────────────────────
 * Wave 3N (personas 94, 95): the /about page points here for any address
 * beyond `legal@`. Sectioned by Support / Legal / Security / Press so
 * users don't write to the wrong inbox, with an explicit response-time
 * expectation and an operational reminder that the kill-switch is faster
 * than email for trading emergencies.
 */
export const CONTACT_CLAUSES: StaticClause[] = [
  {
    index: "01",
    title: "Support",
    body: (
      <>
        <EditorialP>
          Questions about the product, order flow, strategies, or your
          account — <MailA address="support@tradingalpha.net" />.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            We aim to reply within two business days. We are a small team
            and do not operate a 24/7 support desk.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "02",
    title: "Legal",
    body: (
      <EditorialP>
        Terms, privacy, data requests, takedown notices, and anything else
        that involves a lawyer — <MailA address="legal@tradingalpha.net" />.
      </EditorialP>
    ),
  },
  {
    index: "03",
    title: "Security",
    body: (
      <>
        <EditorialP>
          Vulnerability disclosures, suspected account compromise, or
          anything that looks like an active exploit —{" "}
          <MailA address="security@tradingalpha.net" />.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            We publish a{" "}
            <a
              href="/.well-known/security.txt"
              className="text-primary underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
            >
              security.txt
            </a>{" "}
            at the canonical path so automated scanners and researchers can
            find the right address without guessing.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "04",
    title: "Press",
    body: (
      <EditorialP>
        Media inquiries and interview requests —{" "}
        <MailA address="press@tradingalpha.net" />. We reply selectively;
        expect a slower turnaround than support.
      </EditorialP>
    ),
  },
  {
    index: "05",
    title: "Trading emergencies",
    body: (
      <>
        <EditorialP>
          For account or trading emergencies, halt trading via the
          per-strategy emergency-disable button on{" "}
          <a
            href="/strategies"
            className="text-primary underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
          >
            /strategies
          </a>
          {" "}— open the strategy you need to stop and click "Emergency
          disable" in the kill-switch panel. The pipeline runner consults
          this on the next tick and halts the strategy. Email is slower
          than the switch, and the switch is the authoritative off-ramp.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            If your issue is with broker execution itself (orders stuck,
            funds missing, rejection you don&apos;t understand), contact your
            brokerage directly — AlphaDesk is a client of Alpaca, not a
            custodian of your funds.
          </EditorialP>
        </div>
      </>
    ),
  },
];
