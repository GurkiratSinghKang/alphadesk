import type { Metadata } from "next";

import BacktestClient from "./BacktestClient";

export const metadata: Metadata = {
  title: "Backtest workbench — AlphaDesk",
  description:
    "Strategy backtest workbench: configure universe + date range + cost model + param sweep, compare runs, publish.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BacktestPage({ params }: PageProps) {
  const { id } = await params;
  return <BacktestClient strategyId={id} />;
}
