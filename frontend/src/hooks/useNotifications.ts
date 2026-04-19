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
import { useToast } from "@/hooks/useToast";
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

/**
 * Alpaca broker ``trade_updates`` payload shape — normalised server-side by
 * ``backend/data/ingestion/alpaca_stream.py::_run_trade_updates_stream``.
 * Every numeric field is optional because partial_fill / canceled events
 * may omit some of them.
 */
type TradeUpdatePayload = {
  event?: string; // fill | partial_fill | canceled | rejected | new | ...
  symbol?: string;
  side?: string;
  qty?: number;
  filled_qty?: number;
  fill_price?: number;
  order_id?: string;
  status?: string;
  reject_reason?: string;
  timestamp?: string;
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
  const { toast } = useToast();

  // Keep a ref so listeners capture the latest pusher without re-subscribing
  const pushRef = useRef(addNotification);
  pushRef.current = addNotification;
  // Same trick for toast() — captured in a ref so the trade_updates listener
  // doesn't re-subscribe every render.
  const toastRef = useRef(toast);
  toastRef.current = toast;

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
    // Alpaca broker trade_updates (fill / partial_fill / canceled / rejected)
    // are fanned out to this channel by backend/data/ingestion/alpaca_stream.py
    // (persona-r P27/P43). The subscribe call is idempotent — safe to call on
    // every mount.
    subscribe("trade_updates");
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

  // ─── Alpaca trade_updates (fills / cancels / rejects) ────────
  //
  // The backend publishes one message per lifecycle event (see
  // backend/data/ingestion/alpaca_stream.py). We surface:
  //   * `fill`          → "Filled: BUY 100 AAPL @ $182.34" (success toast)
  //   * `partial_fill`  → "Partial: BUY 23/100 AAPL @ $182.34" (info toast)
  //   * `rejected`      → "Rejected: … (reason)" (error toast)
  //   * `canceled`      → "Canceled: BUY 100 AAPL" (info toast)
  //
  // All gated on the `orderFills` preference; lifecycle noise like `new`
  // and `done_for_day` is ignored (we only surface user-actionable events).
  useEffect(() => {
    const unsub = onMessage("trade_updates", (msg) => {
      // Server may send the event on either `msg.event` or inside `data`.
      const topEvent = (msg as any).event ?? "";
      const data = (msg.data ?? {}) as TradeUpdatePayload;
      const event = (data.event ?? topEvent ?? "").toLowerCase();
      if (!event) return;

      const sym = (data.symbol ?? "").toUpperCase() || "—";
      const side = (data.side ?? "").toUpperCase();
      const price = data.fill_price;
      const priceLabel = price != null && Number.isFinite(price) ? `@ $${price.toFixed(2)}` : "";

      if (event === "fill" || data.status === "filled") {
        const qty = data.filled_qty ?? data.qty ?? 0;
        if (!shouldNotify("orderFills")) return;
        const message = `Filled: ${side || "ORDER"} ${qty} ${sym}${priceLabel ? " " + priceLabel : ""}`;
        toastRef.current({ type: "success", message, duration: 6000 });
        pushRef.current({
          category: "trades",
          title: `${side || "ORDER"} ${qty} ${sym} filled`,
          detail: priceLabel ? `Filled ${priceLabel}` : "Order filled",
          icon: "check",
        });
      } else if (event === "partial_fill" || event === "partially_filled") {
        const filled = data.filled_qty ?? 0;
        const total = data.qty ?? 0;
        if (!shouldNotify("orderFills")) return;
        const qtyLabel = total > 0 ? `${filled}/${total}` : `${filled}`;
        const message = `Partial: ${side || "ORDER"} ${qtyLabel} ${sym}${priceLabel ? " " + priceLabel : ""}`;
        toastRef.current({ type: "info", message, duration: 5000 });
        pushRef.current({
          category: "trades",
          title: `Partial fill: ${sym}`,
          detail: `${qtyLabel} filled${priceLabel ? " " + priceLabel : ""}`,
          icon: "check",
        });
      } else if (event === "rejected" || data.status === "rejected") {
        if (!shouldNotify("orderFills")) return;
        const reason = data.reject_reason || "Broker rejected the order";
        toastRef.current({
          type: "error",
          message: `Rejected: ${side || "ORDER"} ${sym} — ${reason}`,
          duration: 8000,
        });
        pushRef.current({
          category: "trades",
          title: `Order rejected: ${sym}`,
          detail: reason,
          icon: "rejected",
        });
      } else if (event === "canceled" || event === "cancelled" || data.status === "canceled") {
        if (!shouldNotify("orderFills")) return;
        const qty = data.qty ?? 0;
        toastRef.current({
          type: "info",
          message: `Canceled: ${side || "ORDER"} ${qty} ${sym}`,
          duration: 4000,
        });
        pushRef.current({
          category: "trades",
          title: `Order canceled: ${sym}`,
          detail: `${side || "ORDER"} ${qty} canceled`,
          icon: "check",
        });
      }
      // Other events (new, done_for_day, replaced, expired, suspended…) are
      // intentionally ignored — they are lifecycle noise, not actionable.
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
