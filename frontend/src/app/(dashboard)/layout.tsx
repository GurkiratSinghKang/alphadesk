"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AICopilot } from "@/components/layout/AICopilot";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { WsStatusBanner } from "@/components/layout/WsStatusBanner";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import { useNotifications } from "@/hooks/useNotifications";
import type { ReactNode } from "react";

const subscribeToHydration = (notify: () => void) => {
  queueMicrotask(notify);
  return () => {};
};

const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type ApiServiceKey =
  | "portfolio"
  | "market"
  | "orders"
  | "strategies"
  | "pipeline"
  | "alerts"
  | "reports"
  | "assistant"
  | "backend";

interface ApiServiceIssue {
  key: ApiServiceKey;
  label: string;
  status?: number;
  message: string;
  path?: string;
  count: number;
  lastSeen: number;
}

const API_SERVICE_LABELS: Record<ApiServiceKey, string> = {
  portfolio: "Portfolio",
  market: "Market data",
  orders: "Orders",
  strategies: "Strategies",
  pipeline: "Pipeline",
  alerts: "Alerts",
  reports: "Reports",
  assistant: "AI assistant",
  backend: "Backend",
};

function classifyApiService(path?: string): ApiServiceKey {
  const p = (path ?? "").toLowerCase();
  if (p.includes("portfolio") || p.includes("positions")) return "portfolio";
  if (p.includes("quote") || p.includes("bars") || p.includes("market") || p.includes("options")) return "market";
  if (p.includes("orders") || p.includes("trades")) return "orders";
  if (p.includes("strategies") || p.includes("earnings") || p.includes("tradingagents")) return "strategies";
  if (p.includes("pipeline") || p.includes("scheduler")) return "pipeline";
  if (p.includes("alerts")) return "alerts";
  if (p.includes("reports") || p.includes("exports")) return "reports";
  if (p.includes("agents") || p.includes("chat")) return "assistant";
  return "backend";
}

function ApiDegradedBanner({
  issues,
  onDismiss,
}: {
  issues: ApiServiceIssue[];
  onDismiss: () => void;
}) {
  if (issues.length === 0) return null;
  const labels = issues.map((issue) => issue.label).join(", ");
  const count = issues.reduce((sum, issue) => sum + issue.count, 0);
  const newest = issues[0];
  // QA r4-2 — token-ized. Raw amber hex literals replaced with the
  // --state-warning-* semantic tokens (dark warning bg, warning border,
  // warning fg, warning fg-muted). The button hover shade is derived
  // via color-mix so we don't need a one-off token for it.
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="api-degraded-banner"
      className="w-full border-b border-state-warning-border bg-state-warning-bg px-4 py-2 text-state-warning-fg"
    >
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2 text-label leading-snug sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="font-semibold uppercase tracking-wide">Data unavailable</span>
          <span className="mx-2 text-state-warning-fg-muted">·</span>
          <span className="font-medium">{labels}</span>
          <span className="mx-2 text-state-warning-fg-muted">·</span>
          <span className="text-state-warning-fg-muted">
            grouped {count} backend issue{count === 1 ? "" : "s"}; affected views stay cached, locked, or empty.
          </span>
          {newest?.message ? (
            <span className="ml-2 hidden text-state-warning-fg-muted md:inline">
              Latest: {newest.message}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-8 shrink-0 items-center justify-center self-start rounded-sm border border-state-warning-border px-3 font-sans text-label font-semibold text-state-warning-fg transition-colors hover:bg-[color-mix(in_oklab,var(--state-warning-bg)_55%,var(--state-warning-border))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-warning-fg sm:self-auto"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

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
  const recentApiErrorsRef = useRef<Map<string, number>>(new Map());
  const groupedApiToastRef = useRef(0);
  const [apiIssues, setApiIssues] = useState<Partial<Record<ApiServiceKey, ApiServiceIssue>>>({});
  const activeApiIssues = useMemo(
    () =>
      Object.values(apiIssues)
        .filter((issue): issue is ApiServiceIssue => Boolean(issue))
        .sort((a, b) => b.lastSeen - a.lastSeen),
    [apiIssues],
  );
  // Mount the notification producer exactly once at the dashboard root.
  // It subscribes to WS channels (portfolio, alerts) and global custom
  // events (alphadesk:pipeline-status, alphadesk:system-notify) and
  // pushes user-gated notifications into the store consumed by the bell.
  useNotifications();
  // Defer persisted store read to avoid hydration mismatch.
  const mounted = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  useEffect(() => {
    function handleApiError(e: CustomEvent) {
      // Hardened against missing detail (audit P1). The dispatch sites in
      // api.ts always set { status, message } but a custom consumer could
      // fire a bare event.
      const detail = (e?.detail ?? {}) as { status?: number; message?: string; path?: string };
      const status = detail.status;
      const message = detail.message;
      if (status !== 401) {
        const service = classifyApiService(detail.path);
        const label = API_SERVICE_LABELS[service];
        setApiIssues((prev) => {
          const existing = prev[service];
          return {
            ...prev,
            [service]: {
              key: service,
              label,
              status,
              message: message || "Request failed",
              path: detail.path,
              count: (existing?.count ?? 0) + 1,
              lastSeen: Date.now(),
            },
          };
        });
        const dedupeKey = `${service}:${status ?? "unknown"}`;
        const now = Date.now();
        const lastSeen = recentApiErrorsRef.current.get(dedupeKey) ?? 0;
        recentApiErrorsRef.current.set(dedupeKey, now);
        if (now - groupedApiToastRef.current > 60_000) {
          groupedApiToastRef.current = now;
          toast({
            type: "warning",
            message: `Data unavailable: ${label}. Further API errors are grouped in the banner.`,
            duration: 7000,
          });
        }
        if (now - lastSeen < 60_000) return;
        // Also surface durable grouped service context — toasts disappear
        // after a few seconds; the bell keeps a record the user can review.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("alphadesk:system-notify", {
              detail: {
                kind: "error",
                title: status ? `${label} unavailable (${status})` : `${label} unavailable`,
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
          // Round-10 / X-2 (P0): overflow-x-hidden so the pre-mount
          // skeleton doesn't briefly produce horizontal page-scroll on
          // narrow phone viewports (the 4-cell ContextBar's hero
          // min-width sums to ~412px which is wider than 393px iPhone).
          // The live shell already has this guard; the skeleton lacked
          // it, causing a one-paint flash.
          className="h-dvh w-full overflow-x-hidden bg-bg"
          style={{
            display: "grid",
            gridTemplateRows: "48px 56px 1fr 22px",
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
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg">
        <div className="h-12 border-b border-border bg-ink-050" />
        <main className="flex-1" />
      </div>
    );
  }

  const dashboardBanners = (
    <>
      <WsStatusBanner />
      <SessionExpiryBanner />
      <ApiDegradedBanner issues={activeApiIssues} onDismiss={() => setApiIssues({})} />
    </>
  );

  // ─── Flagship desk: overlays only, the page owns the viewport. ──
  if (isDeskRoute) {
    return (
      <div className="flex h-dvh min-h-dvh flex-col overflow-x-hidden bg-bg">
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
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:w-auto focus:h-auto focus:min-h-touch focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
        >
          Skip to content
        </a>
        {/* edge-cases-audit-r3 P0 #6: surface WS reconnect / failed state
            so users don't place trades on stale cached quotes. This used to
            be fixed at top:0, which overlapped the mobile top bar; keep it
            in normal flow and let the desk fill the remaining viewport. */}
        <div className="relative z-[70] shrink-0">{dashboardBanners}</div>
        {/* Round 7 Fix 4 (P128): warn the user *before* a silent redirect
            so they can save unsaved order tickets / strategy drafts.
            Render only after refresh failure — null on the happy path. */}
        <div className="min-h-0 flex-1 [&>[data-slot=dashboard-layout]]:h-full [&>[data-slot=dashboard-layout]]:min-h-0">
          {children}
        </div>
        <CommandPalette />
        <AICopilot />
        {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
        <OnboardingTour />
      </div>
    );
  }

  // ─── Non-desk dashboard pages keep the pre-F3 chrome. ──────────
  // QA r1 A3: removed `alpha-auth-shell` here — that class paints a cream
  // gradient meant for the marketing/auth frame (login, request-access).
  // Dashboard pages without their own `bg-bg` override (notably
  // strategies/[id]) were rendering as cream-on-cream ghost text.
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg">
      {/* a11y audit r3 — WCAG 1.4.3: previous focus:text-white on gold bg
          was 2.4:1 (fails AA). Use focus:text-primary-foreground (near-black
          on gold ≈ 8:1). */}
      {/* BUG-053 — see desk-branch comment above: force explicit dimensions
          on focus so the link is a visible, tappable target. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:w-auto focus:h-auto focus:min-h-touch focus:inline-flex focus:items-center focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:bg-primary focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:rounded-md"
      >
        Skip to content
      </a>

      {/* edge-cases-audit-r3 P0 #6 — see desk branch comment above. */}
      <div className="relative z-[70] shrink-0">{dashboardBanners}</div>
      {/* Round 7 Fix 4 (P128): session-expiry warning banner. */}
      <TopBar />
      {/* Non-desk routes use natural document body scroll (simplest, matches
          browser mouse-wheel defaults). The previous `overflow-y-auto` here
          combined with `overscroll-behavior: contain` in globals.css blocked
          wheel events from reaching the body when <main> had no internal
          overflow (common case: short page), so the page appeared unscrollable.
          Flex-1 still gives <main> the remaining column height. */}
      <main id="main-content" role="main" className="relative z-0 flex-1" tabIndex={-1}>
        {children}
      </main>
      {/* BUG-037: use the shared build version env so this footer and the
          desk StatusBar quote the same stamp. Without this, non-desk pages
          showed "v1.0" while the desk StatusBar read `NEXT_PUBLIC_BUILD_VERSION`
          (e.g. "2025.10.18-a1b2c3d"). */}
      <footer role="contentinfo" className="relative z-0 border-t border-border/50 bg-ink-050/88 px-4 py-3 text-center text-label text-muted-foreground">
        AlphaDesk {process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"} — Built on Claude — &copy; {new Date().getFullYear()}
      </footer>
      <CommandPalette />
      <AICopilot />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
      <OnboardingTour />
    </div>
  );
}
