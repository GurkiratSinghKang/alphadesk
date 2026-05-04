"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, Wifi, WifiOff, Clock, Gauge, MemoryStick, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

interface ApiTiming {
  url: string;
  duration: number;
  timestamp: number;
  status: number;
}

// ─── Module-level singleton timings (long-session-audit-r4 P0 #2) ──
//
// Previously the effect captured `originalFetch = window.fetch` then replaced
// `window.fetch` on every mount. Re-mounts (StrictMode double-invoke, fast
// refresh, future layout changes) chained wrappers — each new wrapper took the
// already-wrapped `window.fetch` as `originalFetch`, so every API call walked
// the entire chain and every wrapper's `timingsRef` closure was retained in
// memory forever.
//
// The fix is an idempotency guard: we wrap `window.fetch` exactly once per
// page and write timings to a module-level array that all PerformanceMetrics
// instances read from via the ref synchroniser below. Unwrapping is fragile
// (another consumer may have patched on top) so we leave the wrap installed
// for the life of the page.
let __fetchWrapped = false;
const __moduleTimings: ApiTiming[] = [];
const MAX_TIMINGS = 100;

function installFetchInterceptor() {
  if (__fetchWrapped) return;
  if (typeof window === "undefined") return;
  __fetchWrapped = true;
  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
    const isApi = url.includes("/api/") || url.includes("localhost:8000");
    const start = performance.now();
    try {
      const res = await originalFetch.apply(this, args);
      if (isApi) {
        const duration = performance.now() - start;
        __moduleTimings.push({
          url: url.replace(/^https?:\/\/[^/]+/, ""),
          duration: Math.round(duration),
          timestamp: Date.now(),
          status: res.status,
        });
        // Bounded FIFO — drop oldest on overflow to keep memory flat.
        if (__moduleTimings.length > MAX_TIMINGS) {
          __moduleTimings.splice(0, __moduleTimings.length - MAX_TIMINGS);
        }
      }
      return res;
    } catch (err) {
      if (isApi) {
        const duration = performance.now() - start;
        __moduleTimings.push({
          url: url.replace(/^https?:\/\/[^/]+/, ""),
          duration: Math.round(duration),
          timestamp: Date.now(),
          status: 0,
        });
        if (__moduleTimings.length > MAX_TIMINGS) {
          __moduleTimings.splice(0, __moduleTimings.length - MAX_TIMINGS);
        }
      }
      throw err;
    }
  };
}

interface PerformanceData {
  apiTimings: ApiTiming[];
  wsConnected: boolean;
  wsUptime: number; // seconds
  wsReconnects: number;
  pageLoadTime: number;
  activeSubscriptions: number;
  memoryUsageMB: number | null;
  avgResponseMs: number;
  p95ResponseMs: number;
  p99ResponseMs: number;
}

// ─── Performance Monitor Hook ───────────────────────────────

function usePerformanceMonitor() {
  const [data, setData] = useState<PerformanceData>({
    apiTimings: [],
    wsConnected: false,
    wsUptime: 0,
    wsReconnects: 0,
    pageLoadTime: 0,
    activeSubscriptions: 0,
    memoryUsageMB: null,
    avgResponseMs: 0,
    p95ResponseMs: 0,
    p99ResponseMs: 0,
  });

  const wsStartRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Install the fetch wrapper exactly once per page. Re-mounts are no-ops:
  // __fetchWrapped guards against chained wrappers (long-session-audit-r4 P0 #2).
  // Cleanup deliberately leaves the wrapper in place — unwrapping is fragile
  // when other code may have patched on top, and the singleton is safe to
  // leak for the life of the page.
  useEffect(() => {
    installFetchInterceptor();
  }, []);

  // Track WebSocket state
  useEffect(() => {
    let reconnects = 0;

    const handleWsOpen = () => {
      wsStartRef.current = Date.now();
    };
    const handleWsClose = () => {
      reconnects++;
    };

    window.addEventListener("alphadesk:ws-open", handleWsOpen);
    window.addEventListener("alphadesk:ws-close", handleWsClose);

    return () => {
      window.removeEventListener("alphadesk:ws-open", handleWsOpen);
      window.removeEventListener("alphadesk:ws-close", handleWsClose);
    };
  }, []);

  // Periodic update
  const updateMetrics = useCallback(() => {
    const timings = __moduleTimings;
    const durations = timings.map((t) => t.duration).sort((a, b) => a - b);
    const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
    const p99 = durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0;

    // Page load time from Navigation Timing API
    let pageLoad = 0;
    if (typeof performance !== "undefined") {
      const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        pageLoad = Math.round(navEntries[0].loadEventEnd - navEntries[0].startTime);
      }
    }

    // Memory usage (Chrome only)
    let memoryMB: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perfMemory = (performance as any)?.memory;
    if (perfMemory) {
      memoryMB = Math.round(perfMemory.usedJSHeapSize / (1024 * 1024));
    }

    // Count active WebSocket subscriptions by checking market store
    // This is approximate based on watchlist size
    let activeSubs = 0;
    try {
      const stored = localStorage.getItem("alphadesk-watchlist");
      if (stored) {
        const parsed = JSON.parse(stored);
        activeSubs = parsed?.state?.watchlist?.length ?? 0;
      }
    } catch {
      // ignore
    }

    // WebSocket connected: check if quotes are flowing
    const recentTimings = timings.filter((t) => Date.now() - t.timestamp < 30000);
    const wsUptime = Math.round((Date.now() - wsStartRef.current) / 1000);

    setData({
      apiTimings: timings.slice(-20),
      wsConnected: recentTimings.length > 0 || wsUptime > 0,
      wsUptime,
      wsReconnects: 0,
      pageLoadTime: pageLoad,
      activeSubscriptions: activeSubs,
      memoryUsageMB: memoryMB,
      avgResponseMs: Math.round(avg),
      p95ResponseMs: Math.round(p95),
      p99ResponseMs: Math.round(p99),
    });
  }, []);

  useEffect(() => {
    updateMetrics();
    intervalRef.current = setInterval(updateMetrics, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateMetrics]);

  return { data, refresh: updateMetrics };
}

// ─── Metric Card ────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  status,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
  status?: "good" | "warn" | "bad" | "neutral";
}) {
  const statusColor = {
    good: "text-[var(--profit)]",
    warn: "text-[var(--chart-4)]",
    bad: "text-[var(--loss)]",
    neutral: "text-foreground",
  }[status ?? "neutral"];

  return (
    <div className="rounded-lg border border-border bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-label text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-base font-bold tabular-nums", statusColor)}>
        {value}
        {unit && <span className="text-label font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Sparkline Bar ──────────────────────────────────────────

function ResponseTimeBars({ timings }: { timings: ApiTiming[] }) {
  if (timings.length === 0) {
    return (
      <div className="flex items-end gap-px h-12">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-border/30"
            style={{ height: "4px" }}
          />
        ))}
      </div>
    );
  }

  const maxDuration = Math.max(...timings.map((t) => t.duration), 100);

  return (
    <div className="flex items-end gap-px h-12" role="img" aria-label="API response time chart showing recent request durations">
      {timings.map((t, i) => {
        const height = Math.max(4, (t.duration / maxDuration) * 48);
        const color =
          t.status === 0 ? "bg-[var(--loss)]"
            : t.duration < 200 ? "bg-[var(--profit)]"
            : t.duration < 500 ? "bg-[var(--chart-4)]"
            : "bg-[var(--loss)]";

        return (
          <div
            key={`${t.timestamp}-${i}`}
            className={cn("flex-1 rounded-t-sm transition-all", color)}
            style={{ height: `${height}px` }}
            title={`${t.url}\n${t.duration}ms (${t.status})`}
          />
        );
      })}
    </div>
  );
}

// ─── Format uptime ──────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Main Component ────────────────────────────────────────

export function PerformanceMetrics() {
  const { data, refresh } = usePerformanceMonitor();

  const avgStatus: "good" | "warn" | "bad" =
    data.avgResponseMs < 200 ? "good" : data.avgResponseMs < 500 ? "warn" : "bad";
  const p95Status: "good" | "warn" | "bad" =
    data.p95ResponseMs < 500 ? "good" : data.p95ResponseMs < 1000 ? "warn" : "bad";
  const memStatus: "good" | "warn" | "bad" =
    (data.memoryUsageMB ?? 0) < 150 ? "good" : (data.memoryUsageMB ?? 0) < 300 ? "warn" : "bad";

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Performance Monitor</h2>
            <p className="text-label text-muted-foreground">Real-time app performance metrics (admin/debug)</p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50"
          title="Refresh metrics"
          aria-label="Refresh performance metrics"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <MetricCard
          label="Avg Response"
          value={data.avgResponseMs}
          unit="ms"
          icon={Clock}
          status={avgStatus}
        />
        <MetricCard
          label="P95 Response"
          value={data.p95ResponseMs}
          unit="ms"
          icon={Clock}
          status={p95Status}
        />
        <MetricCard
          label="P99 Response"
          value={data.p99ResponseMs}
          unit="ms"
          icon={Clock}
          status={p95Status}
        />
        <MetricCard
          label="WS Uptime"
          value={formatUptime(data.wsUptime)}
          icon={data.wsConnected ? Wifi : WifiOff}
          status={data.wsConnected ? "good" : "bad"}
        />
        <MetricCard
          label="Page Load"
          value={data.pageLoadTime}
          unit="ms"
          icon={Activity}
          status={data.pageLoadTime < 2000 ? "good" : data.pageLoadTime < 4000 ? "warn" : "bad"}
        />
        <MetricCard
          label="Subscriptions"
          value={data.activeSubscriptions}
          icon={Activity}
          status="neutral"
        />
        {data.memoryUsageMB != null && (
          <MetricCard
            label="Memory Usage"
            value={data.memoryUsageMB}
            unit="MB"
            icon={MemoryStick}
            status={memStatus}
          />
        )}
      </div>

      {/* Response Time Chart */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-label font-medium text-muted-foreground">
            Recent API Response Times
          </h3>
          <span className="text-label text-muted-foreground tabular-nums">
            {data.apiTimings.length} requests tracked
          </span>
        </div>
        <div className="rounded-lg border border-border bg-black/20 p-2">
          <ResponseTimeBars timings={data.apiTimings} />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-label text-muted-foreground">
              {data.apiTimings.length > 0
                ? new Date(data.apiTimings[0].timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : "--:--"}
            </span>
            <div className="flex items-center gap-3 text-label text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[var(--profit)]" /> &lt;200ms
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[var(--chart-4)]" /> 200-500ms
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[var(--loss)]" /> &gt;500ms
              </span>
            </div>
            <span className="text-label text-muted-foreground">
              {data.apiTimings.length > 0
                ? new Date(data.apiTimings[data.apiTimings.length - 1].timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : "--:--"}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Requests Table */}
      {data.apiTimings.length > 0 && (
        <div className="mt-4">
          <h3 className="text-label font-medium text-muted-foreground mb-2">
            Last 10 Requests
          </h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-label" role="table" aria-label="Recent API requests with response times and status codes">
              <thead>
                <tr className="border-b border-border bg-white/[0.02]">
                  <th scope="col" className="text-left px-2 py-1.5 font-medium text-muted-foreground">Endpoint</th>
                  <th scope="col" className="text-right px-2 py-1.5 font-medium text-muted-foreground">Status</th>
                  <th scope="col" className="text-right px-2 py-1.5 font-medium text-muted-foreground">Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.apiTimings.slice(-10).reverse().map((t, i) => (
                  <tr key={`${t.timestamp}-${i}`} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1 text-foreground/80 truncate max-w-[180px]">{t.url}</td>
                    <td className={cn(
                      "px-2 py-1 text-right tabular-nums",
                      t.status >= 200 && t.status < 300 ? "text-[var(--profit)]"
                        : t.status >= 400 ? "text-[var(--loss)]"
                        : "text-muted-foreground"
                    )}>
                      {t.status || "ERR"}
                    </td>
                    <td className={cn(
                      "px-2 py-1 text-right tabular-nums",
                      t.duration < 200 ? "text-[var(--profit)]"
                        : t.duration < 500 ? "text-[var(--chart-4)]"
                        : "text-[var(--loss)]"
                    )}>
                      {t.duration}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
