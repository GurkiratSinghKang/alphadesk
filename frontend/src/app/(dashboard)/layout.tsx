"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { TickerTape } from "@/components/layout/TickerTape";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { WsStatusBanner } from "@/components/layout/WsStatusBanner";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
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
          className="h-dvh w-full bg-bg"
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
        {/* a11y audit r3 — WCAG 2.4.1: skip link must be emitted on the desk
            route too (previously only the non-desk branch had it). DeskLayout
            now exposes <main id="main-content"> so this anchor resolves. */}
        {/* BUG-053 — WCAG 2.4.1: `sr-only` + `focus:not-sr-only` was not
            enough on its own; some browsers kept the 1×1px clip until the
            link hit the layout engine again. Explicit focus dimensions
            (`focus:w-auto focus:h-auto`) and padding guarantee a tappable,
            legible "Skip to content" affordance on Tab. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:w-auto focus:h-auto focus:min-h-[44px] focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
        >
          Skip to content
        </a>
        {/* edge-cases-audit-r3 P0 #6: surface WS reconnect / failed state
            so users don't place trades on stale cached quotes. Only renders
            when wsStatus !== "open". Thin enough (py-1.5) to avoid shifting
            the desk grid noticeably. */}
        <WsStatusBanner />
        {/* Round 7 Fix 4 (P128): warn the user *before* a silent redirect
            so they can save unsaved order tickets / strategy drafts.
            Render only after refresh failure — null on the happy path. */}
        <SessionExpiryBanner />
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
      {/* a11y audit r3 — WCAG 1.4.3: previous focus:text-white on gold bg
          was 2.4:1 (fails AA). Use focus:text-primary-foreground (near-black
          on gold ≈ 8:1). */}
      {/* BUG-053 — see desk-branch comment above: force explicit dimensions
          on focus so the link is a visible, tappable target. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:w-auto focus:h-auto focus:min-h-[44px] focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
      >
        Skip to content
      </a>

      {/* edge-cases-audit-r3 P0 #6 — see desk branch comment above. */}
      <WsStatusBanner />
      {/* Round 7 Fix 4 (P128): session-expiry warning banner. */}
      <SessionExpiryBanner />
      <TopBar />
      {tickerTapeOn && <TickerTape />}
      <StatusStrip />
      <main id="main-content" role="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
        {children}
      </main>
      {/* BUG-037: use the shared build version env so this footer and the
          desk StatusBar quote the same stamp. Without this, non-desk pages
          showed "v1.0" while the desk StatusBar read `NEXT_PUBLIC_BUILD_VERSION`
          (e.g. "2025.10.18-a1b2c3d"). */}
      <footer role="contentinfo" className="border-t border-border/30 px-4 py-3 text-[10px] text-muted-foreground text-center">
        AlphaDesk {process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"} — Powered by Claude AI — &copy; {new Date().getFullYear()}
      </footer>
      <CommandPalette />
      <AICopilot />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
      <OnboardingTour />
    </div>
  );
}
