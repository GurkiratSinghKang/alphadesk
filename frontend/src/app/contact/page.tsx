import type { Metadata } from "next";

import StaticArticle from "@/components/layouts/StaticArticle";
import { CONTACT_CLAUSES } from "./_contact/content";

export const metadata: Metadata = {
  title: "Contact — AlphaDesk",
  description:
    "How to reach AlphaDesk: support, legal, security, and press addresses with response-time expectations.",
};

export default function ContactPage() {
  return (
    <StaticArticle
      route="/contact"
      title="Contact"
      lastUpdated="2026-05-11"
      clauses={CONTACT_CLAUSES}
    />
  );
}
