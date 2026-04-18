import * as React from "react";

import { cn } from "@/lib/utils";
import RegimePill from "@/components/primitives/RegimePill";
import Mono from "@/components/typography/Mono";
import type { NavRoute, RegimeProps } from "./types";

/**
 * TopBar (composite, 48px)
 * ────────────────────────
 * Logo · nav tabs · spacer · RegimePill · mono clock · avatar.
 * Presentation only — nav click handling is owned by the layout that
 * renders this.
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
  return (
    <div
      data-slot="top-bar"
      className={cn(
        "flex items-center h-12 px-5 gap-6",
        "border-b border-border bg-ink-050"
      )}
    >
      <div
        className="flex items-baseline gap-1.5 font-display italic text-[20px] text-ink-1000"
        style={{ letterSpacing: "-0.02em" }}
      >
        <span className="text-brand">α</span>
        <span>AlphaDesk</span>
      </div>

      <nav className="flex gap-0.5 ml-5" aria-label="Primary">
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

      <RegimePill regime={regime.regime} vol={regime.vol} label={regime.label} />

      <Mono size="hint" className="text-fg-muted">
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
