"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-body-sm text-fg-muted">{description}</p>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
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
