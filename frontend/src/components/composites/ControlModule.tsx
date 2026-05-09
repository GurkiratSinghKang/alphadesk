"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ControlModule
 * ──────────────
 * v2 redesign — THE atomic admin/settings card. Per v2-plan §1.6 +
 * §1.5, every knob, toggle, threshold, route, agent, strategy, and
 * pipeline step on the Admin Control Center IS one of these. Settings
 * uses the same primitive with `scope="user"` — operator-overridden
 * limits render the inheritance hint.
 *
 * Composition:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ NAME · scope label                            [status pill] │
 *   │ description                                                  │
 *   ├──────────────────────────────────────────────────────────────│
 *   │  [   control surface (passed via prop)   ]                   │
 *   │  optional inline children (rare — diff preview, audit hint)  │
 *   ├──────────────────────────────────────────────────────────────│
 *   │ last by — when · view audit                                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Critical state (red border + faint coral tint background) is
 * applied when `critical={true}` — used for halt-trading, key
 * unset, drawdown breach, etc. Permission scope is exposed as a
 * data attribute so analytics + tests can grep.
 *
 * Renders a `<section>` so multiple modules group naturally inside
 * a parent Section without nested headings.
 */
export type ControlScope = "system" | "user" | "strategy" | "symbol";
export type ControlPermission = "read" | "toggle" | "write-secret" | "dispatch";

export interface ControlModuleProps {
  /** Display name — sentence case, no trailing period. */
  name: string;
  /** One-line description below the name; italic in render. */
  desc?: string;
  /** The control surface — switch, input, segmented, slider, etc. */
  control: React.ReactNode;
  /** Optional status pill rendered next to the name. */
  status?: React.ReactNode;
  /** Scope of this module. Defaults to "system" (admin context). */
  scope?: ControlScope;
  /**
   * Permission required to interact. Affects rendering: `"read"`
   * disables the control surface; `"write-secret"` adds a small lock
   * glyph next to the name. Default `"toggle"`.
   */
  permission?: ControlPermission;
  /** When true, applies coral-bordered critical styling. */
  critical?: boolean;
  /** Last actor that changed this module's value. */
  lastBy?: string;
  /**
   * ISO timestamp of the last change. Rendered relative ("12d ago").
   * Pass `null` to suppress the timestamp.
   */
  lastAt?: string | null;
  /**
   * Audit deep-link. When present, the footer renders a "View audit"
   * link to the audit log filtered to this module.
   */
  auditHref?: string;
  /** Optional inline body rendered above the footer (rare). */
  children?: React.ReactNode;
  /**
   * Override the entire footer slot. Useful when a module wants its
   * own legal disclaimer / consent footer instead of the audit row.
   */
  footer?: React.ReactNode;
  /**
   * Optional inheritance hint shown when scope="user" and an admin
   * has overridden the value (e.g. "Set by operator · $25,000 ·
   * request change").
   */
  inheritedFrom?: string;
  className?: string;
}

function relativeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

export default function ControlModule({
  name,
  desc,
  control,
  status,
  scope = "system",
  permission = "toggle",
  critical = false,
  lastBy,
  lastAt,
  auditHref,
  children,
  footer,
  inheritedFrom,
  className,
}: ControlModuleProps) {
  const relative = relativeFromIso(lastAt);
  const readOnly = permission === "read";

  return (
    <section
      data-slot="control-module"
      data-scope={scope}
      data-permission={permission}
      data-critical={critical ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-bg-elev-1 px-4 py-3 transition-colors",
        critical
          ? "border-loss/50 bg-tint-down-1"
          : "border-border-hair hover:border-border",
        readOnly && "opacity-80",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <h3
            className="text-body font-medium text-fg leading-snug inline-flex items-center gap-1.5"
            data-slot="control-module-name"
          >
            {permission === "write-secret" && (
              <span aria-hidden className="text-fg-muted">
                {/* Inline lock glyph — Phosphor lock-key glyph not imported here
                    to keep the primitive icon-set-agnostic. Consumers may pass
                    `name` with their own icon prefix if needed. */}
                ▣
              </span>
            )}
            {name}
            {scope !== "system" && (
              <span
                className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-muted"
                data-slot="control-module-scope"
              >
                · {scope}
              </span>
            )}
          </h3>
          {desc && (
            <p className="font-display italic text-body-sm text-fg-muted leading-snug">
              {desc}
            </p>
          )}
          {inheritedFrom && (
            <p
              className="text-body-sm text-state-warning italic mt-1"
              data-slot="control-module-inheritance"
            >
              {inheritedFrom}
            </p>
          )}
        </div>
        {status && (
          <div className="shrink-0" data-slot="control-module-status">
            {status}
          </div>
        )}
      </header>
      <div data-slot="control-module-surface" className="flex flex-col gap-2">
        {control}
        {children}
      </div>
      {footer ? (
        <footer data-slot="control-module-footer">{footer}</footer>
      ) : (
        (lastBy || relative || auditHref) && (
          <footer
            data-slot="control-module-footer"
            className="flex items-center justify-between gap-3 text-eyebrow uppercase tracking-[0.08em] text-fg-muted pt-2 border-t border-border-hair"
          >
            <span className="truncate">
              {lastBy && <>by {lastBy}</>}
              {lastBy && relative && <span aria-hidden> · </span>}
              {relative && <span>{relative}</span>}
            </span>
            {auditHref && (
              <a
                href={auditHref}
                className="text-fg-muted hover:text-fg underline-offset-2 hover:underline"
              >
                View audit →
              </a>
            )}
          </footer>
        )
      )}
    </section>
  );
}
