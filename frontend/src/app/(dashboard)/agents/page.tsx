import type { Metadata } from "next";

import AgentsShell from "./AgentsShell";

export const metadata: Metadata = {
  title: "Agents — AlphaDesk",
};

// Route segment configs (`dynamic`) are server-only — silently ignored on
// "use client" files. The page is a server wrapper around the AgentsShell
// client component so this directive actually skips the static prerender
// pass that would otherwise trip on the dashboard layout's useNotifications →
// useWs chain (WebSocketProvider is ssr:false).
export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return <AgentsShell />;
}
