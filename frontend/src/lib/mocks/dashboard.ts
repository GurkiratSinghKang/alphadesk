/**
 * MOCK_DASHBOARD_SECTIONS — fixture for the Admin → Dashboard layout
 * composer (per v2-plan §1.6f).
 *
 * Sections come from the live app:
 *   Decision Queue · Risk Escalation · Portfolio Canvas · Risk Panel
 *   · Audit Trail · Session Snapshot · Watchlist Movers · Agent Feed
 *
 * Operator drags / arrow-keys to reorder; checkbox toggles visibility.
 * Saves to `app_config` (or via the tweaks JSON in the prototype).
 */

export interface DashboardSection {
  id: string;
  /** Mono code shown in the composer row. */
  code: string;
  /** Human-readable section title. */
  title: string;
  /** When false, hidden from user dashboards. */
  visible: boolean;
  /** Position in the rendered order (lower index = higher on page). */
  position: number;
}

export const MOCK_DASHBOARD_SECTIONS: DashboardSection[] = [
  {
    id: "decision-queue",
    code: "decision_queue",
    title: "Decision queue",
    visible: true,
    position: 0,
  },
  {
    id: "risk-escalation",
    code: "risk_escalation",
    title: "Risk escalation",
    visible: true,
    position: 1,
  },
  {
    id: "portfolio-canvas",
    code: "portfolio_canvas",
    title: "Portfolio canvas",
    visible: true,
    position: 2,
  },
  {
    id: "risk-panel",
    code: "risk_panel",
    title: "Risk panel",
    visible: true,
    position: 3,
  },
  {
    id: "audit-trail",
    code: "audit_trail",
    title: "Audit trail",
    visible: false,
    position: 4,
  },
  {
    id: "session-snapshot",
    code: "session_snapshot",
    title: "Session snapshot",
    visible: true,
    position: 5,
  },
  {
    id: "watchlist-movers",
    code: "watchlist_movers",
    title: "Watchlist movers",
    visible: true,
    position: 6,
  },
  {
    id: "agent-feed",
    code: "agent_feed",
    title: "Agent feed",
    visible: true,
    position: 7,
  },
];
