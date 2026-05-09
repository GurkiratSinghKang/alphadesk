import type { Metadata } from "next";

import PositionDetailClient from "./PositionDetailClient";

export const metadata: Metadata = {
  title: "Position detail — AlphaDesk",
};

// Dashboard layout's useNotifications() requires <WebSocketProvider>,
// which is ssr:false. Skip static prerender so the build doesn't trip
// on "useWs must be used within Providers".
export const dynamic = "force-dynamic";

interface PositionPageProps {
  params: Promise<{ symbol: string }>;
}

export default async function PositionPage({ params }: PositionPageProps) {
  const { symbol } = await params;
  return <PositionDetailClient symbol={symbol.toUpperCase()} />;
}
