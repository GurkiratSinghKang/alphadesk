import type { Metadata } from "next";

import StaticArticle from "@/components/layouts/StaticArticle";
import { RISK_CLAUSES } from "./_risk/content";

export const metadata: Metadata = {
  title: "Risk Disclosure — AlphaDesk",
  description:
    "AlphaDesk risk disclosure: trading risks, AI analysis disclaimers, and important warnings.",
};

function WarningBanner() {
  return (
    <aside
      role="note"
      className="rounded-md border border-down-500/30 bg-loss-tint p-5"
    >
      <p className="font-display italic text-h3 leading-normal text-down-500">
        Trading securities and options involves substantial risk of loss and is
        not suitable for all investors. Consider carefully whether trading is
        appropriate for you in light of your financial condition.
      </p>
    </aside>
  );
}

export default function RiskDisclosurePage() {
  return (
    <StaticArticle
      route="/risk"
      title="Risk Disclosure"
      lastUpdated="2026-04-12"
      note={<WarningBanner />}
      clauses={RISK_CLAUSES}
    />
  );
}
