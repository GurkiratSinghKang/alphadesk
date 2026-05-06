"use client";

import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * PR-1 / T4 (earnings discipline gates) — friction modal that warns the
 * user when they click a DIRECTIONAL trade button (long call/put, bull
 * put / bear call / bull call / bear put spread) whose per-setup
 * confidence is below the 50% threshold the recommender uses to
 * separate "trade-worthy" from "skip" calls.
 *
 * Iron condor / iron butterfly / long straddle (vol-selling, non-
 * directional shapes) deliberately bypass this surface — those harvest
 * IV crush regardless of direction and are the system's preferred
 * default. Adding friction there would discourage exactly the right
 * play.
 *
 * Behaviour:
 *   ▸ "Cancel" — close the modal, no navigation. Cancel renders FIRST
 *     in DOM order so forward-Tab traversal lands on the safe action,
 *     and we explicit-focus the cancel button on open (mirrors the
 *     ``DestructiveConfirmModal`` pattern; A-F4 audit precedent).
 *   ▸ "Override and trade anyway" — close + ``router.push(href)`` to
 *     proceed to ``/trade?...`` with the original deep-link.
 */

export interface LowConfidenceWarningModalProps {
  open: boolean;
  /** Display label for the setup (e.g. ``"Bull put spread 195/200p"``). */
  setupName: string;
  /** Confidence as 0..100 integer; rendered inline as ``{X}%``. */
  confidencePct: number;
  onCancel: () => void;
  onOverride: () => void;
}

export default function LowConfidenceWarningModal({
  open,
  setupName,
  confidencePct,
  onCancel,
  onOverride,
}: LowConfidenceWarningModalProps) {
  // Default focus on the SAFE (Cancel) action when the dialog opens.
  // Mirrors the pattern from DestructiveConfirmModal — base-ui's
  // portal-rendered focus trap can be unreliable with autoFocus on
  // initial mount, so we steal focus explicitly one frame after open.
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        data-slot="low-confidence-warning-modal"
        className="sm:max-w-[460px] border-state-warning-border"
      >
        <DialogHeader>
          <DialogTitle data-slot="low-confidence-warning-title">
            Low conviction directional trade
          </DialogTitle>
        </DialogHeader>
        <p
          data-slot="low-confidence-warning-body"
          className="mt-2 text-body-sm text-fg-muted"
        >
          AI confidence on{" "}
          <strong data-slot="low-confidence-warning-setup">{setupName}</strong>{" "}
          is{" "}
          <strong data-slot="low-confidence-warning-pct">
            {confidencePct}%
          </strong>
          {" "}— below the 50% threshold for directional setups.
        </p>
        <p className="mt-3 text-body-sm text-fg-dim">
          Iron condor and similar vol-selling shapes harvest IV crush
          regardless of direction. Consider one of those instead.
        </p>
        <DialogFooter className="mt-5 flex gap-2">
          {/* Cancel renders FIRST in DOM order so a forward-Tab keeps
           * the user on the safe action; the override button is reached
           * only with an intentional Tab. */}
          <Button
            ref={cancelRef}
            data-slot="low-confidence-warning-cancel"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            data-slot="low-confidence-warning-override"
            variant="default"
            onClick={onOverride}
          >
            Override and trade anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
