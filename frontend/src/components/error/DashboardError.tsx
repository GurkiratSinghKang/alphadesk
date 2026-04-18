"use client";

import { useEffect } from "react";
import Link from "next/link";

import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import { Button } from "@/components/ui/button";

/**
 * DashboardError
 * ──────────────
 * Editorial error UI shared by every `error.tsx` boundary under
 * `app/(dashboard)/**` and by the top-level `app/error.tsx`. Uses the
 * AlphaDesk typography primitives (Display / Eyebrow), design tokens
 * (`bg-bg`, `text-fg`, `text-fg-muted`), and the `Button` primitive so
 * the gold "Try again" action gets the correct near-black foreground
 * (`text-primary-foreground` — WCAG-passing on the brand gold).
 *
 * Logs the error with route context on mount for easier telemetry.
 */
export interface DashboardErrorPageProps {
  /** The Error thrown by a descendant component. */
  error: Error & { digest?: string };
  /** Next.js-provided callback that re-renders the segment. */
  reset: () => void;
  /** Route identifier for logging and the eyebrow tag (e.g. "analytics"). */
  route: string;
  /** Contextual headline (e.g. "Analytics failed to load"). */
  headline?: string;
  /** Fallback body shown when `error.message` is empty. */
  fallbackMessage?: string;
  /** Render full-viewport chrome. `true` on top-level (app/error.tsx). */
  fullScreen?: boolean;
}

export default function DashboardErrorPage({
  error,
  reset,
  route,
  headline = "Something went wrong",
  fallbackMessage = "An unexpected error occurred.",
  fullScreen = false,
}: DashboardErrorPageProps) {
  useEffect(() => {
    // Surface to browser console with route context; production telemetry
    // hooks can subscribe to this same shape.
    // eslint-disable-next-line no-console
    console.error(`[AlphaDesk error · ${route}]`, {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error, route]);

  const message =
    (error.message && error.message.trim().length > 0
      ? error.message
      : fallbackMessage) ?? fallbackMessage;

  const wrapperClass = fullScreen
    ? "flex min-h-screen items-center justify-center bg-bg text-fg"
    : "flex h-full min-h-[480px] items-center justify-center";

  return (
    <div className={wrapperClass}>
      <div className="flex w-full max-w-[560px] flex-col gap-6 px-6 py-12">
        <Eyebrow as="div">&sect; &middot; {route || "Error"}</Eyebrow>

        <div className="flex flex-col gap-3">
          <Display size="md" as="h1" className="max-w-[18ch]">
            {headline}
          </Display>
          <p className="font-display italic text-[15px] leading-snug text-fg-muted">
            {message}
          </p>
          {error.digest ? (
            <p className="t-mono-micro text-fg-hint">Ref: {error.digest}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            type="button"
            variant="default"
            size="default"
            onClick={reset}
            aria-label="Try again"
          >
            Try again
          </Button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-transparent px-4 py-2 font-sans text-[12.5px] font-medium text-fg transition-colors hover:bg-bg-elev-1 hover:border-brand"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
