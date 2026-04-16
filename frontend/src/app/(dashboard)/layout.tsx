"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { TickerTape } from "@/components/layout/TickerTape";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import { usePreferencesStore } from "@/stores/preferences";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();
  const { toast } = useToast();
  // Defer persisted store read to avoid hydration mismatch
  // (server renders with default true, client may have false from localStorage)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const tickerTapeOn = usePreferencesStore((s) => s.display.tickerTapeOn);

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

  // Don't render any client-interactive content until after hydration.
  // Zustand persist stores rehydrate from localStorage on mount, which
  // produces different values than server render → React hydration crash.
  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-[var(--background)]">
        <div className="h-12 border-b border-border bg-[var(--surface)]" />
        <div className="h-7 border-b border-border bg-[var(--background)]" />
        <main className="flex-1" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 rounded-br-md"
      >
        Skip to content
      </a>

      <TopBar />
      {tickerTapeOn && <TickerTape />}
      <StatusStrip />
      <main id="main-content" role="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
        {children}
      </main>
      <footer role="contentinfo" className="border-t border-border/30 px-4 py-3 text-[10px] text-muted-foreground text-center">
        AlphaDesk v1.0 — Powered by Claude AI — &copy; {new Date().getFullYear()}
      </footer>
      <CommandPalette />
      <AICopilot />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
      <OnboardingTour />
    </div>
  );
}
