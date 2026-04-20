import type { Metadata } from "next";

import StaticArticle from "@/components/layouts/StaticArticle";
import { ABOUT_CLAUSES } from "./_about/content";

export const metadata: Metadata = {
  title: "About AlphaDesk",
  description:
    "AlphaDesk is a Claude-powered trading terminal built by AlphaDesk Labs — a small, invite-only team operating out of a Delaware LLC.",
};

export default function AboutPage() {
  return (
    <StaticArticle
      route="/about"
      title="About AlphaDesk"
      lastUpdated="2026-04-19"
      clauses={ABOUT_CLAUSES}
    />
  );
}
