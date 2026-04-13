"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "@/env";

type WsChannel = "quotes" | "portfolio" | "alerts" | "agents";

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
  lastMessage: WsMessage | null;
}

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subscribedChannels = useRef<Set<WsChannel>>(new Set());

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);

  const connect = useCallback(() => {
    // Cancel any pending reconnect
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }

    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const wsUrl = env.WS_URL || (
        typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
          : "ws://localhost:8000/ws"
      );
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send auth token first
        const token = document.cookie.match(/(?:^|; )access_token=([^;]*)/)?.[1];
        if (token) {
          ws.send(JSON.stringify({ action: "auth", token }));
        }

        setIsConnected(true);
        retriesRef.current = 0;

        // Re-subscribe to all channels after a short delay for auth to process
        setTimeout(() => {
          subscribedChannels.current.forEach((channel) => {
            ws.send(JSON.stringify({ action: "subscribe", channel }));
          });
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          setLastMessage(msg);
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
          reconnectTimerRef.current = setTimeout(connect, delay);
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
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Reset retry counter and reconnect when the tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && retriesRef.current >= MAX_RETRIES) {
        retriesRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [connect]);

  const subscribe = useCallback((channel: WsChannel) => {
    subscribedChannels.current.add(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "subscribe", channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: WsChannel) => {
    subscribedChannels.current.delete(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "unsubscribe", channel }));
    }
  }, []);

  const send = useCallback(
    (channel: WsChannel, event: string, data?: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ channel, event, data }));
      }
    },
    []
  );

  return { subscribe, unsubscribe, send, isConnected, lastMessage };
}
