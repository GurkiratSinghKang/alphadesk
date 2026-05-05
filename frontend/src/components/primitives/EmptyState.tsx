import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Optional icon — typically a Phosphor or Lucide icon. */
  icon?: React.ReactNode;
  /** Headline — short noun phrase, declarative voice. */
  title: string;
  /** Optional 1-line context. */
  description?: string;
  /** Optional CTA. */
  action?: { label: string; onClick: () => void };
  /** Optional className override on the outer wrapper. */
  className?: string;
}

/**
 * EmptyState
 * ──────────
 * Shared "nothing here yet" primitive. Replaces the 5+ bespoke empty
 * compositions that previously rendered as voids (earnings detail
 * pre-selection, alerts, equity panel, pipeline orphan, etc.).
 *
 * Voice: declarative, no apology. AlphaDesk audience is sophisticated
 * — empty means "not yet" not "broken". Provide an action when
 * possible.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-border-hair bg-bg-elev-1/40 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-fg-muted [&>svg]:size-6">{icon}</div>}
      <h3 className="font-display italic text-h3 text-fg">{title}</h3>
      {description && (
        <p className="max-w-[42ch] text-body-sm leading-relaxed text-fg-muted">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-2 text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
