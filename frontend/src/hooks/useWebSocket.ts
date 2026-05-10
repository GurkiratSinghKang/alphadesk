"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "@/env";
import { fetchPortfolioData } from "@/hooks/useDataPipeline";

type WsChannel = "quotes" | "portfolio" | "alerts" | "agents" | "bars" | "trade_updates" | "notifications";

// Wave C (persona 74 P0 #1): channels that the backend backs with a Redis
// Stream. For these, we track the ``last_id`` we've seen in memory and
// send it on re-subscribe after a reconnect so the server can replay any
// events we missed while disconnected. No persistence across reloads —
// treat a page refresh as a fresh session (``last_id=$`` live-only).
const STREAM_BACKED_CHANNELS: ReadonlySet<WsChannel> = new Set<WsChannel>([
  "trade_updates",
  "portfolio",
]);

// long-session-audit-r4 P1 #9 (defence-in-depth): hard allow-list of
// channel names. Any dispatch to a channel outside this set is rejected.
// Mirrors the server-side check in backend/api/websocket/handler.py:49-51
// — if a future code path ever `subscribe(symbol)`'s dynamically, the set
// can't grow unbounded. `trade_updates` was added for Alpaca fill/reject
// fan-out (persona-r P27/P43); see backend/core/redis.py:CHANNEL_TRADE_UPDATES.
const ALL_CHANNELS: readonly WsChannel[] = [
  "quotes",
  "portfolio",
  "alerts",
  "agents",
  "bars",
  "trade_updates",
] as const;
const ALL_CHANNELS_SET: ReadonlySet<string> = new Set<string>(ALL_CHANNELS);
function isValidChannel(channel: string): channel is WsChannel {
  return ALL_CHANNELS_SET.has(channel);
}

/**
 * WebSocket connection status for the dashboard UI.
 *   - "connecting": initial TCP/WS handshake in flight, no prior success
 *   - "open": authenticated and streaming
 *   - "reconnecting": previous connection dropped, exponential backoff retry in flight
 *   - "failed": MAX_RETRIES exhausted, stream is dead until user action
 */
export type WsStatus = "connecting" | "open" | "reconnecting" | "failed";

interface WsMessage {
  channel: WsChannel;
  event: string;
  data: unknown;
}

interface UseWebSocketReturn {
  subscribe: (channel: WsChannel) => void;
  unsubscribe: (channel: WsChannel) => void;
  send: (channel: WsChannel, event: string, data?: unknown) => void;
  isConnected: boolean;
  /**
   * Lifecycle status for the shared WebSocket — consumers (e.g. a status
   * banner) should render "reconnecting" / "failed" affordances instead of
   * relying on the binary `isConnected` flag. See edge-cases-audit-r3 D/P0.
   */
  wsStatus: WsStatus;
  /** Subscribe to messages on a specific channel. Returns an unsubscribe function. */
  onMessage: (channel: WsChannel, callback: (data: WsMessage) => void) => () => void;
}

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Round-28 / persona-E P1: client-originated heartbeat. Pre-fix the
  // backend handler responds to ``{action:"ping"}`` but the FE never
  // sends one, so half-open TCP connections (NAT timeout, transparent
  // proxy reset, laptop sleep) sit invisible for ~2 hours until the
  // OS keepalive trips. Send ping every 30s while open; if we don't
  // see a pong (or any message) in 90s, force-close to trigger the
  // reconnect path.
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const lastMessageAtRef = useRef<number>(0);
  // long-session-audit-r4 P2: track the re-subscribe timeout so we can
  // cancel it on reconnect / visibility change. Previously the 100ms
  // setTimeout could fire on an already-closed socket, raising
  // `InvalidStateError` in ws.send.
  const subscribeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedChannels = useRef<Set<WsChannel>>(new Set());
  // Wave C: per-channel resume cursor. Updated as we receive messages
  // carrying an `_id` field. On reconnect we send this in the subscribe
  // frame so the backend replays anything we missed.
  const lastIdsRef = useRef<Map<WsChannel, string>>(new Map());
  // Wave C: track whether we've ever been "open" so we can distinguish
  // reconnecting -> open (needs portfolio re-fetch) from first-ever
  // connect (the initial fetch lives in useDataPipeline).
  const hasBeenOpenRef = useRef(false);
  // Wave C: remember the last `wsStatus` we emitted so the reconnect
  // re-fetch only fires exactly once per reconnecting -> open transition,
  // not on every successful connect.
  const prevStatusRef = useRef<WsStatus>("connecting");

  const [isConnected, setIsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");

  // Channel-based callback system: dispatches to subscribers without triggering React re-renders
  const channelCallbacksRef = useRef<Map<WsChannel, Set<(data: WsMessage) => void>>>(new Map());

  // Wave C: network-recovery listener state — declared up-front so the
  // connect callback can reference registerNetworkRecoveryRef without a
  // temporal-dead-zone concern. The ref is populated below after connect
  // is defined.
  const recoveryInstalledRef = useRef(false);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const registerNetworkRecoveryRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    // Cancel any pending reconnect
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    // Cancel any pending re-subscribe timer from a prior socket — without
    // this, a stale callback fires on the new socket and may race the open
    // handshake (or worse, fire after the socket is closed).
    if (subscribeTimeoutRef.current) {
      clearTimeout(subscribeTimeoutRef.current);
      subscribeTimeoutRef.current = null;
    }

    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      // Prefer explicit NEXT_PUBLIC_WS_URL when set; otherwise use a
      // same-origin /ws upgrade (nginx proxies to FastAPI's /ws endpoint
      // per backend/main.py:168). If the harness ever reports "no WS
      // traffic" in the network log again, verify (a) nginx forwards
      // /ws with Upgrade/Connection headers and (b) the auth cookie is
      // set before this component mounts.
      const wsUrl = env.WS_URL || (
        typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
          : "ws://localhost:8000/ws"
      );
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Auth: the access_token is HttpOnly, so JS cannot read it. The
        // browser attaches same-origin cookies to the WebSocket Upgrade
        // request automatically, and the backend
        // (backend/api/websocket/handler.py:197) reads
        // `ws.cookies.get("access_token")` on connect and responds with
        // `{"type": "authenticated"}`. No client-side auth frame needed.
        setIsConnected(true);
        // Wave C (persona 74 P0 #2): a reconnecting -> open transition
        // means the UI may have stale portfolio data (positions/orders).
        // Trigger a one-shot re-fetch. Fire BEFORE we flip wsStatus so
        // the refetch is causally associated with this reconnect.
        const wasReconnecting = prevStatusRef.current === "reconnecting";
        if (wasReconnecting && hasBeenOpenRef.current) {
          try {
            fetchPortfolioData();
          } catch {
            // fetchPortfolioData swallows its own errors internally; the
            // try is just defensive so a hypothetical top-level throw
            // can't derail the rest of onopen.
          }
        }
        prevStatusRef.current = "open";
        hasBeenOpenRef.current = true;
        setWsStatus("open");
        retriesRef.current = 0;
        // Heartbeat: ping every 30s; if no message arrives within 90s
        // close the socket so the reconnect path fires.
        lastMessageAtRef.current = Date.now();
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const idleMs = Date.now() - lastMessageAtRef.current;
          if (idleMs > 90_000) {
            try { ws.close(); } catch { /* noop */ }
            return;
          }
          try {
            ws.send(JSON.stringify({ action: "ping" }));
          } catch { /* noop — close will surface via onclose */ }
        }, 30_000);

        // Re-subscribe to all channels after a short delay so the backend
        // has time to send the `authenticated` ack before we flood it with
        // subscribe frames. Track the handle + check readyState in the
        // callback so we don't send on a closed socket.
        if (subscribeTimeoutRef.current) {
          clearTimeout(subscribeTimeoutRef.current);
        }
        subscribeTimeoutRef.current = setTimeout(() => {
          subscribeTimeoutRef.current = null;
          if (ws.readyState !== WebSocket.OPEN) return;
          subscribedChannels.current.forEach((channel) => {
            // Wave C: for stream-backed channels, include last_id so the
            // backend replays anything we missed during the disconnect.
            // Fresh subscribers (no prior cursor) get live-only ("$"),
            // which matches the pre-Wave-C behaviour.
            const payload: Record<string, unknown> = { action: "subscribe", channel };
            if (STREAM_BACKED_CHANNELS.has(channel)) {
              payload.last_id = lastIdsRef.current.get(channel) ?? "$";
            }
            ws.send(JSON.stringify(payload));
          });
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          // Heartbeat liveness: stamp last-message-time on every frame
          // (including the pong response). The 90s idle threshold above
          // uses this to decide when to force-close a half-open socket.
          lastMessageAtRef.current = Date.now();
          const msg = JSON.parse(event.data) as WsMessage & { _id?: string; data?: { _id?: string } };
          // Dispatch to channel-specific callbacks (no React re-render).
          // The previous `setLastMessage(msg)` call was removed in Wave 14
          // because it re-rendered every component consuming `useWs()` on
          // every WS frame (perf-audit-r3 P0). `onMessage(channel, cb)` is
          // the only supported consumption path.
          const channel = msg.channel ?? (msg as unknown as Record<string, unknown>).type as WsChannel | undefined;
          // Round-29 / persona-E F2: backend may send a one-shot
          // ``cursor_expired`` notice when a stale resume cursor is
          // refused. Drop our stored cursor so the next reconnect
          // starts fresh from "$" instead of replaying again with the
          // same expired ID.
          const msgType = (msg as unknown as Record<string, unknown>).type;
          if (msgType === "cursor_expired") {
            const expiredChannel = (msg as unknown as Record<string, unknown>).channel as WsChannel | undefined;
            if (expiredChannel) {
              lastIdsRef.current.delete(expiredChannel);
            }
          }
          if (channel) {
            // Wave C: capture the stream ID cursor for stream-backed
            // channels so we can resume on reconnect. The backend writes
            // `_id` either on the top-level message envelope (broadcast
            // path) or inside `data` (replay path).
            if (STREAM_BACKED_CHANNELS.has(channel)) {
              const id = msg._id ?? msg.data?._id;
              if (typeof id === "string" && id.length) {
                lastIdsRef.current.set(channel, id);
              }
            }
            const callbacks = channelCallbacksRef.current.get(channel);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg));
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        // error handling is done in onclose
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Stop the heartbeat timer; the new socket (after reconnect)
        // will install its own.
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = undefined;
        }
        // Only clear ref if this is still the active socket
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        // Exponential backoff reconnect with jitter (full jitter) so
        // multi-tab / cross-client reconnects don't synchronise into a
        // thundering herd when the backend recovers.
        if (retriesRef.current < MAX_RETRIES) {
          const capped = Math.min(
            BASE_DELAY * Math.pow(2, retriesRef.current),
            MAX_DELAY
          );
          const delay = Math.floor(Math.random() * capped);
          retriesRef.current++;
          prevStatusRef.current = "reconnecting";
          setWsStatus("reconnecting");
          // eslint-disable-next-line react-hooks/immutability -- self-recursive: schedule retries via this same useCallback. The closure captures the stable identity.
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else {
          prevStatusRef.current = "failed";
          setWsStatus("failed");
          // Wave C: MAX_RETRIES exhausted. Register a one-shot `online`
          // listener so that when the user's network transport comes
          // back (e.g. after a WiFi drop) we retry immediately instead
          // of sitting in "failed" forever. Also listen for
          // navigator.connection 'change' events (4G -> WiFi transitions
          // don't always fire `online`). Both handlers are attached via
          // registerNetworkRecovery so they can share the reset logic.
          registerNetworkRecoveryRef.current();
        }
      };
    } catch {
      // Schedule retry (same jittered backoff as onclose)
      if (retriesRef.current < MAX_RETRIES) {
        const capped = Math.min(
          BASE_DELAY * Math.pow(2, retriesRef.current),
          MAX_DELAY
        );
        const delay = Math.floor(Math.random() * capped);
        retriesRef.current++;
        prevStatusRef.current = "reconnecting";
        setWsStatus("reconnecting");
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        prevStatusRef.current = "failed";
        setWsStatus("failed");
        registerNetworkRecoveryRef.current();
      }
    }
  }, []);

  // Wave C: one-shot network-recovery handler. We install listeners for
  // `online` and (where supported) `navigator.connection.change` and use
  // the first one to fire to reset retries and reconnect. Guard flags
  // are declared at the top of the hook so the connect callback can
  // reach them without a TDZ.
  useEffect(() => {
    registerNetworkRecoveryRef.current = () => {
      if (typeof window === "undefined") return;
      if (recoveryInstalledRef.current) return;
      recoveryInstalledRef.current = true;

      const recover = () => {
        // Exit if the listeners fired but the socket already recovered
        // via a visibility-change path (reconnect is idempotent but we
        // still guard to avoid double-connect churn).
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
        retriesRef.current = 0;
        prevStatusRef.current = "connecting";
        setWsStatus("connecting");
        // Tear down the listeners so we don't retry repeatedly on every
        // network-type flicker while connected.
        if (recoveryCleanupRef.current) {
          recoveryCleanupRef.current();
          recoveryCleanupRef.current = null;
        }
        recoveryInstalledRef.current = false;
        connect();
      };

      window.addEventListener("online", recover);
      // `navigator.connection` is non-standard but widely supported
      // outside Safari. Use feature-detection; treat as best-effort.
      // The Network Information API's `change` event fires on
      // transitions like 4G -> WiFi even when `online` doesn't.
      const nav = navigator as Navigator & {
        connection?: { addEventListener?: (t: string, h: EventListener) => void; removeEventListener?: (t: string, h: EventListener) => void };
      };
      const conn = nav.connection;
      if (conn && typeof conn.addEventListener === "function") {
        conn.addEventListener("change", recover);
      }

      recoveryCleanupRef.current = () => {
        window.removeEventListener("online", recover);
        if (conn && typeof conn.removeEventListener === "function") {
          conn.removeEventListener("change", recover);
        }
      };
    };
  }, [connect]);

  // Wave C: cleanup recovery listeners on unmount so dev hot-reload and
  // logout teardown don't leak handlers across provider remounts.
  useEffect(() => {
    return () => {
      if (recoveryCleanupRef.current) {
        recoveryCleanupRef.current();
        recoveryCleanupRef.current = null;
      }
      recoveryInstalledRef.current = false;
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (subscribeTimeoutRef.current) {
        clearTimeout(subscribeTimeoutRef.current);
        subscribeTimeoutRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = undefined;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Reset retry counter and reconnect when the tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          retriesRef.current = 0;
          setWsStatus("connecting");
          connect();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [connect]);

  const subscribe = useCallback((channel: WsChannel) => {
    // long-session-audit-r4 P1 #9: validate against the hardcoded channel
    // list. Rejecting unknown channels keeps the subscribedChannels Set
    // bounded even if a future caller dispatches a dynamic value.
    if (!isValidChannel(channel)) return;
    subscribedChannels.current.add(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "subscribe", channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: WsChannel) => {
    if (!isValidChannel(channel)) return;
    subscribedChannels.current.delete(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "unsubscribe", channel }));
    }
  }, []);

  const send = useCallback(
    (channel: WsChannel, event: string, data?: unknown) => {
      if (!isValidChannel(channel)) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ channel, event, data }));
      }
    },
    []
  );

  const onMessage = useCallback((channel: WsChannel, callback: (data: WsMessage) => void) => {
    if (!isValidChannel(channel)) {
      // No-op unsubscribe so callers can still `return unsub` unconditionally.
      return () => undefined;
    }
    if (!channelCallbacksRef.current.has(channel)) {
      channelCallbacksRef.current.set(channel, new Set());
    }
    channelCallbacksRef.current.get(channel)!.add(callback);
    return () => {
      channelCallbacksRef.current.get(channel)?.delete(callback);
    };
  }, []);

  return { subscribe, unsubscribe, send, isConnected, wsStatus, onMessage };
}
