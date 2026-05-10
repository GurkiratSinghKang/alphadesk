"use client";

import * as React from "react";

import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import Section from "@/components/composites/Section";
import { MOCK_AUDIT_LOG, type AuditEntry, type AuditEventKind } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * AuditTail
 * ──────────
 * v2 redesign — admin audit log tail (last 10 admin writes) per
 * v2-plan §1.6i. Shows actor, action line, scope, optional reason,
 * and a deep-link to the full audit log (Phase 1.6 follow-up).
 *
 * Phase 0 reads MOCK_AUDIT_LOG; Phase 1.6 swaps to
 * `GET /api/v1/admin/audit/tail?limit=10`.
 */
export interface AuditTailProps {
  className?: string;
  /** Override entries — primarily for /_design and tests. */
  entries?: AuditEntry[];
  /** Number of entries to show. Default 10. */
  limit?: number;
}

const kindToTone: Partial<Record<AuditEventKind, StatusDotTone>> = {
  key_rotated: "brand",
  layout_changed: "ice",
  halt_toggled: "loss",
  deploy_triggered: "amber",
  user_approved: "profit",
  user_rejected: "loss",
  control_changed: "brand",
  feature_flag_changed: "ice",
  impersonation_started: "amber",
  impersonation_stopped: "profit",
  agent_paused: "amber",
  agent_resumed: "profit",
  wash_trade_reject: "loss",
  live_gate_reject: "loss",
};

function relative(iso: string, now: number): string {
  const diff = now - Date.parse(iso);
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export default function AuditTail({
  className,
  entries = MOCK_AUDIT_LOG,
  limit = 10,
}: AuditTailProps) {
  const visible = entries.slice(0, limit);
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNow(Date.now());
  }, []);

  return (
    <Section
      eyebrow="ADMIN · AUDIT"
      title="Audit tail"
      description={`Last ${visible.length} admin write${visible.length === 1 ? "" : "s"} · view full log →`}
      right={
        <a
          href="/admin/audit"
          className="text-body-sm text-fg-muted hover:text-fg underline-offset-2 hover:underline"
        >
          Full log →
        </a>
      }
      className={className}
    >
      <ol
        data-slot="audit-tail"
        role="list"
        className="flex flex-col divide-y divide-border-hair rounded-md border border-border-hair bg-bg-elev-1"
      >
        {visible.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
            <StatusDot tone={kindToTone[entry.kind] ?? "muted"} size={5} />
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-body text-fg font-medium">{entry.action}</span>
                {entry.scope && (
                  <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted truncate">
                    {entry.scope}
                  </span>
                )}
              </div>
              {entry.reason && (
                <span className="text-body-sm text-fg-muted italic line-clamp-2">
                  &ldquo;{entry.reason}&rdquo;
                </span>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-0.5 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
              <span className="text-fg-dim">{entry.actor}</span>
              {now !== null && <span>{relative(entry.ts, now)}</span>}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
