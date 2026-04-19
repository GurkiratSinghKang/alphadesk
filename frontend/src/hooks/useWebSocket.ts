"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "@/env";

type WsChannel = "quotes" | "portfolio" | "alerts" | "agents" | "bars" | "trade_updates";

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
  // long-session-audit-r4 P2: track the re-subscribe timeout so we can
  // cancel it on reconnect / visibility change. Previously the 100ms
  // setTimeout could fire on an already-closed socket, raising
  // `InvalidStateError` in ws.send.
  const subscribeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedChannels = useRef<Set<WsChannel>>(new Set());

  const [isConnected, setIsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");

  // Channel-based callback system: dispatches to subscribers without triggering React re-renders
  const channelCallbacksRef = useRef<Map<WsChannel, Set<(data: WsMessage) => void>>>(new Map());

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
        setWsStatus("open");
        retriesRef.current = 0;

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
            ws.send(JSON.stringify({ action: "subscribe", channel }));
          });
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          // Dispatch to channel-specific callbacks (no React re-render).
          // The previous `setLastMessage(msg)` call was removed in Wave 14
          // because it re-rendered every component consuming `useWs()` on
          // every WS frame (perf-audit-r3 P0). `onMessage(channel, cb)` is
          // the only supported consumption path.
          const channel = msg.channel ?? (msg as unknown as Record<string, unknown>).type as WsChannel | undefined;
          if (channel) {
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
        // Only clear ref if this is still the active socket
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        // Exponential backoff reconnect
        if (retriesRef.current < MAX_RETRIES) {
          const delay = Math.min(
            BASE_DELAY * Math.pow(2, retriesRef.current),
            MAX_DELAY
          );
          retriesRef.current++;
          setWsStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else {
          setWsStatus("failed");
        }
      };
    } catch {
      // Schedule retry
      if (retriesRef.current < MAX_RETRIES) {
        const delay = Math.min(
          BASE_DELAY * Math.pow(2, retriesRef.current),
          MAX_DELAY
        );
        retriesRef.current++;
        setWsStatus("reconnecting");
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        setWsStatus("failed");
      }
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (subscribeTimeoutRef.current) {
        clearTimeout(subscribeTimeoutRef.current);
        subscribeTimeoutRef.current = null;
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
