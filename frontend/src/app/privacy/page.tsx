import type { Metadata } from "next";

import StaticArticle from "@/components/layouts/StaticArticle";
import { PRIVACY_CLAUSES } from "./_privacy/content";

export const metadata: Metadata = {
  title: "Privacy Policy — AlphaDesk",
  description:
    "AlphaDesk privacy policy: how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <StaticArticle
      route="/privacy"
      title="Privacy Policy"
      lastUpdated="2026-04-12"
      clauses={PRIVACY_CLAUSES}
    />
  );
}
