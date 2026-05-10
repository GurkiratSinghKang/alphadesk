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
import { useQueryClient } from "@tanstack/react-query";
import { useWs } from "@/lib/providers";
import { useToast } from "@/hooks/useToast";
import { useNotificationsStore, type NotificationCategory } from "@/stores/notifications";
import { shouldNotify } from "@/lib/notificationPrefs";
import { fetchPortfolioData } from "@/hooks/useDataPipeline";
import { getNotifications } from "@/lib/api";

type FillPayload = {
  symbol?: string;
  side?: string;
  quantity?: number;
  qty?: number;
  price?: number;
  fill_price?: number;
  order_id?: string;
  status?: string;
  message?: string;
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

function safeSymbol(
  p: FillPayload | AlertPayload | PipelinePayload | null | undefined,
): string {
  if (!p) return "";
  return "symbol" in p ? p.symbol ?? "" : "";
}

function wsEvent(msg: { event?: string }): string {
  return msg.event ?? "";
}

export function useNotifications() {
  // Wave 14: was `useWebSocket()` which opened a second WebSocket connection
  // per tab (perf-audit-r3 P0). Switched to `useWs()` so we share the single
  // socket owned by `WebSocketProvider` in `lib/providers.tsx`.
  const { subscribe, onMessage } = useWs();
  const addNotification = useNotificationsStore((s) => s.addNotification);
  const { toast } = useToast();
  // Wave 6α Fix 8 (persona-124 P2): broker trade_updates (fill /
  // partial_fill / canceled) were previously surfaced as toasts only —
  // the underlying React Query caches (portfolioSummary, positions,
  // orders) waited out their 60-second poll before reflecting the new
  // reality. That fill-to-UI gap made the dashboard feel stale on every
  // trade. We now invalidate the three caches on every lifecycle event
  // so they refetch instantly while the WS notification is still on
  // screen.
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);

  // Keep a ref so listeners capture the latest pusher without re-subscribing
  const pushRef = useRef(addNotification);
  // Same trick for toast() — captured in a ref so the trade_updates listener
  // doesn't re-subscribe every render.
  const toastRef = useRef(toast);

  useEffect(() => {
    queryClientRef.current = queryClient;
    pushRef.current = addNotification;
    toastRef.current = toast;
  }, [addNotification, queryClient, toast]);

  // v2 backend hydration — on mount, pull the user's persisted
  // notifications from `/api/v1/notifications` and seed the local
  // store with anything not already there. The store stays the
  // single source of truth for the bell + alerts feed; this hook
  // just makes sure server-side notifications (issued while the
  // user was away) appear without waiting for a fresh WS event.
  // Maps backend `type` → frontend `NotificationCategory` 1:1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await getNotifications({ limit: 50 });
        if (cancelled) return;
        const known = new Set(
          useNotificationsStore.getState().notifications.map((n) => n.title + ":" + n.detail),
        );
        for (const n of remote) {
          const dedupeKey = `${n.title}:${n.body}`;
          if (known.has(dedupeKey)) continue;
          // Map backend category to local taxonomy. Backend types
          // (fill / agent / risk / system / billing / support) are a
          // subset of the local NotificationCategory union, so the
          // cast is sound at runtime.
          pushRef.current({
            category: n.type as NotificationCategory,
            title: n.title,
            detail: n.body,
            icon: undefined,
          });
        }
      } catch {
        // Silent — the store stays driven by WS events + custom
        // events when the API is unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount; re-running on every store change would
    // double-push the local entries we just added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const event = wsEvent(msg);
      const data = (msg.data ?? {}) as FillPayload;
      // Portfolio channel is multiplexed — only react to the "fill"/"order-filled"
      // style events. Unknown events are ignored, not turned into noise.
      if (
        event === "fill" ||
        event === "order_filled" ||
        event === "order-filled" ||
        data.status === "filled"
      ) {
        // Wave 6α Fix 8: invalidate portfolio/positions/orders caches on
        // legacy ``portfolio`` fill events too. The trade_updates
        // handler below covers the Alpaca-native event stream, but some
        // backend paths still fan out via the older ``portfolio``
        // channel — miss invalidating here and the dashboard stays
        // stale for up to a minute on those paths.
        const qc = queryClientRef.current;
        qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
        qc.invalidateQueries({ queryKey: ["positions"] });
        qc.invalidateQueries({ queryKey: ["orders"] });

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
        // Rejection also invalidates — the order's status transition
        // must be reflected in the desk's Orders tab.
        const qc = queryClientRef.current;
        qc.invalidateQueries({ queryKey: ["orders"] });
        const sym = safeSymbol(data) || "—";
        maybePush(
          "trades",
          "orderFills", // rejected counts under order fills bucket
          `Order rejected: ${sym}`,
          data.message || "Broker rejected the order",
          "rejected"
        );
      }
    });
    return unsub;
  }, [onMessage]);

  // ─── Alert triggers ──────────────────────────────────────────
  useEffect(() => {
    const unsub = onMessage("alerts", (msg) => {
      const event = wsEvent(msg);
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
      const topEvent = wsEvent(msg);
      const data = (msg.data ?? {}) as TradeUpdatePayload;
      const event = (data.event ?? topEvent ?? "").toLowerCase();
      if (!event) return;

      // Wave 6α Fix 8: invalidate the three React Query caches that
      // reflect broker-side state on EVERY lifecycle event we surface.
      // The broker just told us something material changed — waiting
      // for the 60s poll tick to catch up is unacceptable given the
      // notification is already on screen. Scope to the events that
      // truly alter portfolio state (fill / partial_fill / canceled /
      // rejected); ignore lifecycle noise like ``new`` / ``replaced``.
      const INVALIDATE_EVENTS = new Set([
        "fill",
        "partial_fill",
        "partially_filled",
        "canceled",
        "cancelled",
        "rejected",
      ]);
      const isInvalidating =
        INVALIDATE_EVENTS.has(event) ||
        data.status === "filled" ||
        data.status === "canceled" ||
        data.status === "rejected";
      if (isInvalidating) {
        const qc = queryClientRef.current;
        // queryKey shapes match useQueries.ts — don't drift.
        qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
        qc.invalidateQueries({ queryKey: ["positions"] });
        qc.invalidateQueries({ queryKey: ["orders"] });
        // Dashboard/store consumers read broker state from Zustand, not these
        // query keys. Hydrate the store immediately so the visible book moves
        // with the fill/reject toast instead of waiting for reconnect/manual refresh.
        fetchPortfolioData();
      }

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
