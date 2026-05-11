"use client";

import * as React from "react";

import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, commitUserTradingMode, getUserTradingMode } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * PaperLiveToggle
 * ────────────────
 * v2 redesign — first-class top-bar segmented control for the
 * paper / live trading mode (per v2-plan §13). Visual: 24px tall
 * pair of buttons with red tint on the active "Live" segment.
 *
 * State source: existing `useUIStore.tradingMode`. Persistence +
 * cross-tab sync are inherited from that store and explicitly
 * preserved (PRESERVATION-REGISTER invariant #1 — flipping live in
 * tab A must propagate to tab B).
 *
 * Safety gate: paper→live is committed on the server and requires a fresh
 * 2FA code. The local store only updates after the backend accepts the mode.
 */
export interface PaperLiveToggleProps {
  /** Optional className override on the outer wrapper. */
  className?: string;
  /**
   * Visual variant. `default` is the top-bar pill; `compact` removes
   * the labels and uses just dots, suitable for very narrow chrome
   * (e.g. mobile drawer head).
   */
  variant?: "default" | "compact";
}

export default function PaperLiveToggle({
  className,
  variant = "default",
}: PaperLiveToggleProps) {
  const mode = useUIStore((s) => s.tradingMode);
  const setMode = useUIStore((s) => s.setTradingMode);
  const { toast } = useToast();
  const [pendingMode, setPendingMode] = React.useState<"paper" | "live" | null>(null);
  const [liveDialogOpen, setLiveDialogOpen] = React.useState(false);
  const [liveTotpCode, setLiveTotpCode] = React.useState("");

  const commitMode = React.useCallback(async (nextMode: "paper" | "live", totpCode?: string) => {
    if (mode === nextMode || pendingMode) return;
    setPendingMode(nextMode);
    try {
      const res = await commitUserTradingMode({ mode: nextMode, totp_code: totpCode });
      setMode(res.mode);
      toast({
        type: res.mode === "live" ? "warning" : "info",
        message: res.mode === "live" ? "Live trading mode enabled" : "Switched to paper trading",
      });
      if (res.mode === "live") {
        setLiveDialogOpen(false);
        setLiveTotpCode("");
      }
    } catch (err) {
      const message = err instanceof ApiError && err.detail
        ? err.detail
        : nextMode === "live"
          ? "Live trading requires a fresh 2FA step-up before it can be enabled."
          : "Could not switch trading mode.";
      toast({ type: nextMode === "live" ? "warning" : "error", message });
    } finally {
      setPendingMode(null);
    }
  }, [mode, pendingMode, setMode, toast]);

  const setPaper = React.useCallback(() => {
    void commitMode("paper");
  }, [commitMode]);

  const requestLive = React.useCallback(() => {
    if (mode === "live") return;
    setLiveDialogOpen(true);
  }, [mode]);

  React.useEffect(() => {
    let cancelled = false;
    getUserTradingMode()
      .then((res) => {
        if (!cancelled && (res.mode === "paper" || res.mode === "live")) {
          setMode(res.mode);
        }
      })
      .catch(() => {
        // Keep the safe local default when hydration cannot reach the server.
      });
    return () => {
      cancelled = true;
    };
  }, [setMode]);

  const isCompact = variant === "compact";

  return (
    <>
      <div
        role="group"
        aria-label="Trading mode"
        data-slot="paper-live-toggle"
        data-mode={mode}
        aria-busy={pendingMode != null}
        className={cn(
          "inline-flex items-stretch rounded-pill border border-border-strong bg-bg-elev-1",
          isCompact ? "h-7 p-0.5" : "h-7 p-0.5",
          className,
        )}
      >
        <button
          type="button"
          onClick={setPaper}
          disabled={pendingMode != null}
          aria-pressed={mode === "paper"}
          aria-label={`Paper trading${mode === "paper" ? " (active)" : ""}`}
          className={cn(
            "inline-flex items-center justify-center rounded-pill px-2.5 text-eyebrow font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            mode === "paper"
              ? "bg-bg-elev-2 text-fg shadow-hair"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {isCompact ? "P" : "Paper"}
        </button>
        <button
          type="button"
          onClick={requestLive}
          disabled={pendingMode != null}
          aria-pressed={mode === "live"}
          aria-label={`Live trading${mode === "live" ? " (active)" : ""}`}
          className={cn(
            "inline-flex items-center justify-center rounded-pill px-2.5 text-eyebrow font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss",
            mode === "live"
              ? "bg-loss/90 text-loss-foreground shadow-hair"
              : "text-fg-muted hover:text-loss",
          )}
        >
          {isCompact ? "L" : "Live"}
        </button>
      </div>

      <Dialog open={liveDialogOpen} onOpenChange={setLiveDialogOpen}>
        <DialogContent className="max-w-md bg-[var(--bg-card)] border-border">
          <DialogHeader>
            <DialogTitle>Enable live trading</DialogTitle>
            <DialogDescription>
              Enter your current 2FA code to commit live mode on the server.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-label font-medium text-muted-foreground">
            <span>2FA code</span>
            <input
              value={liveTotpCode}
              onChange={(event) => setLiveTotpCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-9 w-full rounded-md border border-border bg-[var(--panel)] px-3 font-mono text-sm text-foreground outline-none focus:border-brand"
              placeholder="123456"
            />
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setLiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={liveTotpCode.trim().length < 6 || pendingMode != null}
              onClick={() => void commitMode("live", liveTotpCode.trim() || undefined)}
            >
              Enable live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
