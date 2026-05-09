import type { Metadata } from "next";

import AgentDetailClient from "./AgentDetailClient";

export const metadata: Metadata = {
  title: "Agent detail — AlphaDesk",
};

// Dashboard layout's useNotifications() requires <WebSocketProvider>,
// which is ssr:false. Skip static prerender so the build doesn't trip
// on "useWs must be used within Providers".
export const dynamic = "force-dynamic";

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = await params;
  return <AgentDetailClient id={id} />;
}
