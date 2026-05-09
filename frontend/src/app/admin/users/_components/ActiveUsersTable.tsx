"use client";

import * as React from "react";
import Link from "next/link";

import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import EmptyState from "@/components/primitives/EmptyState";
import { MOCK_ACTIVE_USERS, type ActiveUser, type UserStatus } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * ActiveUsersTable
 * ─────────────────
 * v2 redesign — Admin Users active-user roster per v2-plan §1.6h.
 * Shows tenant telemetry: equity, open positions, daily P&L, agent
 * runs, API calls, AI spend, risk score, status. Click a user → opens
 * UserDrawer (Phase 1.6h follow-up).
 *
 * Phase 1.6h reads MOCK_ACTIVE_USERS; backend B.5 / B.16 swap for
 * `GET /api/v1/admin/users?status=active`.
 */
export interface ActiveUsersTableProps {
  users?: ActiveUser[];
  statusFilter?: UserStatus | "all";
}

const STATUS_TONE: Record<UserStatus, StatusDotTone> = {
  active: "profit",
  flagged: "amber",
  suspended: "loss",
};

function fmtUsd(n: number, opts?: { compact?: boolean; signed?: boolean }) {
  const sign = opts?.signed && n > 0 ? "+" : "";
  if (opts?.compact && Math.abs(n) >= 1000) {
    return `${sign}$${(n / 1000).toFixed(1)}k`;
  }
  if (Math.abs(n) >= 1_000_000) {
    return `${sign}$${(n / 1_000_000).toFixed(2)}M`;
  }
  return `${sign}$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export default function ActiveUsersTable({
  users = MOCK_ACTIVE_USERS,
  statusFilter = "all",
}: ActiveUsersTableProps) {
  const visible = React.useMemo(
    () =>
      statusFilter === "all"
        ? users
        : users.filter((u) => u.status === statusFilter),
    [users, statusFilter],
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        eyebrow="EMPTY"
        title="No active users."
        description="Approve an applicant from the Applicants tab to provision a tenant."
      />
    );
  }

  return (
    <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            <th className="text-left px-3 py-2 font-semibold">Name</th>
            <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Plan</th>
            <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Last seen</th>
            <th className="text-right px-3 py-2 font-semibold">Equity</th>
            <th className="text-right px-3 py-2 font-semibold hidden md:table-cell">Open</th>
            <th className="text-right px-3 py-2 font-semibold">Day P&amp;L</th>
            <th className="text-right px-3 py-2 font-semibold hidden xl:table-cell">AI 24h</th>
            <th className="text-right px-3 py-2 font-semibold hidden lg:table-cell">Risk</th>
            <th className="text-left px-3 py-2 font-semibold">Status</th>
            <th className="text-right px-3 py-2 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((u) => (
            <tr key={u.id} className="border-t border-border-hair hover:bg-bg-elev-2 transition-colors">
              <td className="px-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-body text-fg font-medium">{u.name}</span>
                  <span className="text-eyebrow text-fg-muted">{u.email}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 hidden md:table-cell">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded-pill text-eyebrow uppercase tracking-[0.08em] font-semibold",
                    u.plan === "operator" && "bg-tint-brand-2 text-brand",
                    u.plan === "pro" && "bg-tint-info-1 text-ice",
                    u.plan === "starter" && "bg-bg-elev-2 text-fg-muted",
                    u.plan === "free" && "bg-bg-elev-2 text-fg-hint",
                  )}
                >
                  {u.plan}
                </span>
              </td>
              <td className="px-3 py-2.5 hidden lg:table-cell text-fg-muted t-mono">
                {relative(u.lastSeen)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right t-mono",
                  u.mode === "paper" ? "text-fg-muted italic" : "text-fg",
                )}
              >
                {fmtUsd(u.equity, { compact: true })}
              </td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden md:table-cell">
                {u.openPositions}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right t-mono",
                  u.mode === "paper"
                    ? "text-fg-muted italic"
                    : u.dailyPnl > 0
                    ? "text-profit"
                    : u.dailyPnl < 0
                    ? "text-loss"
                    : "text-fg-muted",
                )}
              >
                {fmtUsd(u.dailyPnl, { signed: true })}
              </td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden xl:table-cell">
                ${u.cost24h.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right t-mono hidden lg:table-cell">
                <span
                  className={cn(
                    u.riskScore > 50
                      ? "text-loss"
                      : u.riskScore > 30
                      ? "text-state-warning"
                      : "text-fg-muted",
                  )}
                >
                  {u.riskScore}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={STATUS_TONE[u.status]} size={5} />
                  <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted font-semibold">
                    {u.status}
                  </span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="rounded-sm border border-border bg-bg-elev-2 hover:border-brand/50 hover:text-fg text-fg-muted px-2 py-0.5 text-eyebrow uppercase tracking-[0.08em] font-semibold transition-colors"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
