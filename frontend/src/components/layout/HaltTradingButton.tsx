"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { ShieldWarning, ShieldCheck, CircleNotch } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  getHaltStatus,
  haltTrading,
  resumeTrading,
  type HaltStatus,
} from "@/lib/api";

/**
 * Audit Persona F4.2 (2026-05-05): the dashboard had no system-level
 * halt-trading button. The /strategies/{id} kill-switch panel disables
 * ONE strategy; in an emergency operators need a single-click halt
 * that cancels open orders + flattens positions across the board.
 *
 * Wires up ``POST /api/v1/halt`` (admin-only,
 * cancels open orders, flattens positions, persists halt state) and
 * ``POST /api/v1/halt/resume``.
 *
 * Render contract:
 *  · Default state: amber "Halt trading" outline button, opens
 *    DestructiveConfirmModal that names the consequences and
 *    requires explicit confirmation.
 *  · Halted state: profit-coloured "Resume trading" button + tooltip
 *    showing who halted, when, and why.
 *  · Loading state: in-flight spinner; button disabled.
 *
 * The button is admin-only on the backend (returns 403 for non-admin);
 * the frontend reflects that by hiding itself when /halt-status returns
 * 401/403 — non-admin users don't see the affordance.
 */
export default function HaltTradingButton({ className }: { className?: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<HaltStatus | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getHaltStatus();
      setStatus(s);
      setForbidden(false);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("401") || msg.includes("403")) {
        setForbidden(true);
        setStatus(null);
      }
      // Non-auth failure: leave last-known status visible. The button
      // is best-effort UI; broker WebSocket + structured logs are the
      // authoritative halt-state surfaces.
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Soft poll every 60s so a halt fired from another tab / endpoint
    // (e.g. /trades/halt POST direct, automated risk system) still
    // surfaces here. Pause when the document is hidden — the next
    // visibilitychange triggers an immediate refresh.
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (status?.halted) {
        const result = await resumeTrading();
        toast({
          type: "success",
          message: result.message ?? "Trading resumed.",
        });
      } else {
        const result = await haltTrading({
          flatten: true,
          reason: "Operator halt from dashboard",
        });
        toast({
          type: "success",
          message: result.message ?? "Trading halted.",
        });
      }
      await refresh();
    } catch (e) {
      toast({
        type: "error",
        message: `Halt action failed: ${(e as Error).message ?? "unknown error"}`,
      });
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  };

  // Hidden for non-admin users (backend returns 403; UI doesn't render the button).
  if (forbidden) return null;
  if (status === null) return null; // first load — keep TopBar quiet

  const halted = status.halted;
  const Icon = halted ? ShieldCheck : ShieldWarning;
  const triggeredAt = status.halted_at
    ? new Date(status.halted_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;
  const tooltip = halted
    ? `Halted${status.halted_by ? ` by ${status.halted_by}` : ""}${
        triggeredAt ? ` at ${triggeredAt}` : ""
      }${status.reason ? ` — ${status.reason}` : ""}. Click to resume.`
    : "Halt trading: cancel open orders + flatten positions.";
  const liveStatus = halted
    ? `Trading halted${status.reason ? `: ${status.reason}` : ""}.`
    : "Trading halt is clear.";

  return (
    <>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveStatus}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        title={tooltip}
        aria-label={halted ? "Resume trading" : "Halt trading"}
        aria-pressed={halted}
        className={cn(
          "h-9 gap-1.5 font-mono text-label uppercase tracking-wider",
          halted
            ? "border-profit/40 text-profit hover:bg-profit/10 hover:text-profit"
            : "border-state-warning/50 text-state-warning hover:bg-state-warning/10 hover:text-state-warning",
          className,
        )}
      >
        {loading ? (
          <CircleNotch className="h-3.5 w-3.5 animate-spin" weight="bold" />
        ) : (
          <Icon className="h-3.5 w-3.5" weight="bold" />
        )}
        <span>{halted ? "Resume" : "Halt"}</span>
      </Button>

      <DestructiveConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={halted ? "Resume trading?" : "Halt all trading?"}
        description={
          halted
            ? "Strategies will be allowed to fire again on the next pipeline tick. Open orders that were cancelled by the halt are NOT restored — strategies that still want them must re-emit on the next run."
            : "This stops every strategy and broker route immediately. Open orders are cancelled and every open position is flattened at market (or queued for next open if the market is closed). The halt state persists across deploys."
        }
        consequences={
          halted
            ? [
                "Pipeline runs resume on the next tick",
                "Already-cancelled orders are not restored",
                "Audit log records the resume",
              ]
            : [
                "Cancel every open broker order",
                "Close every open position at market",
                "Block new orders from any strategy or manual ticket",
                "Persist the halt to Postgres + Redis",
                "Audit log records the halt with your username",
              ]
        }
        confirmLabel={halted ? "Resume trading" : "Halt all trading"}
        onConfirm={handleConfirm}
        loading={loading}
      />
    </>
  );
}
