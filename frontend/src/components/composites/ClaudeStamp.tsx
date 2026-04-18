import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ClaudeStamp (composite · AI signature line)
 * ──────────────────────────────────────────
 * The mono-micro stamp that signs AI-authored content:
 *
 *   Haiku 4.5 · confidence 0.72 · 180 ms · approved 14:28 ET
 *
 * Each field is optional — pass only what you have. "Approved" only
 * renders when `approved` is explicitly true. Confidence renders as two
 * decimals, latency as ms. Use to sign memos, journals, auto-notes.
 */
export interface ClaudeStampProps {
  model: string;
  confidence?: number;
  latencyMs?: number;
  /** Pre-formatted, e.g. "14:28 ET". */
  approvedAt?: string;
  approved?: boolean;
  className?: string;
}

export default function ClaudeStamp({
  model,
  confidence,
  latencyMs,
  approvedAt,
  approved,
  className,
}: ClaudeStampProps) {
  const parts: string[] = [model];
  if (typeof confidence === "number")
    parts.push(`confidence ${confidence.toFixed(2)}`);
  if (typeof latencyMs === "number") parts.push(`${latencyMs} ms`);
  if (approved && approvedAt) parts.push(`approved ${approvedAt}`);

  return (
    <span
      data-slot="claude-stamp"
      data-approved={approved || undefined}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[9.5px] text-fg-hint uppercase",
        className
      )}
      style={{ letterSpacing: "0.06em" }}
    >
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 ? (
            <span aria-hidden className="text-fg-hint">
              ·
            </span>
          ) : null}
          <span className={i === 0 ? "text-fg-muted" : undefined}>{p}</span>
        </React.Fragment>
      ))}
    </span>
  );
}
