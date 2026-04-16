"use client";

import type { ReactNode } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { TickerTape } from "@/components/layout/TickerTape";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { usePreferencesStore } from "@/stores/preferences";

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();
  const tickerTapeOn = usePreferencesStore((s) => s.display.tickerTapeOn);

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
