/**
 * Wave C (persona 74 P0 #1) — useWebSocket reconnect resume tests.
 *
 * Contract under test:
 *  1. On the first subscribe to a stream-backed channel (``trade_updates``,
 *     ``portfolio``) the hook sends ``last_id="$"`` — live-only, no replay.
 *  2. As messages arrive carrying an ``_id``, the hook updates its
 *     in-memory cursor for that channel.
 *  3. When the socket is closed by the server and the exponential-backoff
 *     reconnect fires, the re-subscribe frame carries the last recorded
 *     cursor — not ``"$"``.
 *  4. Non-stream channels (``quotes``, ``bars`` …) never include ``last_id``.
 *
 * We drive the hook in jsdom with a hand-rolled WebSocket mock that
 * captures outgoing frames, lets us dispatch fake server messages, and
 * lets us trigger onclose + onopen to exercise the reconnect path.
 */

import '../setup-mocks';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The real ``useDataPipeline`` pulls in the Next.js env/providers tree; we
// only need the exported ``fetchPortfolioData`` to be a no-op in unit tests
// since the portfolio re-fetch is out of scope for these resume-token tests.
vi.mock('@/hooks/useDataPipeline', () => ({
  fetchPortfolioData: vi.fn(),
}));

// ─── WebSocket mock ──────────────────────────────────────────────
//
// jsdom does not ship a real WebSocket. Replace the global with a mock
// that records outgoing ``send`` frames and exposes hooks we can call
// from the test body to simulate server-side events.

interface MockWebSocket {
  url: string;
  readyState: number;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  send: (data: string) => void;
  close: () => void;
  // Test helpers
  _sent: string[];
}

let activeSocket: MockWebSocket | null = null;
const constructedSockets: MockWebSocket[] = [];

class MockWebSocketImpl {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  _sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    activeSocket = this as unknown as MockWebSocket;
    constructedSockets.push(this as unknown as MockWebSocket);
  }

  send(data: string) {
    this._sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

// ─── Test setup/teardown ─────────────────────────────────────────

beforeEach(() => {
  activeSocket = null;
  constructedSockets.length = 0;
  // Prevent actual timers from firing — we drive reconnect manually.
  vi.useFakeTimers();
  // Replace the global WebSocket with our mock.
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocketImpl;
});

afterEach(() => {
  vi.useRealTimers();
});

// Helpers to simulate server side events.
function openSocket() {
  if (!activeSocket) throw new Error('no active socket');
  activeSocket.readyState = 1;
  activeSocket.onopen?.(new Event('open'));
  // The hook queues re-subscribe behind a 100ms setTimeout so the
  // backend has time to send the authenticated ack. Advance past it.
  vi.advanceTimersByTime(150);
}

function deliverMessage(payload: Record<string, unknown>) {
  if (!activeSocket) throw new Error('no active socket');
  const ev = new MessageEvent('message', { data: JSON.stringify(payload) });
  activeSocket.onmessage?.(ev);
}

function closeSocket() {
  if (!activeSocket) throw new Error('no active socket');
  activeSocket.readyState = 3;
  activeSocket.onclose?.(new CloseEvent('close'));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('useWebSocket Wave C resume tokens', () => {
  it('sends last_id="$" on first subscribe to trade_updates', async () => {
    const { useWebSocket } = await import('@/hooks/useWebSocket');
    const { result } = renderHook(() => useWebSocket());

    // Subscribe, then open — subscribe happens immediately on the client
    // but the re-subscribe frame is sent inside the onopen setTimeout.
    act(() => {
      result.current.subscribe('trade_updates');
    });
    act(() => {
      openSocket();
    });

    const sent = activeSocket!._sent.map((s) => JSON.parse(s));
    // We expect a subscribe frame for trade_updates with last_id="$"
    // (live-only, no replay — we have no prior cursor yet).
    const tu = sent.find(
      (m) => m.action === 'subscribe' && m.channel === 'trade_updates',
    );
    expect(tu).toBeDefined();
    expect(tu.last_id).toBe('$');
  });

  it('does NOT include last_id on non-stream channels', async () => {
    const { useWebSocket } = await import('@/hooks/useWebSocket');
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.subscribe('quotes');
    });
    act(() => {
      openSocket();
    });

    const sent = activeSocket!._sent.map((s) => JSON.parse(s));
    const q = sent.find(
      (m) => m.action === 'subscribe' && m.channel === 'quotes',
    );
    expect(q).toBeDefined();
    // ``last_id`` field must NOT be on quotes/bars/alerts/agents frames.
    expect('last_id' in q).toBe(false);
  });

  it('records last_id from incoming trade_updates messages', async () => {
    const { useWebSocket } = await import('@/hooks/useWebSocket');
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.subscribe('trade_updates');
    });
    act(() => {
      openSocket();
    });

    // Deliver two events, each carrying a stream _id on the envelope.
    // This mirrors the broadcast path in backend/api/websocket/handler.py
    // where we inject _id from the xadd return value.
    act(() => {
      deliverMessage({
        channel: 'trade_updates',
        data: { event: 'fill', symbol: 'AAPL' },
        _id: '1700000000001-0',
      });
    });
    act(() => {
      deliverMessage({
        channel: 'trade_updates',
        data: { event: 'fill', symbol: 'TSLA' },
        _id: '1700000000002-0',
      });
    });

    // Now simulate disconnect. On close the hook schedules a reconnect via
    // setTimeout(connect, delay) — advance timers to let it fire.
    activeSocket!._sent.length = 0;
    act(() => {
      closeSocket();
    });
    act(() => {
      // Reconnect backoff: base 1000ms. Advance well past it.
      vi.advanceTimersByTime(5_000);
    });

    // A new WebSocket must have been constructed for the reconnect.
    expect(constructedSockets.length).toBeGreaterThanOrEqual(2);
    act(() => {
      openSocket();
    });

    // The re-subscribe frame for trade_updates must now include the
    // last recorded cursor (the later of the two _ids we delivered).
    const sent = activeSocket!._sent.map((s) => JSON.parse(s));
    const tu = sent.find(
      (m) => m.action === 'subscribe' && m.channel === 'trade_updates',
    );
    expect(tu).toBeDefined();
    expect(tu.last_id).toBe('1700000000002-0');
  });

  it('falls back to last_id="$" if no message was ever received', async () => {
    const { useWebSocket } = await import('@/hooks/useWebSocket');
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.subscribe('portfolio');
    });
    act(() => {
      openSocket();
    });
    // No messages delivered. Disconnect immediately.
    activeSocket!._sent.length = 0;
    act(() => {
      closeSocket();
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => {
      openSocket();
    });

    const sent = activeSocket!._sent.map((s) => JSON.parse(s));
    const pf = sent.find(
      (m) => m.action === 'subscribe' && m.channel === 'portfolio',
    );
    expect(pf).toBeDefined();
    expect(pf.last_id).toBe('$');
  });

  it('accepts _id nested inside data (replay envelope)', async () => {
    const { useWebSocket } = await import('@/hooks/useWebSocket');
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.subscribe('trade_updates');
    });
    act(() => {
      openSocket();
    });

    // Replay path writes _id into the top-level envelope; the handler
    // also accepts _id inside data for defensiveness.
    act(() => {
      deliverMessage({
        channel: 'trade_updates',
        data: { event: 'fill', symbol: 'AAPL', _id: '1700000003000-0' },
      });
    });

    activeSocket!._sent.length = 0;
    act(() => {
      closeSocket();
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => {
      openSocket();
    });

    const sent = activeSocket!._sent.map((s) => JSON.parse(s));
    const tu = sent.find(
      (m) => m.action === 'subscribe' && m.channel === 'trade_updates',
    );
    expect(tu.last_id).toBe('1700000003000-0');
  });
});
