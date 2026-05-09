"use client";

import * as React from "react";

import EmptyState from "@/components/primitives/EmptyState";
import { MOCK_APPLICANTS, type Applicant } from "@/lib/mocks";
import { cn } from "@/lib/utils";

import RiskPill from "./RiskPill";

/**
 * ApplicantsTable
 * ────────────────
 * v2 redesign — Admin Users applicants surface per v2-plan §1.6h.
 * Columns: Applicant · Email · Applied · Country · Risk · Flags ·
 * Actions (Approve / Reject / Hold / Message). Click row → opens
 * ApplicantDrawer with full memo + questionnaire snapshot.
 *
 * Phase 1.6h reads MOCK_APPLICANTS; backend B.5 swaps for
 * `GET /api/v1/admin/applicants?status=pending`.
 */
export interface ApplicantsTableProps {
  /** Optional override — used by /_design and tests. */
  applicants?: Applicant[];
  /** Click handler — opens drawer with applicant id. */
  onSelect?: (applicant: Applicant) => void;
  /** Status filter (default: "pending"). */
  filter?: Applicant["status"];
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export default function ApplicantsTable({
  applicants = MOCK_APPLICANTS,
  onSelect,
  filter = "pending",
}: ApplicantsTableProps) {
  const visible = React.useMemo(
    () =>
      filter ? applicants.filter((a) => a.status === filter) : applicants,
    [applicants, filter],
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        eyebrow="INBOX EMPTY"
        title="0 pending applications · operators rest."
        description={
          filter === "pending"
            ? "When a new applicant submits via /request-access, they appear here."
            : `No ${filter} applicants right now.`
        }
      />
    );
  }

  return (
    <div
      data-slot="applicants-table"
      className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden"
    >
      <table className="w-full text-body-sm">
        <thead>
          <tr className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            <th className="text-left px-3 py-2 font-semibold">Applicant</th>
            <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Email</th>
            <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Country</th>
            <th className="text-left px-3 py-2 font-semibold">Applied</th>
            <th className="text-left px-3 py-2 font-semibold">Risk</th>
            <th className="text-left px-3 py-2 font-semibold hidden xl:table-cell">Flags / note</th>
            <th className="text-right px-3 py-2 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr
              key={a.id}
              className={cn(
                "border-t border-border-hair transition-colors hover:bg-bg-elev-2 cursor-pointer",
                a.risk === "high" && "bg-tint-down-1/40",
              )}
              onClick={() => onSelect?.(a)}
            >
              <td className="px-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-body text-fg font-medium">{a.name}</span>
                  <span className="text-eyebrow text-fg-muted md:hidden">{a.email}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 hidden md:table-cell text-fg-muted t-mono">{a.email}</td>
              <td className="px-3 py-2.5 hidden lg:table-cell text-fg-muted">{a.country}</td>
              <td className="px-3 py-2.5 text-fg-muted t-mono">{relative(a.appliedAt)}</td>
              <td className="px-3 py-2.5">
                <RiskPill tier={a.risk} />
              </td>
              <td className="px-3 py-2.5 hidden xl:table-cell">
                <div className="flex flex-col gap-0.5">
                  {a.flags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {a.flags.map((flag) => (
                        <span
                          key={flag}
                          className="px-1.5 py-0.5 rounded-pill bg-tint-down-1 text-loss text-eyebrow uppercase tracking-[0.08em] font-semibold"
                        >
                          {flag.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-fg-muted italic line-clamp-1">{a.reason}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect?.(a);
                    }}
                    className="rounded-sm border border-profit/50 bg-tint-up-1 text-profit px-2 py-0.5 text-eyebrow font-semibold uppercase tracking-[0.08em] hover:bg-profit hover:text-up-on transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="rounded-sm border border-loss/50 bg-tint-down-1 text-loss px-2 py-0.5 text-eyebrow font-semibold uppercase tracking-[0.08em] hover:bg-loss hover:text-down-on transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
