"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import { MOCK_ACTIVE_USERS, MOCK_APPLICANTS, type Applicant } from "@/lib/mocks";
import { cn } from "@/lib/utils";

import ActiveUsersTable from "./_components/ActiveUsersTable";
import ApplicantsTable from "./_components/ApplicantsTable";

/**
 * AdminUsersClient
 * ─────────────────
 * v2 redesign — Admin → Users root surface per v2-plan §1.6h.
 *
 * Phase 1.6h ships the read pass: identity band with 4-stat row,
 * tab filter (Applicants · Active · Suspended · All), and the
 * applicant + active-user tables. Approve / Reject / Impersonate
 * destructive flows ship in the Phase 1.6h backend cycle once B.5 +
 * B.14 land.
 */
type Tab = "applicants" | "active" | "suspended" | "all";

const TAB_LABELS: Record<Tab, string> = {
  applicants: "Applicants",
  active: "Active",
  suspended: "Suspended",
  all: "All users",
};

export default function AdminUsersClient() {
  const [tab, setTab] = React.useState<Tab>("applicants");
  const [selectedApplicant, setSelectedApplicant] =
    React.useState<Applicant | null>(null);

  const stats = React.useMemo(() => {
    const pending = MOCK_APPLICANTS.filter((a) => a.status === "pending").length;
    const onHold = MOCK_APPLICANTS.filter((a) => a.status === "hold").length;
    const active = MOCK_ACTIVE_USERS.filter((u) => u.status === "active").length;
    const suspended = MOCK_ACTIVE_USERS.filter((u) => u.status === "suspended").length;
    const equity = MOCK_ACTIVE_USERS.reduce((sum, u) => sum + u.equity, 0);
    const cost24h = MOCK_ACTIVE_USERS.reduce((sum, u) => sum + u.cost24h, 0);
    return { pending, onHold, active, suspended, equity, cost24h };
  }, []);

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-8 md:px-6">
      <Section
        eyebrow="ADMIN · USERS"
        title="People & access"
        description="Approve applicants, provision dashboards, watch telemetry, revoke access. Bulk actions + impersonation ship with backend B.5 / B.14."
        level={1}
        right={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
            <Stat label="Pending" value={stats.pending} size="sm" tone="brand" />
            <Stat label="On hold" value={stats.onHold} size="sm" tone="muted" />
            <Stat label="Active users" value={stats.active} size="sm" tone="profit" />
            <Stat
              label="AI spend 24h"
              value={`$${stats.cost24h.toFixed(2)}`}
              size="sm"
              tone="muted"
            />
          </div>
        }
      >
        <nav
          aria-label="Filter users"
          role="tablist"
          className="flex flex-wrap gap-1.5"
        >
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-sm text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                tab === t
                  ? "bg-bg-elev-2 text-fg border border-brand/40"
                  : "text-fg-muted hover:text-fg border border-transparent hover:border-border-hair",
              )}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      </Section>

      {tab === "applicants" && (
        <ApplicantsTable
          filter="pending"
          onSelect={(a) => setSelectedApplicant(a)}
        />
      )}
      {tab === "active" && <ActiveUsersTable statusFilter="active" />}
      {tab === "suspended" && <ActiveUsersTable statusFilter="suspended" />}
      {tab === "all" && <ActiveUsersTable statusFilter="all" />}

      {selectedApplicant && (
        <ApplicantPreviewSheet
          applicant={selectedApplicant}
          onClose={() => setSelectedApplicant(null)}
        />
      )}
    </div>
  );
}

/**
 * Phase 1.6h preview-only side sheet. Renders the applicant memo +
 * questionnaire + risk signals. The full ApproveModal (default
 * dashboard preset + risk profile + agent set + welcome template +
 * audit preview) ships in the Phase 1.6h backend cycle once B.5
 * lands.
 */
function ApplicantPreviewSheet({
  applicant,
  onClose,
}: {
  applicant: Applicant;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-bg/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="w-full sm:w-[480px] h-full overflow-y-auto bg-bg-card border-l border-border p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="t-label text-brand">APPLICANT · {applicant.id}</p>
            <h2 className="font-display italic text-h2 text-fg mt-1">
              {applicant.name}
            </h2>
            <p className="text-body-sm text-fg-muted t-mono mt-0.5">
              {applicant.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-muted hover:text-fg p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            ×
          </button>
        </header>

        <section className="rounded-md border border-border-hair bg-bg-elev-1 p-3">
          <p className="t-label text-fg-muted mb-1.5">Application memo</p>
          <p className="font-display italic text-body text-fg-dim leading-relaxed">
            &ldquo;{applicant.reason}&rdquo;
          </p>
        </section>

        <section className="rounded-md border border-border-hair bg-bg-elev-1 p-3 space-y-2">
          <p className="t-label text-fg-muted">Questionnaire</p>
          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-body-sm">
            <dt className="text-fg-muted">Capital band</dt>
            <dd className="text-fg t-mono">{applicant.questionnaire.capitalBand}</dd>
            <dt className="text-fg-muted">Risk tolerance</dt>
            <dd className="text-fg">{applicant.questionnaire.riskTolerance}</dd>
            <dt className="text-fg-muted">Time horizon</dt>
            <dd className="text-fg">{applicant.questionnaire.timeHorizon}</dd>
            <dt className="text-fg-muted">Asset preference</dt>
            <dd className="text-fg">
              {applicant.questionnaire.assetPref.join(", ") || "—"}
            </dd>
            <dt className="text-fg-muted">Strategy interest</dt>
            <dd className="text-fg">
              {applicant.questionnaire.strategyInterest.join(", ") || "—"}
            </dd>
          </dl>
        </section>

        {applicant.flags.length > 0 && (
          <section className="rounded-md border border-loss/40 bg-tint-down-1 p-3">
            <p className="t-label text-loss mb-1.5">Risk signals</p>
            <ul className="text-body-sm text-fg space-y-0.5 list-disc list-inside">
              {applicant.flags.map((f) => (
                <li key={f}>{f.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </section>
        )}

        <footer className="flex flex-wrap gap-2 mt-auto pt-3 border-t border-border-hair">
          <button
            type="button"
            disabled
            className="flex-1 min-w-[120px] rounded-sm border border-profit/50 bg-tint-up-1 text-profit px-3 py-2 text-body-sm font-semibold uppercase tracking-[0.08em] opacity-50 cursor-not-allowed"
            title="Phase 1.6h follow-up wires the ApproveModal + B.5 backend"
          >
            Approve
          </button>
          <button
            type="button"
            disabled
            className="flex-1 min-w-[120px] rounded-sm border border-loss/50 bg-tint-down-1 text-loss px-3 py-2 text-body-sm font-semibold uppercase tracking-[0.08em] opacity-50 cursor-not-allowed"
            title="Phase 1.6h follow-up wires the RejectModal + B.5 backend"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-w-[80px] rounded-sm border border-border-hair bg-bg-elev-1 text-fg-muted px-3 py-2 text-body-sm font-semibold uppercase tracking-[0.08em] hover:text-fg transition-colors"
          >
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}
