/**
 * Re-export hub for v2 fixture data. Keeps consumers decoupled
 * from individual file paths so a future swap to real API contracts
 * touches only the hooks layer.
 */

export { MOCK_AGENTS } from "./agents";
export type { Agent } from "@/lib/types/agents";

export {
  MOCK_CONTROLS,
  controlCategories,
  controlsByCategory,
} from "./controls";
export type { ControlSpec, ControlCategory, ControlSurface } from "./controls";

export { MOCK_HEALTH_TILES } from "./health";
export type { HealthTile, HealthTone } from "./health";

export { MOCK_ARCH_NODES, MOCK_ARCH_EDGES } from "./arch";
export type { ArchNode, ArchEdge, ArchGroup, ArchStatus } from "./arch";

export { MOCK_AUDIT_LOG } from "./audit";
export type { AuditEntry, AuditEventKind } from "./audit";

export { MOCK_APPLICANTS, MOCK_ACTIVE_USERS } from "./users";
export type {
  Applicant,
  ApplicantStatus,
  ApplicantRiskTier,
  ActiveUser,
  UserPlan,
  UserStatus,
} from "./users";

export { MOCK_DASHBOARD_SECTIONS } from "./dashboard";
export type { DashboardSection } from "./dashboard";
