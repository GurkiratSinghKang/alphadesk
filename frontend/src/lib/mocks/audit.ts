/**
 * MOCK_AUDIT_LOG — fixture for the Admin Control Center audit tail
 * (per v2-plan §1.6i — last 10 admin writes with link to full log).
 *
 * Real audit rows live in `backend/data/storage/models.py:AuditLog`.
 * The frontend consumes a shape close to the eventual `GET
 * /admin/audit/tail?limit=10` response.
 */

export type AuditEventKind =
  | "key_rotated"
  | "layout_changed"
  | "halt_toggled"
  | "deploy_triggered"
  | "user_approved"
  | "user_rejected"
  | "control_changed"
  | "feature_flag_changed"
  | "impersonation_started"
  | "impersonation_stopped"
  | "agent_paused"
  | "agent_resumed"
  | "wash_trade_reject"
  | "live_gate_reject";

export interface AuditEntry {
  id: string;
  /** ISO timestamp of the event. */
  ts: string;
  /** Username of the actor (operator, system). */
  actor: string;
  /** Kind of event (used for filter chips on the full log page). */
  kind: AuditEventKind;
  /** Human-readable action line. */
  action: string;
  /** Optional scope (e.g. strategy id, user, symbol). */
  scope?: string;
  /** Optional reason supplied via DangerConfirm. */
  reason?: string;
  /** Optional control id reference, deep-linkable. */
  controlId?: string;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const MOCK_AUDIT_LOG: AuditEntry[] = [
  {
    id: "audit-1",
    ts: ago(2 * MIN),
    actor: "operator",
    kind: "control_changed",
    action: "Sector cap → 35%",
    scope: "global",
    reason: "Tightening info-tech concentration after NVDA run.",
    controlId: "risk-sector-cap",
  },
  {
    id: "audit-2",
    ts: ago(28 * MIN),
    actor: "system",
    kind: "agent_resumed",
    action: "Risk agent resumed",
    scope: "archetype:risk",
    controlId: "ai-archetype-risk",
  },
  {
    id: "audit-3",
    ts: ago(45 * MIN),
    actor: "operator",
    kind: "feature_flag_changed",
    action: "Toggled command.jarvis → on",
    scope: "global",
    controlId: "flag-jarvis-bar",
  },
  {
    id: "audit-4",
    ts: ago(2 * HOUR),
    actor: "operator",
    kind: "key_rotated",
    action: "Rotated FMP_API_KEY",
    scope: "global",
    reason: "Quarterly rotation.",
    controlId: "key-fmp",
  },
  {
    id: "audit-5",
    ts: ago(3 * HOUR),
    actor: "operator",
    kind: "user_approved",
    action: "Approved applicant Aria Mehta",
    scope: "user:aria_mehta",
  },
  {
    id: "audit-6",
    ts: ago(4 * HOUR),
    actor: "operator",
    kind: "deploy_triggered",
    action: "Deploy frontend → prod (workflow_dispatch)",
    scope: "env:prod",
    reason: "Hotfix: stale-quote 422 inline error.",
    controlId: "deploy-prod-frontend",
  },
  {
    id: "audit-7",
    ts: ago(8 * HOUR),
    actor: "operator",
    kind: "halt_toggled",
    action: "Trade halt OFF (resume)",
    scope: "global",
    reason: "Pipeline DNS verified post-deploy.",
    controlId: "trade-halt",
  },
  {
    id: "audit-8",
    ts: ago(11 * HOUR),
    actor: "operator",
    kind: "halt_toggled",
    action: "Trade halt ON",
    scope: "global",
    reason: "Compose DNS resolution failed pre-migration.",
    controlId: "trade-halt",
  },
  {
    id: "audit-9",
    ts: ago(20 * HOUR),
    actor: "system",
    kind: "wash_trade_reject",
    action: "Wash-trade reject (NVDA buy)",
    scope: "strategy:earnings-options-play",
  },
  {
    id: "audit-10",
    ts: ago(36 * HOUR),
    actor: "operator",
    kind: "layout_changed",
    action: "Reordered dashboard sections",
    scope: "global",
  },
];
