"use client";

/**
 * useNotifications
 * ────────────────
 * Notification producer. Wires real-time events from the websocket
 * (trade fills, alert triggers, pipeline completions) plus global
 * `alphadesk:*` custom events into the `useNotificationsStore` Zustand
 * slice. The NotificationCenter consumes the store — this hook produces.
 *
 * Each producer gates on the user's `notifications` preferences
 * (Settings → Notifications). If the user disables "Order Fills", a
 * fill WS event will update portfolio state but will NOT push a chip
 * into the bell. Alerts-triggered and pipeline-completed behave the
 * same.
 *
 * Mount this hook exactly once at the dashboard layout root — calling
 * it more than once would duplicate the event subscriptions.
 */

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { useNotificationsStore, type NotificationCategory } from "@/stores/notifications";
import { shouldNotify } from "@/lib/notificationPrefs";

type FillPayload = {
  symbol?: string;
  side?: string;
  quantity?: number;
  qty?: number;
  price?: number;
  fill_price?: number;
  order_id?: string;
  status?: string;
};

type AlertPayload = {
  symbol?: string;
  condition?: string;
  title?: string;
  message?: string;
  id?: string;
};

type PipelinePayload = {
  run_id?: string;
  status?: string;
  message?: string;
  completed_at?: string;
};

function safeSymbol(p: FillPayload | AlertPayload | PipelinePayload | null | undefined): string {
  if (!p) return "";
  return (p as any).symbol ?? "";
}

export function useNotifications() {
  // Wave 14: was `useWebSocket()` which opened a second WebSocket connection
  // per tab (perf-audit-r3 P0). Switched to `useWs()` so we share the single
  // socket owned by `WebSocketProvider` in `lib/providers.tsx`.
  const { subscribe, onMessage } = useWs();
  const addNotification = useNotificationsStore((s) => s.addNotification);

  // Keep a ref so listeners capture the latest pusher without re-subscribing
  const pushRef = useRef(addNotification);
  pushRef.current = addNotification;

  // Helper to push one notification of a category with its gating pref
  const maybePush = (
    category: NotificationCategory,
    prefKey: "orderFills" | "alertsTriggered" | "pipelineCompleted" | "strategyEvents" | null,
    title: string,
    detail: string,
    icon?: string
  ) => {
    if (prefKey && !shouldNotify(prefKey)) return;
    pushRef.current({ category, title, detail, icon });
  };

  // ─── WebSocket channel subscriptions ─────────────────────────
  useEffect(() => {
    // Ensure the WS is subscribed to portfolio (fills) and alerts channels.
    // Idempotent — the store tracks subscriptions and resends on reconnect.
    subscribe("portfolio");
    subscribe("alerts");
  }, [subscribe]);

  // ─── Trade fills (portfolio channel) ─────────────────────────
  useEffect(() => {
    const unsub = onMessage("portfolio", (msg) => {
      const event = (msg as any).event ?? "";
      const data = (msg.data ?? {}) as FillPayload;
      // Portfolio channel is multiplexed — only react to the "fill"/"order-filled"
      // style events. Unknown events are ignored, not turned into noise.
      if (
        event === "fill" ||
        event === "order_filled" ||
        event === "order-filled" ||
        data.status === "filled"
      ) {
        const qty = data.quantity ?? data.qty ?? 0;
        const price = data.fill_price ?? data.price;
        const sym = safeSymbol(data) || "—";
        const side = (data.side ?? "").toUpperCase() || "ORDER";
        const priceLabel = price != null ? `@ $${price.toFixed(2)}` : "";
        maybePush(
          "trades",
          "orderFills",
          `${side} ${qty} ${sym} filled`,
          priceLabel ? `Filled ${priceLabel}` : "Order filled",
          "check"
        );
      } else if (event === "order_rejected" || data.status === "rejected") {
        const sym = safeSymbol(data) || "—";
        maybePush(
          "trades",
          "orderFills", // rejected counts under order fills bucket
          `Order rejected: ${sym}`,
          (data as any).message || "Broker rejected the order",
          "rejected"
        );
      }
    });
    return unsub;
  }, [onMessage]);

  // ─── Alert triggers ──────────────────────────────────────────
  useEffect(() => {
    const unsub = onMessage("alerts", (msg) => {
      const event = (msg as any).event ?? "";
      const data = (msg.data ?? {}) as AlertPayload;
      if (event === "alert_triggered" || event === "triggered" || event === "alert") {
        const sym = safeSymbol(data) || "—";
        maybePush(
          "alerts",
          "alertsTriggered",
          data.title ?? `Alert triggered: ${sym}`,
          data.message ?? data.condition ?? "Condition met",
          "alert-triangle"
        );
      }
    });
    return unsub;
  }, [onMessage]);

  // ─── Pipeline completion (custom events from the pipeline page) ──
  useEffect(() => {
    function handlePipeline(e: Event) {
      const detail = (e as CustomEvent<PipelinePayload>).detail ?? {};
      const status = detail.status ?? "completed";
      const title =
        status === "completed" || status === "complete"
          ? "Pipeline complete"
          : status === "failed"
          ? "Pipeline failed"
          : `Pipeline ${status}`;
      maybePush(
        "pipeline",
        "pipelineCompleted",
        title,
        detail.message ?? `Run ${detail.run_id ?? ""}`.trim(),
        status === "failed" ? "alert-triangle" : "bot"
      );
    }
    window.addEventListener("alphadesk:pipeline-status", handlePipeline as EventListener);
    return () =>
      window.removeEventListener(
        "alphadesk:pipeline-status",
        handlePipeline as EventListener
      );
  }, []);

  // ─── System messages (api errors, workspace changes) ─────────
  useEffect(() => {
    function handleSystem(e: Event) {
      const detail = ((e as CustomEvent).detail ?? {}) as {
        title?: string;
        message?: string;
        kind?: string;
      };
      // System notifications are always on — they surface critical failures
      // that the user would otherwise miss (e.g. backend 5xx storms).
      pushRef.current({
        category: "system",
        title: detail.title ?? "System message",
        detail: detail.message ?? "",
        icon: detail.kind === "error" ? "alert-triangle" : "shield",
      });
    }
    window.addEventListener("alphadesk:system-notify", handleSystem as EventListener);
    return () =>
      window.removeEventListener(
        "alphadesk:system-notify",
        handleSystem as EventListener
      );
  }, []);
}
