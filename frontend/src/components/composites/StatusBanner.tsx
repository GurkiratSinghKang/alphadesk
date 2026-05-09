"use client";

import * as React from "react";

import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import { cn } from "@/lib/utils";

/**
 * StatusBanner
 * ─────────────
 * v2 redesign — unified top-of-page sticky notice. Renders one of
 * three tones (info / warn / crit) with optional inline action.
 *
 * Per the plan §0.2 "Banner unification": the existing
 * `WsStatusBanner`, `SessionExpiryBanner`, and `ApiDegradedBanner`
 * KEEP their trigger logic but render through this primitive so all
 * top-of-page notices share spacing, contrast, aria-live, and visual
 * tone. This component owns the look; the wrappers own when to fire.
 *
 * `aria-live` is `polite` for info/warn (do not interrupt SR users)
 * and `assertive` for crit (genuinely urgent — broker rail down,
 * session expiring NOW, halted with pending fills).
 */
export type StatusBannerTone = "info" | "warn" | "crit";

export type StatusBannerAction =
  | { label: string; onClick: () => void; href?: never }
  | { label: string; href: string; onClick?: never };

export interface StatusBannerProps {
  tone: StatusBannerTone;
  /** Plain message string OR rich React node. */
  message: React.ReactNode;
  /** Optional action: button (onClick) or link (href). */
  action?: StatusBannerAction;
  /** When true, render a small × dismiss button on the right. */
  dismissable?: boolean;
  onDismiss?: () => void;
  className?: string;
}

const toneClass: Record<
  StatusBannerTone,
  { container: string; dotTone: StatusDotTone; ariaLive: "polite" | "assertive" }
> = {
  info: {
    container:
      "border-ice/30 bg-tint-info-1 text-fg",
    dotTone: "ice",
    ariaLive: "polite",
  },
  warn: {
    container:
      "border-state-warning/40 bg-state-warning-bg text-state-warning-fg",
    dotTone: "amber",
    ariaLive: "polite",
  },
  crit: {
    container:
      "border-loss/40 bg-tint-down-1 text-fg",
    dotTone: "loss",
    ariaLive: "assertive",
  },
};

export default function StatusBanner({
  tone,
  message,
  action,
  dismissable = false,
  onDismiss,
  className,
}: StatusBannerProps) {
  const meta = toneClass[tone];

  return (
    <div
      role="status"
      aria-live={meta.ariaLive}
      data-slot="status-banner"
      data-tone={tone}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-body-sm",
        meta.container,
        className,
      )}
    >
      <StatusDot tone={meta.dotTone} pulse={tone === "crit"} size={7} />
      <div className="min-w-0 flex-1">{message}</div>
      {action && (
        <div className="shrink-0">
          {"href" in action && action.href ? (
            <a
              href={action.href}
              className="text-body-sm font-semibold underline-offset-2 hover:underline"
            >
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="text-body-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
      {dismissable && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 ml-1 text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1.5"
        >
          ×
        </button>
      )}
    </div>
  );
}
