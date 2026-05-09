"use client";

/**
 * BottomTabBar — mobile-only primary navigation.
 *
 * Persona-mobile-only audit (P2, 2026-05-05): top-bar nav requires the
 * user to reach the very top of a 6-foot device. Bottom tabs are the
 * iOS/Android norm and put the most-used routes within thumb range.
 *
 * Scope (v1):
 *   • Visible only at <sm: (mobile). Strict `sm:hidden` — the desktop
 *     TopBar nav is unchanged and continues to render at md+.
 *   • 5 primary tabs: Desk, Trade, Strategies, Pipeline, More (Settings).
 *   • Active state via aria-current="page" plus tokenized fg color.
 *   • Hides while the iOS/Android software keyboard is open so it does
 *     not occlude form fields (visualViewport API).
 *   • Respects safe-area-inset-bottom (iPhone home-bar / notch).
 *   • Hidden on non-dashboard routes (login, marketing pages).
 *
 * Out of scope (deliberate): haptics, swipe gestures, animated badges.
 * The TopBar still renders — we are coexisting with it, not replacing it.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Workflow,
  ListChecks,
  MoreHorizontal,
} from "lucide-react";

const TABS = [
  { id: "dashboard", label: "Desk", href: "/", icon: LayoutDashboard },
  { id: "trade", label: "Trade", href: "/trade", icon: TrendingUp },
  { id: "strategies", label: "Strategies", href: "/strategies", icon: Workflow },
  { id: "pipeline", label: "Pipeline", href: "/pipeline", icon: ListChecks },
  { id: "more", label: "More", href: "/settings", icon: MoreHorizontal },
] as const;

// Routes that are NOT inside the dashboard chrome. The bar is mounted in
// `(dashboard)/layout.tsx` so it physically can't render on auth/marketing
// pages; we still guard at runtime so a future change to the layout tree
// won't accidentally surface the bar where it has no semantic place.
const NON_DASHBOARD_PREFIXES = [
  "/login",
  "/request-access",
  "/about",
  "/contact",
  "/docs",
  "/privacy",
  "/terms",
  // v2 redesign: /risk moved to /legal/risk. The legacy slug stays in
  // the list because the 301 redirect resolves on the server, but the
  // public visitor never sees the dashboard chrome at /risk during the
  // round-trip. /legal/* covers the new public legal subtree (and any
  // future legal pages — we deliberately match the prefix not the exact
  // path so adding /legal/disclosures later does not require code edits).
  "/risk",
  "/legal",
];

export function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();

  const isDashboardRoute = !NON_DASHBOARD_PREFIXES.some((p) =>
    pathname?.startsWith(p),
  );

  // ─── Keyboard-open detection (iOS Safari / Chrome Android) ────
  // visualViewport.height shrinks when the software keyboard is open.
  // We capture the baseline on mount; once height drops below ~85% of
  // baseline we treat the keyboard as open and hide the bar so it does
  // not steal vertical real-estate from a focused input.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const baseline = vv.height;
    const handler = () => {
      const shrunk = vv.height < baseline * 0.85;
      setKeyboardOpen(shrunk);
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, []);

  if (!isDashboardRoute) return null;
  if (keyboardOpen) return null;

  return (
    <nav
      role="navigation"
      aria-label="Primary mobile navigation"
      data-slot="bottom-tab-bar"
      // `sm:hidden` is the strict desktop guard — at >=640px the bar is
      // removed from the layout entirely, so the desktop TopBar nav is
      // the only navigation surface and the desk's h-dvh shell is
      // unaffected. `pb-[env(safe-area-inset-bottom)]` lifts the bar
      // above the iOS home indicator.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-hair bg-bg pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex h-14 items-stretch justify-around">
        {TABS.map((tab) => {
          // The Desk tab matches only "/" exactly so /strategies doesn't
          // light up Desk. Every other tab uses startsWith() so nested
          // routes (e.g. /strategies/earnings-options-play) keep the
          // parent tab highlighted.
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : Boolean(pathname?.startsWith(tab.href));
          const Icon = tab.icon;
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => router.push(tab.href)}
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
                className={`flex h-full w-full flex-col items-center justify-center gap-0.5 ${
                  isActive ? "text-fg" : "text-fg-muted"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="text-eyebrow">{tab.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
