"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * DangerConfirm
 * ─────────────
 * v2 redesign — typed-confirm + reason modal for the most consequential
 * actions (halt trading, rotate API key, suspend user, reject applicant,
 * deploy dispatch, publish backtest, delete account, share watchlist).
 *
 * Distinct from `DestructiveConfirmModal` (the existing "consequences-
 * only" dialog used for less load-bearing actions like cancel order).
 * Per the plan §0.2, DangerConfirm is a NEW primitive — opt-in at the
 * ~10 sites that genuinely need typed-confirm + reason + audit preview.
 * `DestructiveConfirmModal` stays for its 19 callers; do not migrate.
 *
 * Props:
 *   - confirmWord (default "CONFIRM") — user must type this exactly to
 *     unlock the destructive button.
 *   - reasonRequired (default true) — operator's reason for the action,
 *     captured for the audit log.
 *   - diffPreview (optional) — before/after rendering of the resulting
 *     state change (e.g. "halted: false → true; symbol: NVDA").
 *   - auditPreview (optional) — what the audit row WILL look like.
 *
 * Tab order: cancel → reason → typed-confirm → confirm. Cancel takes
 * focus on open so accidental Enter never fires the destructive path.
 * `aria-describedby` ties the typed-confirm input to its instruction.
 */
export interface DangerConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modal title — short verb phrase, e.g. "Halt trading on NVDA". */
  title: string;
  /** Body copy explaining what the action does. */
  body: React.ReactNode;
  /** Default "CONFIRM"; user types this exactly to enable submit. */
  confirmWord?: string;
  /** When false, no reason input is rendered. Default true. */
  reasonRequired?: boolean;
  /** Placeholder for the reason textarea. */
  reasonPlaceholder?: string;
  /** Optional pre-state vs post-state preview block. */
  diffPreview?: React.ReactNode;
  /** Optional audit-row preview block. */
  auditPreview?: React.ReactNode;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Called when user confirms. Receives the typed reason (may be empty). */
  onConfirm: (args: { reason: string }) => void | Promise<void>;
  /** Disable buttons + show loading state during in-flight confirm. */
  loading?: boolean;
}

const MIN_REASON_LEN = 4;

export default function DangerConfirm({
  open,
  onOpenChange,
  title,
  body,
  confirmWord = "CONFIRM",
  reasonRequired = true,
  reasonPlaceholder = "Why? (logged to audit)",
  diffPreview,
  auditPreview,
  confirmLabel = "Confirm",
  onConfirm,
  loading = false,
}: DangerConfirmProps) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");

  // Reset state every time the modal closes so a stale reason from a
  // previous attempt never leaks into the next confirm.
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setReason("");
    }
  }, [open]);

  // Focus the SAFE (Cancel) button on open. Mirrors DestructiveConfirmModal's
  // pattern — defer one frame for base-ui's portal/focus-trap to settle.
  React.useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      cancelRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const wordOk = typed.trim() === confirmWord;
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON_LEN;
  const canConfirm = wordOk && reasonOk && !loading;

  const handleConfirm = React.useCallback(async () => {
    if (!canConfirm) return;
    await onConfirm({ reason: reason.trim() });
  }, [canConfirm, onConfirm, reason]);

  const reasonId = "danger-confirm-reason";
  const typedId = "danger-confirm-typed";
  const typedHelpId = "danger-confirm-typed-help";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="danger-confirm"
        className="max-w-[480px] border-loss/40 bg-bg-card"
      >
        <DialogHeader>
          <DialogTitle className="font-display italic text-h2 text-fg flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-loss shadow-[0_0_6px_var(--loss)]"
            />
            {title}
          </DialogTitle>
          <DialogDescription className="text-body text-fg-dim leading-relaxed">
            {body}
          </DialogDescription>
        </DialogHeader>

        {diffPreview && (
          <div
            data-slot="danger-confirm-diff"
            className="rounded-md border border-border-hair bg-bg-elev-1 p-3 text-body-sm font-mono"
          >
            {diffPreview}
          </div>
        )}

        {auditPreview && (
          <div
            data-slot="danger-confirm-audit"
            className="rounded-md border border-border-hair bg-bg-elev-1/60 p-3 text-body-sm"
          >
            <p className="t-label mb-1.5">Audit preview</p>
            {auditPreview}
          </div>
        )}

        {reasonRequired && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="t-label text-fg">
              Reason
            </label>
            <textarea
              ref={reasonRef}
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={2}
              className="w-full rounded-sm border border-border bg-bg-elev-1 px-3 py-2 text-body text-fg placeholder:text-fg-hint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            {reason.trim().length > 0 && reason.trim().length < MIN_REASON_LEN && (
              <p className="text-body-sm text-state-warning">
                Please write at least {MIN_REASON_LEN} characters.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={typedId} className="t-label text-fg">
            Type{" "}
            <span className="text-loss font-mono tracking-wide">{confirmWord}</span>{" "}
            to enable
          </label>
          <input
            id={typedId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={typedHelpId}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-sm border border-border bg-bg-elev-1 px-3 py-2 text-body font-mono text-fg placeholder:text-fg-hint focus:border-loss focus:outline-none focus:ring-2 focus:ring-loss/40"
            placeholder={confirmWord}
          />
          <p id={typedHelpId} className="text-body-sm text-fg-muted">
            This guard exists so destructive actions are never accidental.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-slot="danger-confirm-submit"
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
