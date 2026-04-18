"use client";

import * as React from "react";
import { Menu, LogOut } from "lucide-react";

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
}

export default function TopBar({
  currentRoute,
  routes,
  regime,
  clockEt,
  avatarInitial,
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
              className="md:hidden"
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

      <div
        className="flex items-baseline gap-1.5 font-display italic text-[20px] text-ink-1000"
        style={{ letterSpacing: "-0.02em" }}
      >
        <span className="text-brand">α</span>
        <span>AlphaDesk</span>
      </div>

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
                "font-sans text-[12px] px-3 py-1.5 rounded-xs no-underline transition-colors",
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
