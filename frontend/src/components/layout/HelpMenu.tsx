"use client";

import * as React from "react";
import { Question, EnvelopeSimple, ShieldCheck, Book, ChatCircle } from "@phosphor-icons/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * HelpMenu
 * ────────
 * BUG-088 (audit 2026-05-11, P5-XX): the contact page (`/contact`) is
 * mailto-only, and there is no in-app surface where a signed-in user
 * can quickly find support channels without navigating away from their
 * desk. This component adds a small "Help" icon to the top bar that
 * opens a popover with the four canonical contact addresses, a docs
 * link, and a one-click "report an issue" mailto pre-populated with
 * the operator's username + the page they're on. Pre-populating means
 * the user doesn't have to manually copy the route into their email
 * for our support team to triage.
 *
 * This is a minimum-viable in-app affordance — a real ticket-queue
 * backend (POST /api/v1/support/tickets) is the BUG-088 follow-up. For
 * now, mailto is honest and immediate.
 */
export default function HelpMenu({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  // Pre-fill the "report an issue" subject with the current path so
  // the operator and support both share the same context. We avoid
  // pulling username here because it requires a network call and the
  // help button must render before auth resolves on first paint.
  const subject =
    typeof window !== "undefined"
      ? `AlphaDesk feedback — ${window.location.pathname}`
      : "AlphaDesk feedback";
  const supportHref = `mailto:support@tradingalpha.net?subject=${encodeURIComponent(subject)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Help and support"
          title="Help and support"
          className={cn("h-9 w-9 text-fg-muted hover:text-fg", className)}
        >
          <Question className="h-4 w-4" weight="bold" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 border-border bg-bg-elev-1 p-0 text-fg"
        role="dialog"
        aria-label="Help and support menu"
      >
        <div className="border-b border-border-hair px-3 py-2">
          <div className="font-mono text-eyebrow uppercase tracking-[0.16em] text-fg-hint">
            Help & support
          </div>
          <div className="mt-0.5 text-body-sm text-fg-muted">
            Pick the channel — we route accordingly.
          </div>
        </div>
        <ul className="flex flex-col py-1">
          <li>
            <a
              href={supportHref}
              className="flex items-baseline gap-2 px-3 py-2 text-body-sm hover:bg-bg-elev-2"
            >
              <ChatCircle className="h-4 w-4 shrink-0 self-center text-fg-muted" weight="bold" />
              <div className="flex-1">
                <div className="font-semibold">Report an issue</div>
                <div className="text-fg-muted">
                  support@tradingalpha.net · pre-filled with this page
                </div>
              </div>
            </a>
          </li>
          <li>
            <a
              href="mailto:legal@tradingalpha.net"
              className="flex items-baseline gap-2 px-3 py-2 text-body-sm hover:bg-bg-elev-2"
            >
              <EnvelopeSimple className="h-4 w-4 shrink-0 self-center text-fg-muted" weight="bold" />
              <div className="flex-1">
                <div className="font-semibold">Legal & compliance</div>
                <div className="text-fg-muted">legal@tradingalpha.net</div>
              </div>
            </a>
          </li>
          <li>
            <a
              href="mailto:security@tradingalpha.net?subject=Vulnerability%20disclosure"
              className="flex items-baseline gap-2 px-3 py-2 text-body-sm hover:bg-bg-elev-2"
            >
              <ShieldCheck className="h-4 w-4 shrink-0 self-center text-fg-muted" weight="bold" />
              <div className="flex-1">
                <div className="font-semibold">Security disclosure</div>
                <div className="text-fg-muted">security@tradingalpha.net</div>
              </div>
            </a>
          </li>
          <li>
            <a
              href="/docs"
              className="flex items-baseline gap-2 px-3 py-2 text-body-sm hover:bg-bg-elev-2"
              onClick={() => setOpen(false)}
            >
              <Book className="h-4 w-4 shrink-0 self-center text-fg-muted" weight="bold" />
              <div className="flex-1">
                <div className="font-semibold">Documentation</div>
                <div className="text-fg-muted">Browse the in-app docs</div>
              </div>
            </a>
          </li>
        </ul>
        <div className="border-t border-border-hair px-3 py-2 text-eyebrow uppercase tracking-[0.16em] text-fg-hint">
          More channels on /contact
        </div>
      </PopoverContent>
    </Popover>
  );
}
