"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { TickerTape } from "@/components/layout/TickerTape";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import { useNotifications } from "@/hooks/useNotifications";
import { usePreferencesStore } from "@/stores/preferences";
import type { ReactNode } from "react";

/**
 * DashboardLayout — chrome wrapper for non-desk dashboard routes.
 *
 * The flagship trading desk (`/`) brings its own 4-row `DeskLayout`
 * shell (TopBar / ContextBar / main / StatusBar) and must own the
 * viewport. For that route this layout renders the overlays only so
 * ⌘K, copilot, shortcuts and the onboarding tour still work.
 *
 * For every other dashboard route (analytics, alerts, pipeline, reports,
 * settings, strategies, trade) the layout keeps the pre-F3 chrome.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDeskRoute = pathname === "/";

  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();
  const { toast } = useToast();
  // Mount the notification producer exactly once at the dashboard root.
  // It subscribes to WS channels (portfolio, alerts) and global custom
  // events (alphadesk:pipeline-status, alphadesk:system-notify) and
  // pushes user-gated notifications into the store consumed by the bell.
  useNotifications();
  // Defer persisted store read to avoid hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const tickerTapeOn = usePreferencesStore((s) => s.display.tickerTapeOn);

  useEffect(() => {
    function handleApiError(e: CustomEvent) {
      // Hardened against missing detail (audit P1). The dispatch sites in
      // api.ts always set { status, message } but a custom consumer could
      // fire a bare event.
      const detail = (e?.detail ?? {}) as { status?: number; message?: string };
      const status = detail.status;
      const message = detail.message;
      if (status !== 401) {
        toast({ type: "error", message: message || "An API error occurred" });
        // Also surface a durable system notification — toasts disappear after
        // a few seconds; the bell keeps a record the user can review later.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("alphadesk:system-notify", {
              detail: {
                kind: "error",
                title: status ? `API error (${status})` : "API error",
                message: message || "An API error occurred",
              },
            })
          );
        }
      }
    }
    window.addEventListener("alphadesk:api-error", handleApiError as EventListener);
    return () => window.removeEventListener("alphadesk:api-error", handleApiError as EventListener);
  }, [toast]);

  // Pre-mount skeleton — avoids zustand/persist hydration mismatches.
  if (!mounted) {
    if (isDeskRoute) {
      return (
        <div
          className="h-screen w-full bg-bg"
          style={{
            display: "grid",
            gridTemplateRows: "48px 38px 1fr 22px",
          }}
        >
          <div className="border-b border-border bg-ink-050" />
          <div className="border-b border-border bg-ink-100" />
          <div />
          <div className="border-t border-border bg-ink-050" />
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-[var(--background)]">
        <div className="h-12 border-b border-border bg-[var(--surface)]" />
        <div className="h-7 border-b border-border bg-[var(--background)]" />
        <main className="flex-1" />
      </div>
    );
  }

  // ─── Flagship desk: overlays only, the page owns the viewport. ──
  if (isDeskRoute) {
    return (
      <>
        {children}
        <CommandPalette />
        <AICopilot />
        {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
        <OnboardingTour />
      </>
    );
  }

  // ─── Non-desk dashboard pages keep the pre-F3 chrome. ──────────
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
