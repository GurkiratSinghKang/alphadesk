"use client";

import type { ReactNode } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      {/* BUG-053 — WCAG 2.4.1: skip link needs explicit dimensions on focus
          so it doesn't stay 1×1px. Min 44px touch target + padding. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:w-auto focus:h-auto focus:min-h-touch focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
      >
        Skip to content
      </a>

      <TopBar />
      <main id="main-content" role="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
        {children}
      </main>
      <footer role="contentinfo" className="border-t border-border/30 px-4 py-3 text-label text-muted-foreground text-center">
        AlphaDesk v1.0 — Built on Claude — &copy; {new Date().getFullYear()}
      </footer>
      <CommandPalette />
      <AICopilot />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
      <OnboardingTour />
    </div>
  );
}
