// Pipeline observability API helpers — split out from `lib/api.ts` so the
// new live-status / cancel / scheduler-state endpoints can land without
// touching the Wave-31-owned core api module. The wider api.ts already
// exports a richer `PipelineStatus` for the existing trigger flow; we
// re-define a strictly observability-focused shape here that mirrors the
// new backend `/api/v1/pipeline/status` response (persona-7 #1, #4, #6).
//
// HTTP plumbing: the canonical `apiFetch` lives in `lib/api.ts` but is not
// exported. To avoid importing private symbols, this file replicates the
// minimum surface (`credentials: "include"` so the HttpOnly auth cookie
// rides along, JSON content-type, env-driven base URL). If/when api.ts
// exports `apiFetch`, this can collapse to a thin re-import.

import { env } from "@/env";

const DEFAULT_TIMEOUT_MS = 15_000;

interface PipelineFetchOptions extends RequestInit {
  /** Override the default 15s request timeout. */
  timeoutMs?: number;
}

class PipelineApiError extends Error {
  status: number;
  body?: unknown;
  retryAfter?: number;
  constructor(message: string, status: number, body?: unknown, retryAfter?: number) {
    super(message);
    this.name = "PipelineApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

async function apiFetch<T>(path: string, init?: PipelineFetchOptions): Promise<T> {
  // SSR fallback mirrors lib/api.ts — when called server-side without a
  // configured public URL, target the local backend so route handlers
  // don't crash during prerender.
  const base =
    typeof window !== "undefined"
      ? env.API_URL || ""
      : env.API_URL || "http://localhost:8000";
  const url = `${base}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  const { timeoutMs, signal: callerSignal, ...rest } = init ?? {};
  const effectiveTimeout =
    typeof timeoutMs === "number" ? timeoutMs : DEFAULT_TIMEOUT_MS;

  let signal: AbortSignal | undefined;
  if (effectiveTimeout > 0 && typeof AbortSignal !== "undefined") {
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    if (
      callerSignal &&
      typeof (AbortSignal as unknown as { any?: unknown }).any === "function"
    ) {
      signal = (
        AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }
      ).any([timeoutSignal, callerSignal]);
    } else {
      signal = callerSignal ?? timeoutSignal;
    }
  } else {
    signal = callerSignal ?? undefined;
  }

  const res = await fetch(url, {
    ...rest,
    headers,
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    // Preserve Retry-After when the backend rate-limits us (persona-9 #10) —
    // the page UI uses it to render a countdown rather than spinning.
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body — ignore, status code is enough context.
    }
    throw new PipelineApiError(
      `Pipeline API ${res.status}: ${path}`,
      res.status,
      body,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  // 202 Accepted from POST /run still has a body (the run_id payload).
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export { PipelineApiError };

// ─── Live status ────────────────────────────────────────────

export interface PipelineStatus {
  running: boolean;
  stage: string | null;
  progress: { current: number; total: number } | null;
  started_at: string | null;
  run_id: string | null;
  current_strategy: string | null;
  last_run: string;
  last_result: string;
}

export function getPipelineStatus(): Promise<PipelineStatus> {
  return apiFetch<PipelineStatus>("/api/v1/pipeline/status");
}

// ─── Async run + cancel ─────────────────────────────────────

export interface PipelineRunStarted {
  run_id: string;
  status: "started";
}

/**
 * Kick off a pipeline run asynchronously. Backend returns 202 Accepted with
 * the new run_id; the page is expected to start polling /status until the
 * run finishes.
 *
 * Throws `PipelineApiError` with `.status === 429` on rate-limit; the
 * caller should read `.retryAfter` (seconds) and surface it as a
 * countdown.
 */
export function startPipelineRun(): Promise<PipelineRunStarted> {
  return apiFetch<PipelineRunStarted>("/api/v1/pipeline/run", {
    method: "POST",
  });
}

export function cancelPipeline(): Promise<{ cancelled: boolean }> {
  return apiFetch<{ cancelled: boolean }>("/api/v1/pipeline/cancel", {
    method: "POST",
  });
}

// ─── Scheduler state ────────────────────────────────────────

export interface SchedulerState {
  last_heartbeat: string | null;
  next_scheduled_run: string | null;
  missed_runs: number;
}

export function getSchedulerState(): Promise<SchedulerState> {
  return apiFetch<SchedulerState>("/api/v1/pipeline/scheduler_state");
}
