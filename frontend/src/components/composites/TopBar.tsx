"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, LogOut, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import RegimePill from "@/components/primitives/RegimePill";
import Mono from "@/components/typography/Mono";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { NavRoute, RegimeProps } from "./types";

/**
 * TopBar (composite, 48px)
 * ────────────────────────
 * Logo · nav tabs · spacer · RegimePill · mono clock · avatar.
 * Presentation only — nav click handling is owned by the layout that
 * renders this.
 *
 * Mobile: nav tabs collapse into a Sheet (hamburger) below `md`.
 */
export interface TopBarProps {
  currentRoute: string;
  routes: NavRoute[];
  regime: RegimeProps;
  /** "14:32:08 ET · Tue Nov 4" style string. */
  clockEt: string;
  avatarInitial: string;
  /** BUG-054 — Optional callback fired when the visible ⌘K affordance
   *  is clicked. When provided, the composite renders a compact
   *  "Search ⌘K" button between the regime pill and the clock so the
   *  palette is discoverable without knowing the shortcut. When omitted,
   *  the button is hidden (preserves layout for routes that don't wire
   *  the palette). */
  onOpenSearch?: () => void;
}

export default function TopBar({
  currentRoute,
  routes,
  regime,
  clockEt,
  avatarInitial,
  onOpenSearch,
}: TopBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  return (
    <div
      data-slot="top-bar"
      className={cn(
        "flex items-center h-12 px-3 md:px-5 gap-2 md:gap-6",
        "border-b border-border bg-ink-050"
      )}
    >
      {/* Mobile hamburger — hidden at md+ */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              /* BUG-024 — WCAG 2.5.5: mobile hamburger was 30×30. Bump to
                 44×44 below md, restore icon-sm at md+ where the top nav
                 renders inline and the hamburger hides anyway. */
              className="md:hidden min-h-[44px] min-w-[44px]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
          }
        />
        <SheetContent
          side="left"
          className="w-72 bg-[var(--surface)] border-border p-0"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="flex items-baseline gap-1.5 text-[20px]">
              <span className="text-brand">α</span>
              <span>AlphaDesk</span>
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label="Primary mobile"
            className="flex flex-col gap-1 p-3"
          >
            {routes.map((r) => {
              const active = r.active ?? r.href === currentRoute;
              return (
                <a
                  key={r.href}
                  href={r.href}
                  data-active={active || undefined}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center rounded-md px-3 py-3 text-sm font-medium no-underline transition-colors min-h-[44px]",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {r.label}
                </a>
              );
            })}
            {/* Additional mobile-only nav shortcuts */}
            <a
              href="/reports"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center rounded-md px-3 py-3 text-sm font-medium no-underline text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors min-h-[44px]"
            >
              Reports
            </a>
            <a
              href="/settings"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center rounded-md px-3 py-3 text-sm font-medium no-underline text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors min-h-[44px]"
            >
              Settings
            </a>
            <a
              href="/logout"
              onClick={() => setMobileMenuOpen(false)}
              className="mt-2 flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium no-underline text-down-500 hover:bg-down-500/10 transition-colors min-h-[44px]"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </a>
          </nav>
        </SheetContent>
      </Sheet>

      {/* a11y audit r3 — WCAG 2.1.1/4.1.2: logo converted from presentational
          <div> to <Link> so it is keyboard-focusable and carries proper role.
          Visual identical to prior markup.
          BUG-049 — `<Link>` without `prefetch={false}` fires an RSC
          payload request even when the href matches the current page.
          On the `/` desk we saw three `/?_rsc=*` GETs on first paint
          because Logo + Dashboard tab + breadcrumb all `<Link href="/">`.
          The logo is a self-link whenever the desk is the active route,
          so prefetching it is wasted bandwidth. */}
      <Link
        href="/"
        prefetch={false}
        aria-label="AlphaDesk home"
        className="flex items-baseline gap-1.5 font-display italic text-[20px] text-ink-1000 no-underline"
        style={{ letterSpacing: "-0.02em" }}
      >
        <span className="text-brand">α</span>
        <span>AlphaDesk</span>
      </Link>

      {/* Desktop nav — hidden below md */}
      <nav
        className="hidden md:flex gap-0.5 ml-5"
        aria-label="Primary"
      >
        {routes.map((r) => {
          const active = r.active ?? r.href === currentRoute;
          return (
            <a
              key={r.href}
              href={r.href}
              data-active={active || undefined}
              className={cn(
                // BUG-024 — WCAG 2.5.5: desktop tabs were 29px tall,
                // fine at desk resolutions but the top-nav is visible at
                // sm-md breakpoints on landscape phones where the
                // hamburger hides. Enforce 44px tap targets below md.
                "inline-flex items-center min-h-[44px] md:min-h-[36px]",
                "font-sans text-[13px] px-3 py-1.5 rounded-xs no-underline transition-colors",
                active
                  ? "text-ink-1000 bg-bg-elev-1"
                  : "text-fg-muted hover:text-fg",
              )}
              style={{ letterSpacing: "0.02em" }}
            >
              {r.label}
            </a>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* BUG-054 — visible ⌘K affordance. Previously the command palette
          was keyboard-only (⌘K / Ctrl+K) and invisible to anyone who
          hadn't read the shortcut reference. This compact button sits
          at md+ (where horizontal space allows), mirrors the visual
          style of the other top-bar chrome, and calls the supplied
          `onOpenSearch` so the composite remains presentation-pure. */}
      {onOpenSearch && (
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open command palette"
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(
            "hidden md:inline-flex items-center gap-2 rounded-md border border-border",
            "bg-bg-elev-1 px-2.5 py-1 text-[12px] text-fg-muted",
            "hover:text-fg hover:border-border-strong transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          style={{ letterSpacing: "0.02em" }}
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Search</span>
          <kbd
            aria-hidden="true"
            className="ml-1 rounded-sm border border-border bg-bg px-1 font-mono text-[13px] leading-none text-fg-muted"
          >
            ⌘K
          </kbd>
        </button>
      )}

      <div className="hidden sm:block">
        <RegimePill regime={regime.regime} vol={regime.vol} label={regime.label} />
      </div>

      <Mono size="hint" className="hidden sm:inline-flex text-fg-muted">
        {clockEt}
      </Mono>

      <span
        data-slot="avatar"
        aria-label="Account"
        className={cn(
          "flex items-center justify-center h-[26px] w-[26px] rounded-full",
          "border border-border-strong font-display italic text-[13px]"
        )}
        style={{
          background:
            "linear-gradient(135deg, var(--gold-600), var(--gold-300))",
          color: "var(--color-primary-foreground)",
        }}
      >
        {avatarInitial}
      </span>
    </div>
  );
}
