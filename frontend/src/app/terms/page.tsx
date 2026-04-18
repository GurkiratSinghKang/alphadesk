import type { Metadata } from "next";

import StaticArticle from "@/components/layouts/StaticArticle";
import { TERMS_CLAUSES } from "./_terms/content";

export const metadata: Metadata = {
  title: "Terms of Service — AlphaDesk",
  description:
    "AlphaDesk terms of service: usage terms, responsibilities, and disclaimers.",
};

export default function TermsPage() {
  return (
    <StaticArticle
      route="/terms"
      title="Terms of Service"
      lastUpdated="2026-04-12"
      clauses={TERMS_CLAUSES}
    />
  );
}
