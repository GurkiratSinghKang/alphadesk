"use client";

import { useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { TickerTape } from "@/components/layout/TickerTape";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();
  const { toast } = useToast();

  useEffect(() => {
    function handleApiError(e: CustomEvent) {
      const { status, message } = e.detail;
      if (status !== 401) { // Don't toast on auth redirects
        toast({ type: "error", message: message || "An API error occurred" });
      }
    }
    window.addEventListener("alphadesk:api-error", handleApiError as EventListener);
    return () => window.removeEventListener("alphadesk:api-error", handleApiError as EventListener);
  }, [toast]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <TickerTape />
      <StatusStrip />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
    </div>
  );
}
