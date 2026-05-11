"use client";

import * as React from "react";
import { Question, EnvelopeSimple, ShieldCheck, Book, ChatCircle, PaperPlaneTilt } from "@phosphor-icons/react";

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
  // BUG-088 (audit 2026-05-11): in-app feedback form posts to
  // POST /api/v1/support/tickets (backend `api/routes/support.py`).
  // Subject pre-filled with the current path; body is the operator's
  // message. Submit handler keeps mailto as a fallback if the POST
  // fails so the operator never loses their text.
  const [showForm, setShowForm] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitState, setSubmitState] = React.useState<"idle" | "ok" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const pageSubject = typeof window !== "undefined"
    ? `AlphaDesk feedback — ${window.location.pathname}`
    : "AlphaDesk feedback";
  const supportHref = `mailto:support@tradingalpha.net?subject=${encodeURIComponent(pageSubject)}`;

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (body.trim().length < 5) {
      setErrorMessage("Please include a few sentences so we can route this.");
      setSubmitState("error");
      return;
    }
    setSubmitting(true);
    setSubmitState("idle");
    setErrorMessage(null);
    try {
      const r = await fetch("/api/v1/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category: "support",
          subject: pageSubject,
          body: body.trim(),
          page_url: pageUrl,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSubmitState("ok");
      setBody("");
    } catch (err) {
      setErrorMessage(String((err as Error)?.message ?? err ?? "Unknown error"));
      setSubmitState("error");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setShowForm(false);
    setSubmitState("idle");
    setErrorMessage(null);
    setBody("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Help and support"
            title="Help and support"
            className={cn("h-9 w-9 text-fg-muted hover:text-fg", className)}
          >
            <Question className="h-4 w-4" weight="bold" />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-80 border-border bg-bg-elev-1 p-0 text-fg"
        role="dialog"
        aria-label="Help and support menu"
      >
        <div className="border-b border-border-hair px-3 py-2">
          <div className="font-mono text-eyebrow uppercase tracking-[0.16em] text-fg-hint">
            Help & support
          </div>
          <div className="mt-0.5 text-body-sm text-fg-muted">
            {showForm ? "Tell us what's going on; we'll get back to you." : "Pick the channel — we route accordingly."}
          </div>
        </div>
        {showForm && (
          <form onSubmit={submitTicket} className="flex flex-col gap-2 border-b border-border-hair px-3 py-3" aria-label="Submit support ticket">
            <label className="font-mono text-eyebrow uppercase tracking-[0.12em] text-fg-hint" htmlFor="support-ticket-body">
              Your message
            </label>
            <textarea
              id="support-ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What happened, when, and what you tried…"
              rows={4}
              maxLength={10_000}
              required
              minLength={5}
              className="w-full resize-y rounded-sm border border-border bg-bg px-2 py-1.5 text-body-sm text-fg focus:border-brand focus:outline-none"
            />
            <div className="text-eyebrow text-fg-hint">
              Includes your current page ({typeof window !== "undefined" ? window.location.pathname : "—"}), username, and request id.
            </div>
            {submitState === "ok" && (
              <div role="status" className="rounded-sm border border-profit/40 bg-profit/10 px-2 py-1.5 text-body-sm text-profit">
                Ticket received. Support will reply by email.
              </div>
            )}
            {submitState === "error" && (
              <div role="alert" className="rounded-sm border border-loss/40 bg-loss/10 px-2 py-1.5 text-body-sm text-loss">
                Couldn't send ({errorMessage ?? "unknown error"}). Try the mailto link below.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
        <ul className="flex flex-col py-1">
          {!showForm && (
            <li>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-body-sm hover:bg-bg-elev-2"
              >
                <PaperPlaneTilt className="h-4 w-4 shrink-0 self-center text-brand" weight="bold" />
                <div className="flex-1">
                  <div className="font-semibold">Send in-app feedback</div>
                  <div className="text-fg-muted">
                    POST /api/v1/support/tickets · attached to your account
                  </div>
                </div>
              </button>
            </li>
          )}
          <li>
            <a
              href={supportHref}
              className="flex items-baseline gap-2 px-3 py-2 text-body-sm hover:bg-bg-elev-2"
            >
              <ChatCircle className="h-4 w-4 shrink-0 self-center text-fg-muted" weight="bold" />
              <div className="flex-1">
                <div className="font-semibold">Email support</div>
                <div className="text-fg-muted">
                  support@tradingalpha.net · opens your mail client
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
