"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DestructiveConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  consequences: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export default function DestructiveConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  onConfirm,
  loading,
}: DestructiveConfirmModalProps) {
  // Audit A-F4 (2026-05-05): explicit ref + useEffect to default focus on
  // the SAFE (Cancel) action when the dialog opens. Previously relied on
  // the `autoFocus` attribute which can be unreliable with base-ui's
  // portal-rendered dialog (async mount, focus trap timing). Used by 19
  // destructive sites — a keyboard/SR user opening with Enter pre-pressed
  // could otherwise fire the destructive action. Cancel is also FIRST in
  // DOM tab order (rendered before the destructive button below) so a
  // forward Tab keeps users on the safe path. WCAG SC 2.4.3 + 3.3.4.
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      // Defer one frame so base-ui's portal/focus-trap finishes mounting
      // before we steal focus.
      const id = requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2 text-body-sm text-fg-muted">
            {description}
          </DialogDescription>
        </DialogHeader>
        {consequences.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 text-body-sm text-fg-dim">
            {consequences.map((c) => (
              <li key={c} className="flex gap-2">
                <span aria-hidden className="text-fg-hint">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="mt-5 flex gap-2">
          {/* Cancel renders FIRST in DOM order so forward-Tab traversal
           * stays on the safe action; the destructive button below is
           * reached only with an intentional Tab. On wide screens the
           * footer flips to `sm:flex-row sm:justify-end` so Cancel sits
           * on the left and destructive on the right (standard pattern),
           * but DOM order is preserved. */}
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? "Confirming…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
