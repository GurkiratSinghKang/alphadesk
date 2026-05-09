import type { Metadata } from "next";

import PlaybookClient from "./PlaybookClient";

export const metadata: Metadata = {
  title: "Strategy playbook — AlphaDesk",
  description:
    "Strategy as a workflow document: stages, agents per stage, backtest summary, live trades, scoped watchlist.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StrategyPlaybookPage({ params }: PageProps) {
  const { id } = await params;
  return <PlaybookClient strategyId={id} />;
}
