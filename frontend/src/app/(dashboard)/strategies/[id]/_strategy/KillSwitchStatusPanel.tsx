"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";
import {
  emergencyDisableStrategy,
  getStrategyDisabledEvents,
  reEnableStrategy,
  type DisabledEvent,
} from "@/lib/api";

const LAYER_LABELS: Record<number, string> = {
  1: "Drawdown",
  2: "Daily P&L",
  3: "Manual",
};

export interface KillSwitchStatusPanelProps {
  strategyId: string;
  strategyName: string;
  className?: string;
}

function formatTriggeredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * KillSwitchStatusPanel
 * ─────────────────────
 * Health panel for a single strategy showing kill-switch state. Operators
 * can emergency-disable (Layer 3) and re-enable from this panel. Layer 1
 * and Layer 2 (auto-managed) disables surface here read-only — clearing
 * a Layer 1 requires SQL per KILL_SWITCH.md.
 *
 * Auth: emergency-disable / re-enable endpoints require admin. Non-admin
 * users will see the read-only state with no actionable buttons.
 */
export default function KillSwitchStatusPanel({
  strategyId,
  strategyName,
  className,
}: KillSwitchStatusPanelProps): React.JSX.Element {
  const [events, setEvents] = useState<DisabledEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getStrategyDisabledEvents(strategyId, showHistory);
      setEvents(data);
      setError(null);
      setForbidden(false);
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to load disabled events";
      // The panel is admin-only; surface 401/403 quietly so it doesn't blare
      // on a regular user's strategy page.
      if (msg.includes("401") || msg.includes("403")) {
        setForbidden(true);
        setEvents([]);
      } else {
        setError(msg);
      }
    }
  }, [strategyId, showHistory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (forbidden) {
    // Hide the panel for non-admin users.
    return <></>;
  }

  if (events === null) {
    return (
      <section className={cn("rounded border border-line p-4", className)}>
        <Eyebrow>Kill-switch status</Eyebrow>
        <p className="mt-2 text-sm text-fg-muted">Loading…</p>
      </section>
    );
  }

  const activeEvent = events.find((e) => e.resolved_at === null) ?? null;

  const handleDisable = async (): Promise<void> => {
    if (!reason.trim()) {
      setError("Reason is required for emergency disable.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await emergencyDisableStrategy(strategyId, reason.trim());
      if (!result.success && result.message !== "already_disabled") {
        setError(`Disable failed: ${result.message}`);
      }
      setReason("");
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? "Disable failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReEnable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await reEnableStrategy(strategyId);
      if (!result.success && result.message !== "no_active_disable") {
        setError(`Re-enable failed: ${result.message}`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? "Re-enable failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn("rounded border border-line p-4 space-y-3", className)}>
      <header className="flex items-center justify-between">
        <Eyebrow>Kill-switch status</Eyebrow>
        {/* Audit A-F6 (2026-05-05): the indicator dot was a bare ``<span>``
         * with ``aria-label`` only — no role + no live region. Screen-
         * reader users got no announcement when the strategy state
         * transitioned (e.g. an admin emergency-disabled a strategy
         * mid-session). ``role="status"`` + ``aria-live="polite"``
         * announces the new state without interrupting the user, and
         * the visible text inside the span gives SR users the same
         * label sighted users get from the colour. */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-label",
            activeEvent ? "text-loss" : "text-profit",
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={cn(
              "inline-block w-2.5 h-2.5 rounded-full",
              activeEvent ? "bg-loss" : "bg-profit",
            )}
            aria-hidden="true"
          />
          <span className="sr-only md:not-sr-only">
            {activeEvent ? "Disabled" : "Enabled"}
          </span>
        </span>
      </header>

      {error && (
        <p className="text-sm text-loss" role="alert">
          {error}
        </p>
      )}

      {activeEvent ? (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{strategyName}</strong> is disabled by Layer{" "}
            <Mono>{activeEvent.layer}</Mono> ({LAYER_LABELS[activeEvent.layer] ?? "?"}).
          </p>
          {activeEvent.reason && (
            <p className="text-fg-muted">Reason: {activeEvent.reason}</p>
          )}
          <p className="text-label text-fg-muted">
            Triggered: {formatTriggeredAt(activeEvent.triggered_at)}
            {activeEvent.manual_actor ? ` by ${activeEvent.manual_actor}` : ""}
          </p>
          {activeEvent.layer === 3 ? (
            <button
              type="button"
              onClick={handleReEnable}
              disabled={busy}
              className="rounded border border-line px-3 py-1 text-sm hover:bg-bg-muted disabled:opacity-50"
            >
              {busy ? "Re-enabling…" : "Re-enable"}
            </button>
          ) : (
            <p className="text-label italic text-fg-muted">
              Layer {activeEvent.layer} is auto-managed; clear via SQL (see KILL_SWITCH.md).
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-profit">Strategy is enabled — no active kill-switch trigger.</p>
          <details>
            <summary className="cursor-pointer text-sm text-fg-muted">
              Emergency disable
            </summary>
            <div className="mt-2 space-y-2">
              <label className="block text-label font-medium">
                Reason (required)
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. data feed degraded"
                  className="mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-sm"
                  maxLength={500}
                />
              </label>
              <button
                type="button"
                onClick={handleDisable}
                disabled={busy || !reason.trim()}
                className="rounded border border-loss px-3 py-1 text-sm text-loss hover:bg-loss hover:text-bg disabled:opacity-50"
              >
                {busy ? "Disabling…" : "Emergency disable"}
              </button>
            </div>
          </details>
        </div>
      )}

      <div className="border-t border-line pt-2">
        <label className="flex items-center gap-2 text-label text-fg-muted">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(e) => setShowHistory(e.target.checked)}
          />
          Include resolved events
        </label>
        {showHistory && events.length > 0 && (
          <ul className="mt-2 space-y-1 text-label">
            {events.map((ev) => (
              <li
                key={ev.id}
                className={cn(
                  "p-1 rounded",
                  ev.resolved_at ? "text-fg-muted" : "bg-loss/10",
                )}
              >
                <Mono>L{ev.layer}</Mono> {formatTriggeredAt(ev.triggered_at)} —{" "}
                {ev.reason ?? "(no reason)"}
                {ev.resolved_at ? (
                  <span className="ml-2 text-profit">
                    resolved {formatTriggeredAt(ev.resolved_at)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
